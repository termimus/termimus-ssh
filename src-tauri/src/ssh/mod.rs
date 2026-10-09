use russh::client::{self, Handle, Handler};
use russh::keys::ssh_key::HashAlg;
use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg};
use russh::Disconnect;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex, RwLock};

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
}

impl Handler for SshClientHandler {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = format!("{}", server_public_key.fingerprint(HashAlg::Sha256));
        let key_type = server_public_key.algorithm().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let existing = self.db.get_known_host(&self.address, self.port).ok().flatten();

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
                let _ = self.db.save_known_host(&entry);
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

    if !res.success() && is_rsa {
        for fallback in [Some(HashAlg::Sha256), Some(HashAlg::Sha512), None] {
            if fallback == best_hash {
                continue;
            }
            let key = PrivateKeyWithHashAlg::new(Arc::new(key_pair.clone()), fallback);
            if let Ok(r) = handle.authenticate_publickey(username, key).await {
                if r.success() {
                    res = r;
                    break;
                }
            }
        }
    }

    Ok(res)
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

            let j_authenticated = match &jump.auth {
                SshAuth::Password(password) => match j_handle.authenticate_password(&jump.username, password).await {
                    Ok(r) => r.success(),
                    Err(e) => {
                        let msg = format!("Jump Host auth error: {e}");
                        emit_progress(1, "error", &msg, true);
                        return Err(msg);
                    }
                },
                SshAuth::PrivateKey { pem, passphrase } => {
                    let key_pair = match decode_secret_key(pem, passphrase.as_deref()) {
                        Ok(k) => k,
                        Err(e) => {
                            let msg = format!("Invalid Jump Host private key: {e}");
                            emit_progress(1, "error", &msg, true);
                            return Err(msg);
                        }
                    };
                    match authenticate_publickey_smart(&mut j_handle, &jump.username, key_pair).await {
                        Ok(r) => r.success(),
                        Err(msg) => {
                            emit_progress(1, "error", &msg, true);
                            return Err(msg);
                        }
                    }
                }
            };

            if !j_authenticated {
                let msg = "Jump Host authentication rejected by server".to_string();
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

        let authenticated = match &auth {
            SshAuth::Password(password) => match handle.authenticate_password(&username, password).await {
                Ok(r) => r,
                Err(e) => {
                    let msg = format!("Auth error: {e}");
                    emit_progress(3, "error", &msg, true);
                    return Err(msg);
                }
            },
            SshAuth::PrivateKey { pem, passphrase } => {
                let key_pair = match decode_secret_key(pem, passphrase.as_deref()) {
                    Ok(k) => k,
                    Err(e) => {
                        let msg = format!("Invalid private key: {e}");
                        emit_progress(3, "error", &msg, true);
                        return Err(msg);
                    }
                };
                match authenticate_publickey_smart(&mut handle, &username, key_pair).await {
                    Ok(r) => r,
                    Err(msg) => {
                        emit_progress(3, "error", &msg, true);
                        return Err(msg);
                    }
                }
            }
        };

        if !authenticated.success() {
            let msg = "Authentication rejected by server".to_string();
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
        };
        let mut handle = russh::client::connect(config, (address.as_str(), port), handler)
            .await
            .map_err(|e| e.to_string())?;

        let authenticated = match auth {
            SshAuth::Password(password) => handle
                .authenticate_password(&username, &password)
                .await
                .map_err(|e| e.to_string())?,
            SshAuth::PrivateKey { pem, passphrase } => {
                let key_pair = russh::keys::decode_secret_key(&pem, passphrase.as_deref())
                    .map_err(|e| e.to_string())?;
                authenticate_publickey_smart(&mut handle, &username, key_pair)
                    .await
                    .map_err(|e| e.to_string())?
            }
        };

        if !authenticated.success() {
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
}
