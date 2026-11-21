use russh::client::{self, AuthResult, Handle, Handler, KeyboardInteractiveAuthResponse};
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::agent::AgentIdentity;
use russh::keys::ssh_key::HashAlg;
use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg};
use russh::{Disconnect, MethodKind};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};

use crate::db::models::KnownHost;
use crate::db::Database;

/// Configures a `TcpStream` with low-latency (`TCP_NODELAY`) and socket-level
/// TCP keepalive (15s idle probe, 5s retry interval) to prevent stateful NAT routers,
/// middleboxes, and cloud VPC firewalls from terminating idle connections.
pub fn configure_tcp_stream(stream: &tokio::net::TcpStream) {
    let _ = stream.set_nodelay(true);
    let keepalive = socket2::TcpKeepalive::new()
        .with_time(Duration::from_secs(15))
        .with_interval(Duration::from_secs(5));
    let _ = socket2::SockRef::from(stream).set_tcp_keepalive(&keepalive);
}

/// Creates a standard `russh::client::Config` with SSH-level keepalive enabled.
/// Sends `keepalive@openssh.com` probes every 15 seconds to ensure sessions
/// (interactive shells, long-running monitoring like btop/htop, SFTP, tunnels)
/// never get dropped by remote servers or NAT translation timeouts.
pub fn default_client_config() -> Arc<client::Config> {
    let mut config = client::Config::default();
    config.keepalive_interval = Some(Duration::from_secs(15));
    config.keepalive_max = 4;
    Arc::new(config)
}

/// Progress payload emitted to the frontend during connection handshake.
#[derive(Debug, Clone, Serialize)]
pub struct SshProgressPayload {
    pub step: u8,          // 1: Connect, 2: HostKey, 3: Auth, 4: Shell, 5: Ready
    pub step_name: String, // "connecting", "host_key", "authenticating", "opening_channel", "ready", "error"
    pub message: String,
    pub timestamp: String,
    pub is_error: bool,
}

/// Verifies the server's host key against the locally stored known_hosts
/// table (Trust On First Use), rejecting the connection outright if the
/// key ever changes for a previously trusted address:port — this is the
/// same protection OpenSSH's known_hosts file provides against MITM
/// attacks and impersonated servers.
pub struct SshClientHandler {
    pub address: String,
    pub port: u16,
    pub db: Arc<Database>,
    /// Set only by remote port forwarding (-R) tunnels. When present, channels
    /// the server opens for our `tcpip_forward` listener are accepted and
    /// handed to the tunnel task; when absent, such channels are rejected so
    /// a server can never push unsolicited connections into the client.
    pub forwarded_tcpip: Option<mpsc::UnboundedSender<ForwardedTcpip>>,
}

/// A connection arriving on a remote (-R) forward's server-side listener.
pub struct ForwardedTcpip {
    pub channel: russh::Channel<client::Msg>,
    pub originator_address: String,
    pub originator_port: u32,
}

impl Handler for SshClientHandler {
    type Error = anyhow::Error;

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<client::Msg>,
        _connected_address: &str,
        _connected_port: u32,
        originator_address: &str,
        originator_port: u32,
        reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let Some(tx) = &self.forwarded_tcpip else {
            // Dropping `reply` rejects the channel (AdministrativelyProhibited).
            return Ok(());
        };
        reply.accept().await;
        let _ = tx.send(ForwardedTcpip {
            channel,
            originator_address: originator_address.to_string(),
            originator_port,
        });
        Ok(())
    }

    async fn check_server_key(
        &mut self,
        server_key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        // For host certificates, pin the host's own public key embedded in the
        // certificate (not the CA), so TOFU behaves exactly as for plain keys
        // and survives routine certificate re-issuance.
        let server_public_key = &server_key.public_key();
        let fingerprint = format!("{}", server_public_key.fingerprint(HashAlg::Sha256));
        let key_type = server_public_key.algorithm().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // Fail closed: a DB error must never be treated as "host never seen",
        // otherwise the presented (possibly attacker) key would get pinned.
        let existing = self
            .db
            .get_known_host(&self.address, self.port)
            .map_err(|e| anyhow::anyhow!("Could not read known hosts to verify the server key: {e}"))?;

        match existing {
            None => {
                // Trust On First Use: remember this key for future connections.
                let entry = KnownHost {
                    address: self.address.clone(),
                    port: self.port,
                    key_type,
                    fingerprint,
                    first_seen_at: now.clone(),
                    last_seen_at: now,
                };
                // If we can't pin the key, don't proceed: the next connection
                // would silently TOFU again and accept whatever key it sees.
                self.db
                    .save_known_host(&entry)
                    .map_err(|e| anyhow::anyhow!("Could not save the server key to known hosts: {e}"))?;
                Ok(true)
            }
            Some(known) if known.fingerprint == fingerprint => {
                // Key matches what we trusted before — refresh last_seen_at.
                let mut updated = known;
                updated.last_seen_at = now;
                let _ = self.db.save_known_host(&updated);
                Ok(true)
            }
            Some(known) => {
                // Key mismatch: potential MITM attack, server reinstall, or IP reuse.
                Err(anyhow::anyhow!(
                    "REMOTE HOST IDENTIFICATION HAS CHANGED for {}:{}! Server presented a key with fingerprint {} but the previously trusted key was {} (first trusted {}). This could indicate a man-in-the-middle attack, or the server may have been reinstalled. Remove the old entry from Known Hosts if you trust this change.",
                    self.address, self.port, fingerprint, known.fingerprint, known.first_seen_at
                ))
            }
        }
    }
}

#[derive(Clone)]
pub enum SshAuth {
    Password(String),
    PrivateKey { pem: String, passphrase: Option<String> },
    /// Authenticate with a key held by the local SSH agent (e.g. Bitwarden,
    /// 1Password, or the system OpenSSH agent). No key material is read or
    /// stored by Termimus; the agent only signs the login challenge.
    Agent,
}

#[derive(Clone)]
pub struct JumpHostConfig {
    pub address: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
}

pub enum SshStream {
    Direct(tokio::net::TcpStream),
    Tunneled(russh::ChannelStream<russh::client::Msg>),
}

impl tokio::io::AsyncRead for SshStream {
    fn poll_read(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            SshStream::Direct(s) => std::pin::Pin::new(s).poll_read(cx, buf),
            SshStream::Tunneled(s) => std::pin::Pin::new(s).poll_read(cx, buf),
        }
    }
}

impl tokio::io::AsyncWrite for SshStream {
    fn poll_write(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        match self.get_mut() {
            SshStream::Direct(s) => std::pin::Pin::new(s).poll_write(cx, buf),
            SshStream::Tunneled(s) => std::pin::Pin::new(s).poll_write(cx, buf),
        }
    }

    fn poll_flush(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            SshStream::Direct(s) => std::pin::Pin::new(s).poll_flush(cx),
            SshStream::Tunneled(s) => std::pin::Pin::new(s).poll_flush(cx),
        }
    }

    fn poll_shutdown(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            SshStream::Direct(s) => std::pin::Pin::new(s).poll_shutdown(cx),
            SshStream::Tunneled(s) => std::pin::Pin::new(s).poll_shutdown(cx),
        }
    }
}

pub enum SessionCommand {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
}

/// Authenticates an SSH session using public key authentication, dynamically negotiating
/// the strongest RSA signature algorithm (rsa-sha2-512, rsa-sha2-256) accepted by the
/// server with fallback to sha-1, avoiding the "Authentication rejected" error seen on
/// modern OpenSSH (>= 8.8) servers that disable legacy SHA-1 ssh-rsa.
pub async fn authenticate_publickey_smart<H: russh::client::Handler>(
    handle: &mut russh::client::Handle<H>,
    username: &str,
    key_pair: russh::keys::PrivateKey,
) -> Result<russh::client::AuthResult, String> {
    let is_rsa = key_pair.algorithm().is_rsa();
    let best_hash = if is_rsa {
        match handle.best_supported_rsa_hash().await {
            Ok(Some(hash)) => hash,
            _ => Some(HashAlg::Sha512),
        }
    } else {
        None
    };

    let key = PrivateKeyWithHashAlg::new(Arc::new(key_pair.clone()), best_hash);
    let mut res = handle
        .authenticate_publickey(username, key)
        .await
        .map_err(|e| format!("Auth error: {e}"))?;

    // Rejected outright = no partial success and the server still offers
    // publickey. Partial success (key accepted, second factor pending) must
    // not trigger the RSA hash fallback.
    let key_rejected = |r: &AuthResult| {
        matches!(r, AuthResult::Failure { remaining_methods, partial_success: false } if remaining_methods.contains(&MethodKind::PublicKey))
    };
    if is_rsa && key_rejected(&res) {
        for fallback in [Some(HashAlg::Sha256), Some(HashAlg::Sha512), None] {
            if fallback == best_hash {
                continue;
            }
            let key = PrivateKeyWithHashAlg::new(Arc::new(key_pair.clone()), fallback);
            if let Ok(r) = handle.authenticate_publickey(username, key).await {
                if !key_rejected(&r) {
                    res = r;
                    break;
                }
            }
        }
    }

    Ok(res)
}

/// Connect to the local SSH agent at the platform endpoint: the socket named
/// by `SSH_AUTH_SOCK` on Unix (OpenSSH, Bitwarden, 1Password, ...). The
/// stream is boxed so every platform yields the same client type.
#[cfg(unix)]
async fn connect_ssh_agent() -> Result<AgentClient<Box<dyn AgentStream + Send + Unpin>>, String> {
    AgentClient::connect_env()
        .await
        .map(|client| client.dynamic())
        .map_err(|e| format!("Could not connect to the SSH agent (SSH_AUTH_SOCK): {e}"))
}

/// Connect to the local SSH agent at the platform endpoint: the OpenSSH
/// agent named pipe on Windows, which is what Bitwarden Desktop exposes.
/// The stream is boxed so every platform yields the same client type.
#[cfg(windows)]
async fn connect_ssh_agent() -> Result<AgentClient<Box<dyn AgentStream + Send + Unpin>>, String> {
    AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent")
        .await
        .map(|client| client.dynamic())
        .map_err(|e| {
            format!("Could not connect to the SSH agent (\\\\.\\pipe\\openssh-ssh-agent): {e}")
        })
}

#[cfg(not(any(unix, windows)))]
async fn connect_ssh_agent() -> Result<AgentClient<Box<dyn AgentStream + Send + Unpin>>, String> {
    Err("SSH agent authentication is not supported on this platform".to_string())
}

/// Authenticate with a key held by the local SSH agent. Tries each identity
/// the agent offers, in order, until the server accepts one — mirroring the
/// publickey rejection behaviour of `authenticate_publickey_smart` (a
/// rejected key with publickey still offered moves on to the next identity;
/// a partial success, or publickey no longer offered, stops immediately so
/// the keyboard-interactive fallback can proceed). The private key never
/// leaves the agent; it only signs the login challenge.
async fn authenticate_agent<H: russh::client::Handler>(
    handle: &mut russh::client::Handle<H>,
    username: &str,
) -> Result<russh::client::AuthResult, String> {
    let mut agent = connect_ssh_agent().await?;
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| format!("SSH agent error: {e}"))?;
    if identities.is_empty() {
        return Err("SSH agent has no identities (is the key unlocked in the agent?)".to_string());
    }

    // Rejected outright = no partial success and the server still offers
    // publickey. Anything else means the key was accepted or publickey is
    // off the table, so stop trying further identities.
    let key_rejected = |r: &AuthResult| {
        matches!(r, AuthResult::Failure { remaining_methods, partial_success: false } if remaining_methods.contains(&MethodKind::PublicKey))
    };

    let mut last_failure: Option<AuthResult> = None;
    for identity in &identities {
        // Same RSA hash negotiation as `authenticate_publickey_smart`.
        let is_rsa = identity.public_key().algorithm().is_rsa();
        let best_hash = if is_rsa {
            match handle.best_supported_rsa_hash().await {
                Ok(Some(hash)) => hash,
                _ => Some(HashAlg::Sha512),
            }
        } else {
            None
        };

        let res = match identity {
            AgentIdentity::PublicKey { key, .. } => {
                handle
                    .authenticate_publickey_with(username, key.clone(), best_hash, &mut agent)
                    .await
            }
            AgentIdentity::Certificate { certificate, .. } => {
                handle
                    .authenticate_certificate_with(username, certificate.clone(), best_hash, &mut agent)
                    .await
            }
        };

        match res {
            Ok(AuthResult::Success) => return Ok(AuthResult::Success),
            Ok(r) => {
                if !key_rejected(&r) {
                    return Ok(r);
                }
                last_failure = Some(r);
            }
            Err(_) => {
                // The agent declined to sign with this identity: try the
                // next one. A broken agent connection surfaces here too;
                // trying the next identity is harmless and keeps the
                // behaviour uniform.
                continue;
            }
        }
    }

    match last_failure {
        Some(r) => Ok(r),
        None => Err("SSH agent declined to sign with every identity it holds".to_string()),
    }
}

/// Keyboard-interactive prompts waiting for the user's answers, keyed by request id.
/// Process-wide because terminal, SFTP and tunnel connections all share one dialog.
static PENDING_AUTH_PROMPTS: LazyLock<
    std::sync::Mutex<HashMap<String, oneshot::Sender<Option<Vec<String>>>>>,
> = LazyLock::new(Default::default);

/// How long a connection waits for the user to answer a password/OTP prompt.
const AUTH_PROMPT_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, Serialize)]
pub struct AuthPromptField {
    pub prompt: String,
    pub echo: bool,
}

/// Emitted as `ssh-auth-prompt` when the server asks keyboard-interactive
/// questions (e.g. PAM password + Google Authenticator verification code).
#[derive(Debug, Clone, Serialize)]
pub struct AuthPromptPayload {
    pub request_id: String,
    pub target: String,
    pub name: String,
    pub instructions: String,
    pub prompts: Vec<AuthPromptField>,
}

/// Delivers the user's answers (`None` = cancelled) to a pending prompt.
pub fn answer_auth_prompt(request_id: &str, responses: Option<Vec<String>>) -> Result<(), String> {
    let tx = PENDING_AUTH_PROMPTS
        .lock()
        .unwrap()
        .remove(request_id)
        .ok_or_else(|| "Authentication prompt has expired".to_string())?;
    let _ = tx.send(responses);
    Ok(())
}

async fn ask_auth_prompt(app: &AppHandle, payload: AuthPromptPayload) -> Result<Vec<String>, String> {
    let (tx, rx) = oneshot::channel();
    let id = payload.request_id.clone();
    PENDING_AUTH_PROMPTS.lock().unwrap().insert(id.clone(), tx);

    if let Err(e) = app.emit("ssh-auth-prompt", payload) {
        PENDING_AUTH_PROMPTS.lock().unwrap().remove(&id);
        return Err(format!("Could not show authentication prompt: {e}"));
    }

    let res = tokio::time::timeout(AUTH_PROMPT_TIMEOUT, rx).await;
    PENDING_AUTH_PROMPTS.lock().unwrap().remove(&id);
    match res {
        Ok(Ok(Some(responses))) => Ok(responses),
        Ok(_) => Err("Authentication cancelled".to_string()),
        Err(_) => {
            let _ = app.emit("ssh-auth-prompt-closed", &id);
            Err("Timed out waiting for authentication input".to_string())
        }
    }
}

/// Full client authentication: the host's configured method (password or
/// private key), then keyboard-interactive when the server still requires it —
/// e.g. `AuthenticationMethods publickey,keyboard-interactive` with PAM asking
/// for a password and/or a Google Authenticator code. Prompts are answered by
/// the user through the frontend dialog; a stored host password auto-answers
/// the first password prompt. `app = None` never prompts (background probes).
/// On rejection the error names the failed step (key, password, or OTP code).
pub async fn authenticate<H: Handler>(
    handle: &mut Handle<H>,
    app: Option<&AppHandle>,
    target: &str,
    username: &str,
    auth: &SshAuth,
) -> Result<(), String> {
    let first = match auth {
        SshAuth::Password(password) => handle
            .authenticate_password(username, password)
            .await
            .map_err(|e| format!("Auth error: {e}"))?,
        SshAuth::PrivateKey { pem, passphrase } => {
            let key_pair = decode_secret_key(pem, passphrase.as_deref())
                .map_err(|e| format!("Invalid private key: {e}"))?;
            authenticate_publickey_smart(handle, username, key_pair).await?
        }
        SshAuth::Agent => authenticate_agent(handle, username).await?,
    };

    let (remaining, partial_success) = match first {
        AuthResult::Success => return Ok(()),
        AuthResult::Failure { remaining_methods, partial_success } => (remaining_methods, partial_success),
    };
    let primary_rejected = match auth {
        SshAuth::Password(_) if partial_success => {
            "Password accepted, but the server requires another authentication method".to_string()
        }
        SshAuth::Password(_) => "Password rejected by server".to_string(),
        SshAuth::PrivateKey { .. } if partial_success => {
            "SSH key accepted, but the server requires another authentication method".to_string()
        }
        SshAuth::PrivateKey { .. } => {
            "SSH key rejected by server (is its public key in authorized_keys?)".to_string()
        }
        SshAuth::Agent if partial_success => {
            "SSH agent key accepted, but the server requires another authentication method"
                .to_string()
        }
        SshAuth::Agent => {
            "SSH agent key rejected by server (is its public key in authorized_keys?)".to_string()
        }
    };
    let Some(app) = app else { return Err(primary_rejected) };
    if !remaining.contains(&MethodKind::KeyboardInteractive) {
        return Err(primary_rejected);
    }

    let mut stored_password = match auth {
        SshAuth::Password(p) => Some(p.clone()),
        SshAuth::PrivateKey { .. } => None,
        SshAuth::Agent => None,
    };
    let kbd_err = |e: russh::Error| format!("Keyboard-interactive auth error: {e}");
    let mut reply = handle
        .authenticate_keyboard_interactive_start(username, None::<String>)
        .await
        .map_err(kbd_err)?;

    // Prompt text of the last question answered; PAM never says which step failed,
    // so the failure is attributed to the step it happened right after.
    let mut last_prompt: Option<String> = None;
    loop {
        let (name, instructions, prompts) = match reply {
            KeyboardInteractiveAuthResponse::Success => return Ok(()),
            KeyboardInteractiveAuthResponse::Failure { .. } => {
                return Err(kbd_failure_message(last_prompt.as_deref()))
            }
            KeyboardInteractiveAuthResponse::InfoRequest { name, instructions, prompts } => {
                (name, instructions, prompts)
            }
        };

        let is_password_prompt =
            prompts.len() == 1 && !prompts[0].echo && is_password_text(&prompts[0].prompt);
        if let Some(p) = prompts.last() {
            last_prompt = Some(p.prompt.clone());
        }

        let responses = if prompts.is_empty() {
            Vec::new()
        } else if let Some(pw) = stored_password.take_if(|_| is_password_prompt) {
            vec![pw]
        } else {
            ask_auth_prompt(
                app,
                AuthPromptPayload {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    target: target.to_string(),
                    name,
                    instructions,
                    prompts: prompts
                        .into_iter()
                        .map(|p| AuthPromptField { prompt: p.prompt, echo: p.echo })
                        .collect(),
                },
            )
            .await?
        };

        reply = handle
            .authenticate_keyboard_interactive_respond(responses)
            .await
            .map_err(kbd_err)?;
    }
}

fn is_password_text(prompt: &str) -> bool {
    prompt.to_lowercase().contains("password")
}

/// Human-readable reason for a keyboard-interactive rejection, based on the
/// last prompt answered (e.g. "Password: " or "Verification code: ").
fn kbd_failure_message(last_prompt: Option<&str>) -> String {
    let Some(prompt) = last_prompt else {
        return "Keyboard-interactive authentication rejected by server".to_string();
    };
    let lower = prompt.to_lowercase();
    if is_password_text(&lower) {
        "Password rejected by server".to_string()
    } else if ["verification", "code", "otp", "token", "2fa"].iter().any(|k| lower.contains(k)) {
        "Two-factor verification code rejected by server (wrong or expired code)".to_string()
    } else {
        format!("Server rejected the answer to \"{}\"", prompt.trim())
    }
}

pub struct SshSession {
    pub id: String,
    handle: Handle<SshClientHandler>,
    cmd_tx: mpsc::UnboundedSender<SessionCommand>,
    _jump_handle: Option<Handle<SshClientHandler>>,
}

pub struct SessionManager {
    sessions: RwLock<HashMap<String, Arc<SshSession>>>,
    connecting: Mutex<HashSet<String>>,
    /// Session ids whose connect is in flight but whose tab was already closed.
    /// `disconnect()` marks them here so the running `do_connect` aborts at its
    /// next checkpoint instead of leaving a zombie connection behind.
    cancelled: Mutex<HashSet<String>>,
}

impl SessionManager {
    pub fn new() -> Self {
        SessionManager {
            sessions: RwLock::new(HashMap::new()),
            connecting: Mutex::new(HashSet::new()),
            cancelled: Mutex::new(HashSet::new()),
        }
    }

    pub async fn connect(
        &self,
        app: AppHandle,
        db: Arc<Database>,
        session_id: String,
        host_id: Option<String>,
        address: String,
        port: u16,
        username: String,
        auth: SshAuth,
        cols: u16,
        rows: u16,
        jump_host: Option<JumpHostConfig>,
    ) -> Result<(), String> {
        // Prevent duplicate concurrent connection attempts for the exact same session_id
        {
            let mut connecting = self.connecting.lock().await;
            if connecting.contains(&session_id) {
                return Err("Connection already in progress for this session".to_string());
            }
            connecting.insert(session_id.clone());
        }

        // Fresh attempt (e.g. Retry after a cancelled connect): drop any stale
        // cancel mark left behind by a previous aborted attempt for this id.
        {
            let mut cancelled = self.cancelled.lock().await;
            cancelled.remove(&session_id);
        }

        // Clean up any stale existing session with this ID before starting fresh
        {
            let mut sessions = self.sessions.write().await;
            if let Some(old_session) = sessions.remove(&session_id) {
                let _ = old_session.handle.disconnect(Disconnect::ByApplication, "", "en").await;
                if let Some(ref jump) = old_session._jump_handle {
                    let _ = jump.disconnect(Disconnect::ByApplication, "", "en").await;
                }
            }
        }

        let res = self
            .do_connect(app, db, session_id.clone(), host_id, address, port, username, auth, cols, rows, jump_host)
            .await;

        {
            let mut connecting = self.connecting.lock().await;
            connecting.remove(&session_id);
        }

        // A cancel can land in the gap between the last checkpoint inside
        // do_connect and the session being registered in the map. If so, the
        // session was fully established for a tab that no longer exists —
        // close it immediately instead of leaking the connection.
        let was_cancelled = {
            let mut cancelled = self.cancelled.lock().await;
            cancelled.remove(&session_id)
        };
        match res {
            Ok(()) if was_cancelled => {
                let _ = self.disconnect(&session_id).await;
                Err("Connection cancelled".to_string())
            }
            other => other,
        }
    }

    /// Returns `Err` when the tab for this session was closed while the
    /// connect was still in flight (`disconnect()` marked it as cancelled).
    async fn check_cancelled(&self, session_id: &str) -> Result<(), String> {
        if self.cancelled.lock().await.contains(session_id) {
            Err("Connection cancelled".to_string())
        } else {
            Ok(())
        }
    }

    async fn do_connect(
        &self,
        app: AppHandle,
        db: Arc<Database>,
        session_id: String,
        host_id: Option<String>,
        address: String,
        port: u16,
        username: String,
        auth: SshAuth,
        cols: u16,
        rows: u16,
        jump_host: Option<JumpHostConfig>,
    ) -> Result<(), String> {
        self.check_cancelled(&session_id).await?;

        let progress_event = format!("ssh-progress-{session_id}");
        let emit_progress = |step: u8, step_name: &str, message: &str, is_error: bool| {
            let _ = app.emit(
                &progress_event,
                SshProgressPayload {
                    step,
                    step_name: step_name.to_string(),
                    message: message.to_string(),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    is_error,
                },
            );
        };

        let has_jump = jump_host.is_some();

        // ── 1. Establish Transport Stream (Direct TCP or via Jump Host ProxyJump) ──
        let (socket, jump_handle) = if let Some(jump) = jump_host {
            emit_progress(1, "connecting", &format!("Connecting to Bastion / Jump Host {}:{}...", jump.address, jump.port), false);

            let jump_tcp = match tokio::net::TcpStream::connect((jump.address.as_str(), jump.port)).await {
                Ok(s) => {
                    configure_tcp_stream(&s);
                    s
                }
                Err(e) => {
                    let msg = format!("Failed to reach Jump Host {}:{}: {e}", jump.address, jump.port);
                    emit_progress(1, "error", &msg, true);
                    return Err(msg);
                }
            };

            self.check_cancelled(&session_id).await?;

            let jump_config = default_client_config();
            let jump_handler = SshClientHandler {
                address: jump.address.clone(),
                port: jump.port,
                db: db.clone(),
                forwarded_tcpip: None,
            };

            let mut j_handle = match client::connect_stream(jump_config, jump_tcp, jump_handler).await {
                Ok(h) => h,
                Err(e) => {
                    let msg = format!("Jump Host handshake failed: {e}");
                    emit_progress(1, "error", &msg, true);
                    return Err(msg);
                }
            };

            self.check_cancelled(&session_id).await?;

            emit_progress(1, "authenticating", &format!("Authenticating to Jump Host as {}...", jump.username), false);

            let jump_target = format!("{}@{}", jump.username, jump.address);
            if let Err(e) = authenticate(&mut j_handle, Some(&app), &jump_target, &jump.username, &jump.auth).await {
                let msg = format!("Jump Host: {e}");
                emit_progress(1, "error", &msg, true);
                return Err(msg);
            }

            self.check_cancelled(&session_id).await?;

            emit_progress(1, "connecting", &format!("Tunneling via Jump Host to {address}:{port}..."), false);

            let channel = match j_handle.channel_open_direct_tcpip(
                address.clone(),
                port as u32,
                "127.0.0.1".to_string(),
                0,
            ).await {
                Ok(c) => c,
                Err(e) => {
                    let msg = format!("Failed to open tunnel through Jump Host to {address}:{port}: {e}");
                    emit_progress(1, "error", &msg, true);
                    return Err(msg);
                }
            };

            self.check_cancelled(&session_id).await?;

            (SshStream::Tunneled(channel.into_stream()), Some(j_handle))
        } else {
            emit_progress(1, "connecting", &format!("Resolving and connecting to {address}:{port}..."), false);

            let s = match tokio::net::TcpStream::connect((address.as_str(), port)).await {
                Ok(s) => {
                    configure_tcp_stream(&s);
                    s
                }
                Err(e) => {
                    let msg = format!("Connection failed: {e}");
                    emit_progress(1, "error", &msg, true);
                    return Err(msg);
                }
            };
            self.check_cancelled(&session_id).await?;

            (SshStream::Direct(s), None)
        };

        // ── 2. Target SSH Handshake over the stream ──
        let config = default_client_config();
        let handler = SshClientHandler {
            address: address.clone(),
            port,
            db: db.clone(),
            forwarded_tcpip: None,
        };

        let mut handle = match client::connect_stream(config, socket, handler).await {
            Ok(h) => h,
            Err(e) => {
                let msg = format!("Connection to target failed: {e}");
                emit_progress(1, "error", &msg, true);
                return Err(msg);
            }
        };

        self.check_cancelled(&session_id).await?;

        emit_progress(2, "host_key", "Verifying target host key (Trust On First Use)...", false);

        emit_progress(3, "authenticating", &format!("Authenticating as {username}..."), false);

        let target = format!("{username}@{address}");
        if let Err(msg) = authenticate(&mut handle, Some(&app), &target, &username, &auth).await {
            emit_progress(3, "error", &msg, true);
            return Err(msg);
        }

        self.check_cancelled(&session_id).await?;

        emit_progress(4, "opening_channel", "Opening shell channel...", false);

        let channel = match handle.channel_open_session().await {
            Ok(c) => c,
            Err(e) => {
                let msg = format!("Channel open failed: {e}");
                emit_progress(4, "error", &msg, true);
                return Err(msg);
            }
        };

        self.check_cancelled(&session_id).await?;

        if let Err(e) = channel
            .request_pty(true, "xterm-256color", cols as u32, rows as u32, 0, 0, &[])
            .await
        {
            let msg = format!("PTY request failed: {e}");
            emit_progress(4, "error", &msg, true);
            return Err(msg);
        }

        if let Err(e) = channel.request_shell(true).await {
            let msg = format!("Shell request failed: {e}");
            emit_progress(4, "error", &msg, true);
            return Err(msg);
        }

        // Last checkpoint before registration: past this point the session is
        // live in the map, so a late cancel is handled by the connect() wrapper.
        self.check_cancelled(&session_id).await?;

        emit_progress(5, "ready", "Shell session ready.", false);

        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<SessionCommand>();

        let session = Arc::new(SshSession {
            id: session_id.clone(),
            handle,
            cmd_tx,
            _jump_handle: jump_handle,
        });

        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session_id.clone(), session.clone());
        }

        let event_name = format!("ssh-data-{session_id}");
        let closed_event = format!("ssh-closed-{session_id}");
        let app_for_output = app.clone();
        let sid_for_output = session_id.clone();

        // Worker task: stream server output to frontend & handle incoming commands (write & resize)
        tokio::spawn(async move {
            let mut channel = channel;
            // Adaptive output coalescing:
            // 1. When the channel is idle (interactive keystroke echo, prompt display),
            //    emit immediately (0ms latency) and start a short cooldown timer.
            // 2. Any subsequent bursts of output arriving within the cooldown (e.g. cat,
            //    htop, build logs) are accumulated into `pending` and emitted in ~8ms batches
            //    (or at 64KB cap) to prevent saturating Tauri's IPC event bridge.
            let mut pending: Vec<u8> = Vec::new();
            let flush_delay = tokio::time::Duration::from_millis(8);
            let mut flush_deadline: Option<tokio::time::Instant> = None;

            loop {
                let sleep = async {
                    match flush_deadline {
                        Some(deadline) => tokio::time::sleep_until(deadline).await,
                        None => std::future::pending::<()>().await,
                    }
                };

                tokio::select! {
                    msg = channel.wait() => {
                        match msg {
                            Some(russh::ChannelMsg::Data { ref data }) => {
                                match flush_deadline {
                                    None => {
                                        // Idle stream: emit interactive echo immediately (0ms delay)
                                        let _ = app_for_output.emit(&event_name, data.to_vec());
                                        flush_deadline = Some(tokio::time::Instant::now() + flush_delay);
                                    }
                                    Some(_) => {
                                        pending.extend_from_slice(data);
                                        if pending.len() >= 64 * 1024 {
                                            let _ = app_for_output.emit(&event_name, std::mem::take(&mut pending));
                                            flush_deadline = None;
                                        }
                                    }
                                }
                            }
                            Some(russh::ChannelMsg::ExtendedData { ref data, .. }) => {
                                match flush_deadline {
                                    None => {
                                        let _ = app_for_output.emit(&event_name, data.to_vec());
                                        flush_deadline = Some(tokio::time::Instant::now() + flush_delay);
                                    }
                                    Some(_) => {
                                        pending.extend_from_slice(data);
                                        if pending.len() >= 64 * 1024 {
                                            let _ = app_for_output.emit(&event_name, std::mem::take(&mut pending));
                                            flush_deadline = None;
                                        }
                                    }
                                }
                            }
                            Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => {
                                if !pending.is_empty() {
                                    let _ = app_for_output.emit(&event_name, std::mem::take(&mut pending));
                                }
                                let _ = app_for_output.emit(&closed_event, sid_for_output.clone());
                                break;
                            }
                            _ => {}
                        }
                    }
                    _ = sleep => {
                        if !pending.is_empty() {
                            let _ = app_for_output.emit(&event_name, std::mem::take(&mut pending));
                        }
                        flush_deadline = None;
                    }
                    cmd = cmd_rx.recv() => {
                        match cmd {
                            Some(SessionCommand::Data(data)) => {
                                let _ = channel.data(&data[..]).await;
                            }
                            Some(SessionCommand::Resize { cols, rows }) => {
                                // Safeguard: Ignore 0 or near-zero window sizes caused by hidden DOM elements
                                if cols >= 15 && rows >= 4 {
                                    let _ = channel.window_change(cols, rows, 0, 0).await;
                                }
                            }
                            None => break,
                        }
                    }
                }
            }
        });

        // Spawn OS detection in the background via a separate exec channel.
        // Only runs when host_id is provided and not proxied via a jump host
        // (targets behind a bastion are on private subnets, unreachable directly).
        // Fires-and-forgets: any failure is silently ignored — it never
        // affects the primary PTY channel or the session itself.
        if let Some(hid) = host_id {
            if !has_jump {
                let app_for_os = app.clone();
                let db_for_os = db.clone();
                let addr_for_os = address.clone();
                let port_for_os = port;
                let user_for_os = username.clone();
                let auth_for_os = auth.clone();
                tokio::spawn(async move {
                    // Small delay so the interactive shell can fully initialise
                    // before we open a second channel (avoids race conditions on
                    // slower servers).
                    tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;
                    detect_os_via_exec(
                        &app_for_os,
                        db_for_os,
                        addr_for_os,
                        port_for_os,
                        user_for_os,
                        auth_for_os,
                        hid,
                    )
                    .await;
                });
            }
        }

        Ok(())
    }

    pub async fn write(&self, session_id: &str, data: Vec<u8>) -> Result<(), String> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| "Session not found".to_string())?;
        session
            .cmd_tx
            .send(SessionCommand::Data(data))
            .map_err(|e| format!("Failed to send input: {e}"))
    }

    pub async fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| "Session not found".to_string())?;
        session
            .cmd_tx
            .send(SessionCommand::Resize {
                cols: cols as u32,
                rows: rows as u32,
            })
            .map_err(|e| format!("Failed to send resize: {e}"))
    }

    pub async fn disconnect(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.remove(session_id) {
            let _ = session
                .handle
                .disconnect(Disconnect::ByApplication, "", "en")
                .await;
            // Close the bastion connection too (mirrors the stale-session
            // cleanup in connect()), instead of relying on drop alone.
            if let Some(ref jump) = session._jump_handle {
                let _ = jump.disconnect(Disconnect::ByApplication, "", "en").await;
            }
        } else if self.connecting.lock().await.contains(session_id) {
            // No registered session, but a connect is in flight for this id —
            // the tab was closed mid-connect. Mark it so do_connect aborts at
            // its next checkpoint (and so a session established in the gap
            // between checkpoints is caught by connect()'s final check).
            self.cancelled.lock().await.insert(session_id.to_string());
        }
        Ok(())
    }

    /// Runs `command` on a fresh exec channel multiplexed over an already
    /// established (and therefore already host-key-verified) session, and
    /// returns its stdout. Never touches the interactive PTY channel, so nothing
    /// shows up in the user's terminal. Output is capped at `max_bytes`.
    pub async fn exec_capture(
        &self,
        session_id: &str,
        command: &str,
        timeout: Duration,
        max_bytes: usize,
    ) -> Result<String, String> {
        let session = {
            let sessions = self.sessions.read().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| "Session not found".to_string())?
        };

        let deadline = tokio::time::Instant::now() + timeout;

        let mut channel = tokio::time::timeout_at(deadline, session.handle.channel_open_session())
            .await
            .map_err(|_| "Remote command timed out".to_string())?
            .map_err(|e| format!("Failed to open exec channel: {e}"))?;

        // Only the exec + read loop runs under the deadline, so the channel is
        // always closed below — even on timeout. A leaked channel would count
        // against the server's MaxSessions until the whole connection drops.
        let run = async {
            channel
                .exec(true, command)
                .await
                .map_err(|e| format!("Failed to exec: {e}"))?;

            let mut output: Vec<u8> = Vec::new();
            loop {
                match channel.wait().await {
                    Some(russh::ChannelMsg::Data { ref data }) => {
                        output.extend_from_slice(data);
                        if output.len() >= max_bytes {
                            output.truncate(max_bytes);
                            break;
                        }
                    }
                    // The server refused the exec request (want_reply=true).
                    Some(russh::ChannelMsg::Failure) => {
                        return Err("Remote host rejected the exec request".to_string());
                    }
                    Some(russh::ChannelMsg::Eof)
                    | Some(russh::ChannelMsg::Close)
                    | None => break,
                    _ => {}
                }
            }
            Ok::<String, String>(String::from_utf8_lossy(&output).into_owned())
        };

        let result = tokio::time::timeout_at(deadline, run)
            .await
            .map_err(|_| "Remote command timed out".to_string())
            .and_then(|r| r);

        let _ = tokio::time::timeout(Duration::from_secs(2), channel.close()).await;
        result
    }

    /// Disconnects every live SSH session. Used for a clean shutdown when the
    /// application exits, so servers see a proper SSH disconnect message
    /// instead of a dropped TCP socket.
    pub async fn disconnect_all(&self) {
        let ids: Vec<String> = {
            let sessions = self.sessions.read().await;
            sessions.keys().cloned().collect()
        };
        for id in ids {
            let _ = self.disconnect(&id).await;
        }
    }
}

/// Parse the output of `cat /etc/os-release` and map it to one of our
/// canonical distro slugs, which the frontend uses to pick an icon.
/// Returns `None` when OS detection fails or the output is unrecognisable.
pub fn parse_os_release(output: &str) -> Option<String> {
    // Extract the value of a KEY="value" or KEY=value line.
    let get = |key: &str| -> Option<String> {
        output.lines().find_map(|line| {
            let line = line.trim();
            let prefix = format!("{key}=");
            if line.starts_with(&prefix) {
                let val = line[prefix.len()..].trim_matches('"').to_lowercase();
                Some(val)
            } else {
                None
            }
        })
    };

    // Prefer ID_LIKE (parent distro), fall back to ID.
    let id = get("ID").unwrap_or_default();
    let id_like = get("ID_LIKE").unwrap_or_default();
    let pretty = get("PRETTY_NAME").unwrap_or_default();
    let name = get("NAME").unwrap_or_default();

    let combined = format!("{id} {id_like} {pretty} {name}");

    if combined.contains("ubuntu") {
        Some("ubuntu".to_string())
    } else if combined.contains("kali") {
        Some("kali".to_string())
    } else if combined.contains("mint") {
        Some("mint".to_string())
    } else if combined.contains("pop!_os") || combined.contains("pop_os") || combined.contains("popos") {
        Some("popos".to_string())
    } else if combined.contains("elementary") {
        Some("elementary".to_string())
    } else if combined.contains("debian") {
        Some("debian".to_string())
    } else if combined.contains("alpine") {
        Some("alpine".to_string())
    } else if combined.contains("arch") || combined.contains("manjaro") || combined.contains("endeavouros") || combined.contains("endeavour") {
        if combined.contains("manjaro") {
            Some("manjaro".to_string())
        } else if combined.contains("endeavouros") || combined.contains("endeavour") {
            Some("endeavour".to_string())
        } else {
            Some("arch".to_string())
        }
    } else if combined.contains("fedora") {
        Some("fedora".to_string())
    } else if combined.contains("rocky") {
        Some("rocky".to_string())
    } else if combined.contains("almalinux") || combined.contains("alma") {
        Some("almalinux".to_string())
    } else if combined.contains("centos") {
        Some("centos".to_string())
    } else if combined.contains("rhel") || combined.contains("red hat") || combined.contains("redhat") {
        Some("rhel".to_string())
    } else if combined.contains("opensuse") || combined.contains("suse") {
        Some("opensuse".to_string())
    } else if combined.contains("gentoo") {
        Some("gentoo".to_string())
    } else if combined.contains("nixos") {
        Some("nixos".to_string())
    } else if combined.contains("void") {
        Some("void".to_string())
    } else if combined.contains("raspbian") || combined.contains("raspberry") {
        Some("raspbian".to_string())
    } else if combined.contains("slackware") {
        Some("slackware".to_string())
    } else if combined.contains("amazon") || combined.contains("amzn") {
        Some("amazon".to_string())
    } else if !id.is_empty() {
        // Known to be Linux (has /etc/os-release) but distro unrecognised
        Some("linux".to_string())
    } else {
        None
    }
}

/// Open a fresh exec channel (not reusing the interactive PTY) and run
/// `cat /etc/os-release`.  Returns the detected distro slug, or `None`
/// on any failure — this never propagates errors to the caller.
pub async fn detect_os_via_exec(
    app: &AppHandle,
    db: Arc<Database>,
    address: String,
    port: u16,
    username: String,
    auth: SshAuth,
    host_id: String,
) {
    let result: Result<Option<String>, String> = async {
        let config = default_client_config();
        let handler = SshClientHandler {
            address: address.clone(),
            port,
            db: db.clone(),
            forwarded_tcpip: None,
        };
        let mut handle = russh::client::connect(config, (address.as_str(), port), handler)
            .await
            .map_err(|e| e.to_string())?;

        // No prompting: a background probe must never pop a 2FA dialog.
        if authenticate(&mut handle, None, "", &username, &auth).await.is_err() {
            return Ok(None);
        }

        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| e.to_string())?;
        channel
            .exec(true, "cat /etc/os-release")
            .await
            .map_err(|e| e.to_string())?;

        let mut output = String::new();
        let mut ch = channel;
        loop {
            match ch.wait().await {
                Some(russh::ChannelMsg::Data { ref data }) => {
                    output.push_str(&String::from_utf8_lossy(data));
                    if output.len() > 8192 {
                        break;
                    }
                }
                Some(russh::ChannelMsg::Eof)
                | Some(russh::ChannelMsg::Close)
                | None => break,
                _ => {}
            }
        }
        let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
        Ok(parse_os_release(&output))
    }
    .await;

    if let Ok(Some(slug)) = result {
        if let Ok(()) = db.update_host_os_icon(&host_id, &slug) {
            let _ = app.emit(
                "host-os-detected",
                serde_json::json!({ "host_id": host_id, "os_icon": slug }),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use tokio::io::{AsyncRead, AsyncWrite};

    fn _assert_stream<T: AsyncRead + AsyncWrite + Unpin + Send + 'static>() {}

    #[test]
    fn test_channel_into_stream_trait() {
        _assert_stream::<russh::ChannelStream<russh::client::Msg>>();
    }

    #[test]
    fn test_kbd_failure_message_names_failed_step() {
        use super::kbd_failure_message as msg;
        assert_eq!(msg(Some("Password: ")), "Password rejected by server");
        assert!(msg(Some("Verification code: ")).starts_with("Two-factor verification code rejected"));
        assert!(msg(Some("Enter OTP:")).starts_with("Two-factor"));
        assert_eq!(msg(Some("Favourite colour? ")), "Server rejected the answer to \"Favourite colour?\"");
        assert_eq!(msg(None), "Keyboard-interactive authentication rejected by server");
    }

    #[test]
    fn test_answer_auth_prompt_delivers_once() {
        let (tx, mut rx) = tokio::sync::oneshot::channel();
        super::PENDING_AUTH_PROMPTS.lock().unwrap().insert("req-1".into(), tx);

        super::answer_auth_prompt("req-1", Some(vec!["123456".into()])).unwrap();
        assert_eq!(rx.try_recv().unwrap(), Some(vec!["123456".to_string()]));
        // A second answer (or an unknown id) must not be accepted.
        assert!(super::answer_auth_prompt("req-1", None).is_err());
    }
}
