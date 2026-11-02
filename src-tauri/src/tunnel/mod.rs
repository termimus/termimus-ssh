pub mod socks5;

use russh::client::{self, Handle};
use russh::keys::decode_secret_key;
use russh::ChannelMsg;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Mutex};

use crate::db::Database;
use crate::ssh::{SshAuth, SshClientHandler};

pub struct ActiveTunnel {
    pub rule_id: String,
    stop_tx: oneshot::Sender<()>,
}

pub struct TunnelManager {
    active: Mutex<HashMap<String, ActiveTunnel>>,
}

impl TunnelManager {
    pub fn new() -> Self {
        TunnelManager {
            active: Mutex::new(HashMap::new()),
        }
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

        let handle = connect_ssh(db, &address, port, &username, auth).await?;

        let bind_addr = format!("{local_address}:{local_port}");
        let listener = TcpListener::bind(&bind_addr)
            .await
            .map_err(|e| format!("Failed to bind {bind_addr}: {e}"))?;

        let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
        let handle = Arc::new(handle);
        let status_event = format!("tunnel-status-{rule_id}");
        let app_for_status = app.clone();
        let rule_id_for_task = rule_id.clone();

        tokio::spawn(async move {
            let _ = app_for_status.emit(&status_event, "started");
            loop {
                tokio::select! {
                    _ = &mut stop_rx => {
                        break;
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
                                break;
                            }
                        }
                    }
                }
            }
            let _ = app_for_status.emit(&format!("tunnel-status-{rule_id_for_task}"), "stopped");
        });

        let mut active = self.active.lock().await;
        active.insert(rule_id.clone(), ActiveTunnel { rule_id, stop_tx });

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

        let handle = connect_ssh(db, &address, port, &username, auth).await?;

        let bind_addr = format!("{local_address}:{local_port}");
        let listener = TcpListener::bind(&bind_addr)
            .await
            .map_err(|e| format!("Failed to bind {bind_addr}: {e}"))?;

        let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
        let handle = Arc::new(handle);
        let status_event = format!("tunnel-status-{rule_id}");
        let app_for_status = app.clone();
        let rule_id_for_task = rule_id.clone();

        tokio::spawn(async move {
            let _ = app_for_status.emit(&status_event, "started");
            loop {
                tokio::select! {
                    _ = &mut stop_rx => {
                        break;
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
                                break;
                            }
                        }
                    }
                }
            }
            let _ = app_for_status.emit(&format!("tunnel-status-{rule_id_for_task}"), "stopped");
        });

        let mut active = self.active.lock().await;
        active.insert(rule_id.clone(), ActiveTunnel { rule_id, stop_tx });

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

async fn connect_ssh(
    db: Arc<Database>,
    address: &str,
    port: u16,
    username: &str,
    auth: SshAuth,
) -> Result<Handle<SshClientHandler>, String> {
    let config = crate::ssh::default_client_config();
    let handler = SshClientHandler {
        address: address.to_string(),
        port,
        db,
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

    let authenticated = match auth {
        SshAuth::Password(password) => handle
            .authenticate_password(username, &password)
            .await
            .map_err(|e| format!("Auth error: {e}"))?,
        SshAuth::PrivateKey { pem, passphrase } => {
            let key_pair = decode_secret_key(&pem, passphrase.as_deref())
                .map_err(|e| format!("Invalid private key: {e}"))?;
            crate::ssh::authenticate_publickey_smart(&mut handle, username, key_pair).await?
        }
    };

    if !authenticated.success() {
        return Err("Authentication rejected by server".to_string());
    }

    Ok(handle)
}

async fn forward_connection(
    handle: Arc<Handle<SshClientHandler>>,
    mut stream: TcpStream,
    remote_address: String,
    remote_port: u16,
    originator_ip: String,
    originator_port: u32,
) -> Result<(), String> {
    let _ = stream.set_nodelay(true);
    let mut channel = handle
        .channel_open_direct_tcpip(remote_address, remote_port as u32, originator_ip, originator_port)
        .await
        .map_err(|e| format!("Failed to open direct-tcpip channel: {e}"))?;

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

    Ok(())
}
