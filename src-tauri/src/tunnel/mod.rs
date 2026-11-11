pub mod socks5;

use russh::client::{self, Handle};
use russh::{Channel, ChannelMsg, Disconnect};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::db::Database;
use crate::ssh::{ForwardedTcpip, SshAuth, SshClientHandler};

pub struct ActiveTunnel {
    stop_tx: oneshot::Sender<()>,
    /// Identifies this particular run, so a finished task never removes the
    /// entry of a newer run that was started for the same rule.
    token: u64,
}

type ActiveMap = Arc<Mutex<HashMap<String, ActiveTunnel>>>;

pub struct TunnelManager {
    active: ActiveMap,
    next_token: AtomicU64,
}

/// Held by a running tunnel task; `release` removes the task's own entry
/// from the active map when the task ends on its own (SSH connection lost,
/// listener error), so the UI stops showing a dead tunnel as running.
struct Registration {
    active: ActiveMap,
    rule_id: String,
    token: u64,
}

impl Registration {
    async fn release(self) {
        let mut active = self.active.lock().await;
        if active.get(&self.rule_id).is_some_and(|t| t.token == self.token) {
            active.remove(&self.rule_id);
        }
    }
}

impl TunnelManager {
    pub fn new() -> Self {
        TunnelManager {
            active: Arc::new(Mutex::new(HashMap::new())),
            next_token: AtomicU64::new(0),
        }
    }

    /// Mark a rule as running. Done before the task is spawned so a task that
    /// exits immediately can still deregister itself.
    async fn register(&self, rule_id: &str) -> Result<(oneshot::Receiver<()>, Registration), String> {
        let mut active = self.active.lock().await;
        if active.contains_key(rule_id) {
            return Err("Tunnel is already running".to_string());
        }
        let (stop_tx, stop_rx) = oneshot::channel();
        let token = self.next_token.fetch_add(1, Ordering::Relaxed);
        active.insert(rule_id.to_string(), ActiveTunnel { stop_tx, token });
        Ok((
            stop_rx,
            Registration {
                active: self.active.clone(),
                rule_id: rule_id.to_string(),
                token,
            },
        ))
    }

    pub async fn is_active(&self, rule_id: &str) -> bool {
        self.active.lock().await.contains_key(rule_id)
    }

    pub async fn list_active(&self) -> Vec<String> {
        self.active.lock().await.keys().cloned().collect()
    }

    /// Start a local port forward: listen on local_address:local_port, and for
    /// every incoming TCP connection, open a direct-tcpip channel to
    /// remote_address:remote_port on the far side of the SSH connection.
    pub async fn start_local_forward(
        &self,
        app: AppHandle,
        db: Arc<Database>,
        rule_id: String,
        address: String,
        port: u16,
        username: String,
        auth: SshAuth,
        local_address: String,
        local_port: u16,
        remote_address: String,
        remote_port: u16,
    ) -> Result<(), String> {
        {
            let active = self.active.lock().await;
            if active.contains_key(&rule_id) {
                return Err("Tunnel is already running".to_string());
            }
        }

        let handle = connect_ssh(&app, db, &address, port, &username, auth, None).await?;

        let bind_addr = format!("{local_address}:{local_port}");
        let listener = TcpListener::bind(&bind_addr)
            .await
            .map_err(|e| format!("Failed to bind {bind_addr}: {e}"))?;

        let (mut stop_rx, registration) = self.register(&rule_id).await?;
        let handle = Arc::new(handle);
        let status_event = format!("tunnel-status-{rule_id}");
        let app_for_status = app.clone();
        let rule_id_for_task = rule_id.clone();

        tokio::spawn(async move {
            let _ = app_for_status.emit(&status_event, "started");
            let ssh_closed = wait_ssh_closed(handle.clone());
            tokio::pin!(ssh_closed);
            let unexpected = loop {
                tokio::select! {
                    _ = &mut stop_rx => {
                        break false;
                    }
                    _ = &mut ssh_closed => {
                        eprintln!("Tunnel SSH connection lost; closing local listener");
                        break true;
                    }
                    accept_result = listener.accept() => {
                        match accept_result {
                            Ok((stream, peer_addr)) => {
                                let handle = handle.clone();
                                let remote_address = remote_address.clone();
                                let originator_ip = peer_addr.ip().to_string();
                                let originator_port = peer_addr.port() as u32;
                                tokio::spawn(async move {
                                    if let Err(e) = forward_connection(
                                        handle,
                                        stream,
                                        remote_address,
                                        remote_port,
                                        originator_ip,
                                        originator_port,
                                    ).await {
                                        eprintln!("Tunnel forwarding error: {e}");
                                    }
                                });
                            }
                            Err(e) => {
                                eprintln!("Tunnel accept error: {e}");
                                break true;
                            }
                        }
                    }
                }
            };
            let _ = app_for_status.emit(&format!("tunnel-status-{rule_id_for_task}"), "stopped");
            registration.release().await;
            notify_tunnel_ended(&app_for_status, &rule_id_for_task, unexpected);
        });

        Ok(())
    }

    /// Start dynamic SOCKS5 forwarding: listen on local_address:local_port as a SOCKS5 proxy server.
    /// Each incoming connection's requested destination host and port are dynamically
    /// forwarded via SSH direct-tcpip through the remote SSH host.
    pub async fn start_dynamic_forward(
        &self,
        app: AppHandle,
        db: Arc<Database>,
        rule_id: String,
        address: String,
        port: u16,
        username: String,
        auth: SshAuth,
        local_address: String,
        local_port: u16,
    ) -> Result<(), String> {
        {
            let active = self.active.lock().await;
            if active.contains_key(&rule_id) {
                return Err("Tunnel is already running".to_string());
            }
        }

        let handle = connect_ssh(&app, db, &address, port, &username, auth, None).await?;

        let bind_addr = format!("{local_address}:{local_port}");
        let listener = TcpListener::bind(&bind_addr)
            .await
            .map_err(|e| format!("Failed to bind {bind_addr}: {e}"))?;

        let (mut stop_rx, registration) = self.register(&rule_id).await?;
        let handle = Arc::new(handle);
        let status_event = format!("tunnel-status-{rule_id}");
        let app_for_status = app.clone();
        let rule_id_for_task = rule_id.clone();

        tokio::spawn(async move {
            let _ = app_for_status.emit(&status_event, "started");
            let ssh_closed = wait_ssh_closed(handle.clone());
            tokio::pin!(ssh_closed);
            let unexpected = loop {
                tokio::select! {
                    _ = &mut stop_rx => {
                        break false;
                    }
                    _ = &mut ssh_closed => {
                        eprintln!("Tunnel SSH connection lost; closing local listener");
                        break true;
                    }
                    accept_result = listener.accept() => {
                        match accept_result {
                            Ok((stream, peer_addr)) => {
                                let handle = handle.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = socks5::handle_socks5_client(
                                        handle,
                                        stream,
                                        peer_addr,
                                    ).await {
                                        eprintln!("SOCKS5 tunnel error: {e}");
                                    }
                                });
                            }
                            Err(e) => {
                                eprintln!("SOCKS5 listener accept error: {e}");
                                break true;
                            }
                        }
                    }
                }
            };
            let _ = app_for_status.emit(&format!("tunnel-status-{rule_id_for_task}"), "stopped");
            registration.release().await;
            notify_tunnel_ended(&app_for_status, &rule_id_for_task, unexpected);
        });

        Ok(())
    }

    /// Start a remote port forward (-R): ask the SSH server to listen on
    /// bind_address:bind_port, and for every connection it accepts there,
    /// dial destination_address:destination_port from this machine and pipe
    /// the two together.
    pub async fn start_remote_forward(
        &self,
        app: AppHandle,
        db: Arc<Database>,
        rule_id: String,
        address: String,
        port: u16,
        username: String,
        auth: SshAuth,
        bind_address: String,
        bind_port: u16,
        destination_address: String,
        destination_port: u16,
    ) -> Result<(), String> {
        {
            let active = self.active.lock().await;
            if active.contains_key(&rule_id) {
                return Err("Tunnel is already running".to_string());
            }
        }

        let (forward_tx, mut forward_rx) = mpsc::unbounded_channel::<ForwardedTcpip>();
        let handle =
            connect_ssh(&app, db, &address, port, &username, auth, Some(forward_tx)).await?;

        handle
            .tcpip_forward(bind_address.clone(), bind_port as u32)
            .await
            .map_err(|e| {
                format!(
                    "Server refused to listen on {bind_address}:{bind_port}: {e}. \
                     Check that the port is free and AllowTcpForwarding is enabled in sshd_config \
                     (binding to a non-loopback address also requires GatewayPorts)."
                )
            })?;

        let (mut stop_rx, registration) = self.register(&rule_id).await?;
        let status_event = format!("tunnel-status-{rule_id}");
        let app_for_status = app.clone();
        let rule_id_for_task = rule_id.clone();

        tokio::spawn(async move {
            let _ = app_for_status.emit(&status_event, "started");
            let unexpected = loop {
                tokio::select! {
                    _ = &mut stop_rx => {
                        let _ = handle.cancel_tcpip_forward(bind_address.clone(), bind_port as u32).await;
                        let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
                        break false;
                    }
                    incoming = forward_rx.recv() => {
                        // None means the SSH connection (and its handler) went away.
                        let Some(ForwardedTcpip { channel, originator_address, originator_port }) = incoming else {
                            break true;
                        };
                        let destination_address = destination_address.clone();
                        tokio::spawn(async move {
                            match TcpStream::connect((destination_address.as_str(), destination_port)).await {
                                Ok(stream) => pipe_channel(stream, channel).await,
                                Err(e) => {
                                    eprintln!(
                                        "Remote forward: failed to reach {destination_address}:{destination_port} \
                                         for {originator_address}:{originator_port}: {e}"
                                    );
                                    let _ = channel.close().await;
                                }
                            }
                        });
                    }
                }
            };
            let _ = app_for_status.emit(&status_event, "stopped");
            registration.release().await;
            notify_tunnel_ended(&app_for_status, &rule_id_for_task, unexpected);
        });

        Ok(())
    }

    pub async fn stop(&self, rule_id: &str) -> Result<(), String> {
        let mut active = self.active.lock().await;
        if let Some(tunnel) = active.remove(rule_id) {
            let _ = tunnel.stop_tx.send(());
        }
        Ok(())
    }
}

#[derive(Clone, serde::Serialize)]
struct TunnelEndedPayload<'a> {
    rule_id: &'a str,
    /// true when the tunnel died on its own (SSH connection lost, listener
    /// error) rather than being stopped by the user.
    unexpected: bool,
}

/// Global event so the frontend can re-sync its active-tunnel list after a
/// task ends, including when nobody clicked Stop.
fn notify_tunnel_ended(app: &AppHandle, rule_id: &str, unexpected: bool) {
    let _ = app.emit("tunnel-ended", TunnelEndedPayload { rule_id, unexpected });
}

/// Resolves once the SSH session behind `handle` has ended (server
/// disconnect, keepalive timeout, network loss). russh only exposes a
/// synchronous `is_closed()`, so poll it; 2s is plenty for UI status.
async fn wait_ssh_closed(handle: Arc<Handle<SshClientHandler>>) {
    let mut tick = tokio::time::interval(Duration::from_secs(2));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tick.tick().await;
        if handle.is_closed() {
            return;
        }
    }
}

async fn connect_ssh(
    app: &AppHandle,
    db: Arc<Database>,
    address: &str,
    port: u16,
    username: &str,
    auth: SshAuth,
    forwarded_tcpip: Option<mpsc::UnboundedSender<ForwardedTcpip>>,
) -> Result<Handle<SshClientHandler>, String> {
    let config = crate::ssh::default_client_config();
    let handler = SshClientHandler {
        address: address.to_string(),
        port,
        db,
        forwarded_tcpip,
    };
    let socket = match tokio::net::TcpStream::connect((address, port)).await {
        Ok(s) => {
            crate::ssh::configure_tcp_stream(&s);
            s
        }
        Err(e) => return Err(format!("Tunnel TCP connection failed: {e}")),
    };
    let mut handle = client::connect_stream(config, socket, handler)
        .await
        .map_err(|e| format!("Tunnel SSH connection failed: {e}"))?;

    let target = format!("{username}@{address}");
    crate::ssh::authenticate(&mut handle, Some(app), &target, username, &auth).await?;

    Ok(handle)
}

async fn forward_connection(
    handle: Arc<Handle<SshClientHandler>>,
    stream: TcpStream,
    remote_address: String,
    remote_port: u16,
    originator_ip: String,
    originator_port: u32,
) -> Result<(), String> {
    let channel = handle
        .channel_open_direct_tcpip(remote_address, remote_port as u32, originator_ip, originator_port)
        .await
        .map_err(|e| format!("Failed to open direct-tcpip channel: {e}"))?;

    pipe_channel(stream, channel).await;
    Ok(())
}

/// Shuttle bytes in both directions between a local TCP stream and an SSH
/// channel until either side closes.
async fn pipe_channel(mut stream: TcpStream, mut channel: Channel<client::Msg>) {
    let _ = stream.set_nodelay(true);
    let mut buf = vec![0u8; 32 * 1024];
    let mut stream_closed = false;

    loop {
        tokio::select! {
            read_result = stream.read(&mut buf), if !stream_closed => {
                match read_result {
                    Ok(0) => {
                        stream_closed = true;
                        let _ = channel.eof().await;
                    }
                    Ok(n) => {
                        if channel.data(&buf[..n]).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        if stream.write_all(data).await.is_err() {
                            break;
                        }
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    let _ = channel.close().await;
}
