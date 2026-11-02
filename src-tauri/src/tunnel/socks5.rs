use std::net::SocketAddr;
use std::sync::Arc;
use russh::client::Handle;
use russh::ChannelMsg;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;

use crate::ssh::SshClientHandler;

// SOCKS5 Protocol constants (RFC 1928)
pub const SOCKS_VERSION: u8 = 0x05;
pub const AUTH_METHOD_NONE: u8 = 0x00;
pub const AUTH_METHOD_NO_ACCEPTABLE: u8 = 0xFF;

pub const CMD_CONNECT: u8 = 0x01;

pub const ATYP_IPV4: u8 = 0x01;
pub const ATYP_DOMAIN: u8 = 0x03;
pub const ATYP_IPV6: u8 = 0x04;

pub const REP_SUCCESS: u8 = 0x00;
pub const REP_GENERAL_FAILURE: u8 = 0x01;
pub const REP_CMD_NOT_SUPPORTED: u8 = 0x07;
pub const REP_ADDR_TYPE_NOT_SUPPORTED: u8 = 0x08;

#[derive(Debug, PartialEq, Eq)]
pub struct Socks5Target {
    pub host: String,
    pub port: u16,
}

/// Negotiate authentication with the client (requires NO AUTHENTICATION REQUIRED).
pub async fn negotiate_auth<S: AsyncRead + AsyncWrite + Unpin>(
    stream: &mut S,
) -> Result<(), String> {
    let mut initial = [0u8; 2];
    stream
        .read_exact(&mut initial)
        .await
        .map_err(|e| format!("Failed to read SOCKS5 greeting: {e}"))?;

    let version = initial[0];
    let nmethods = initial[1] as usize;

    if version != SOCKS_VERSION {
        return Err(format!("Unsupported SOCKS version: {version}"));
    }

    let mut methods = vec![0u8; nmethods];
    stream
        .read_exact(&mut methods)
        .await
        .map_err(|e| format!("Failed to read SOCKS5 methods: {e}"))?;

    if !methods.contains(&AUTH_METHOD_NONE) {
        let _ = stream.write_all(&[SOCKS_VERSION, AUTH_METHOD_NO_ACCEPTABLE]).await;
        return Err("No acceptable auth method offered by client".to_string());
    }

    // Acknowledge NO AUTHENTICATION REQUIRED
    stream
        .write_all(&[SOCKS_VERSION, AUTH_METHOD_NONE])
        .await
        .map_err(|e| format!("Failed to write SOCKS5 greeting reply: {e}"))?;

    Ok(())
}

/// Parse the SOCKS5 CONNECT request and extract target host & port.
pub async fn parse_connect_request<S: AsyncRead + AsyncWrite + Unpin>(
    stream: &mut S,
) -> Result<Socks5Target, String> {
    let mut req_header = [0u8; 4];
    stream
        .read_exact(&mut req_header)
        .await
        .map_err(|e| format!("Failed to read SOCKS5 request header: {e}"))?;

    let req_version = req_header[0];
    let cmd = req_header[1];
    let atyp = req_header[3];

    if req_version != SOCKS_VERSION {
        return Err(format!("Invalid request version: {req_version}"));
    }

    if cmd != CMD_CONNECT {
        let _ = stream
            .write_all(&[SOCKS_VERSION, REP_CMD_NOT_SUPPORTED, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0])
            .await;
        return Err(format!("Unsupported SOCKS5 command: {cmd}"));
    }

    let target_host = match atyp {
        ATYP_IPV4 => {
            let mut ip_buf = [0u8; 4];
            stream
                .read_exact(&mut ip_buf)
                .await
                .map_err(|e| format!("Failed to read IPv4 destination: {e}"))?;
            std::net::Ipv4Addr::from(ip_buf).to_string()
        }
        ATYP_DOMAIN => {
            let mut len_buf = [0u8; 1];
            stream
                .read_exact(&mut len_buf)
                .await
                .map_err(|e| format!("Failed to read domain length: {e}"))?;
            let domain_len = len_buf[0] as usize;
            let mut domain_buf = vec![0u8; domain_len];
            stream
                .read_exact(&mut domain_buf)
                .await
                .map_err(|e| format!("Failed to read domain name: {e}"))?;
            String::from_utf8(domain_buf)
                .map_err(|_| "Target domain name is not valid UTF-8".to_string())?
        }
        ATYP_IPV6 => {
            let mut ip_buf = [0u8; 16];
            stream
                .read_exact(&mut ip_buf)
                .await
                .map_err(|e| format!("Failed to read IPv6 destination: {e}"))?;
            std::net::Ipv6Addr::from(ip_buf).to_string()
        }
        other => {
            let _ = stream
                .write_all(&[SOCKS_VERSION, REP_ADDR_TYPE_NOT_SUPPORTED, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0])
                .await;
            return Err(format!("Unsupported SOCKS5 address type: {other}"));
        }
    };

    let mut port_buf = [0u8; 2];
    stream
        .read_exact(&mut port_buf)
        .await
        .map_err(|e| format!("Failed to read destination port: {e}"))?;
    let target_port = u16::from_be_bytes(port_buf);

    Ok(Socks5Target {
        host: target_host,
        port: target_port,
    })
}

/// Handle a single incoming SOCKS5 client connection.
pub async fn handle_socks5_client(
    handle: Arc<Handle<SshClientHandler>>,
    mut stream: TcpStream,
    peer_addr: SocketAddr,
) -> Result<(), String> {
    let _ = stream.set_nodelay(true);

    // ── 1. Handshake (Method Selection) ──────────────────────────────────────
    negotiate_auth(&mut stream).await?;

    // ── 2. Request Parsing ───────────────────────────────────────────────────
    let target = parse_connect_request(&mut stream).await?;

    // ── 3. Open SSH direct-tcpip channel ────────────────────────────────────
    let originator_ip = peer_addr.ip().to_string();
    let originator_port = peer_addr.port() as u32;

    let mut channel = match handle
        .channel_open_direct_tcpip(
            target.host.clone(),
            target.port as u32,
            originator_ip,
            originator_port,
        )
        .await
    {
        Ok(c) => c,
        Err(e) => {
            let _ = stream
                .write_all(&[SOCKS_VERSION, REP_GENERAL_FAILURE, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0])
                .await;
            return Err(format!(
                "Failed to open SSH direct-tcpip channel to {}:{}: {e}",
                target.host, target.port
            ));
        }
    };

    // ── 4. Send SOCKS5 Success Response ──────────────────────────────────────
    let success_response = [
        SOCKS_VERSION,
        REP_SUCCESS,
        0x00,       // RSV
        ATYP_IPV4,  // ATYP IPv4
        0, 0, 0, 0, // BND.ADDR
        0, 0,       // BND.PORT
    ];

    stream
        .write_all(&success_response)
        .await
        .map_err(|e| format!("Failed to send SOCKS5 success reply: {e}"))?;

    // ── 5. Bidirectional Relay ───────────────────────────────────────────────
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    struct MockStream {
        input: Cursor<Vec<u8>>,
        output: Vec<u8>,
    }

    impl MockStream {
        fn new(data: Vec<u8>) -> Self {
            MockStream {
                input: Cursor::new(data),
                output: Vec::new(),
            }
        }
    }

    impl AsyncRead for MockStream {
        fn poll_read(
            mut self: std::pin::Pin<&mut Self>,
            cx: &mut std::task::Context<'_>,
            buf: &mut tokio::io::ReadBuf<'_>,
        ) -> std::task::Poll<std::io::Result<()>> {
            std::pin::Pin::new(&mut self.input).poll_read(cx, buf)
        }
    }

    impl AsyncWrite for MockStream {
        fn poll_write(
            mut self: std::pin::Pin<&mut Self>,
            _cx: &mut std::task::Context<'_>,
            buf: &[u8],
        ) -> std::task::Poll<std::io::Result<usize>> {
            self.output.extend_from_slice(buf);
            std::task::Poll::Ready(Ok(buf.len()))
        }

        fn poll_flush(
            self: std::pin::Pin<&mut Self>,
            _cx: &mut std::task::Context<'_>,
        ) -> std::task::Poll<std::io::Result<()>> {
            std::task::Poll::Ready(Ok(()))
        }

        fn poll_shutdown(
            self: std::pin::Pin<&mut Self>,
            _cx: &mut std::task::Context<'_>,
        ) -> std::task::Poll<std::io::Result<()>> {
            std::task::Poll::Ready(Ok(()))
        }
    }

    #[tokio::test]
    async fn test_auth_negotiation_success() {
        // VER=5, NMETHODS=2, METHODS=[0x02 (User/Pass), 0x00 (None)]
        let mut stream = MockStream::new(vec![0x05, 0x02, 0x02, 0x00]);
        let result = negotiate_auth(&mut stream).await;
        assert!(result.is_ok());
        assert_eq!(stream.output, vec![0x05, 0x00]);
    }

    #[tokio::test]
    async fn test_auth_negotiation_failure() {
        // VER=5, NMETHODS=1, METHODS=[0x02 (Only User/Pass, no 0x00)]
        let mut stream = MockStream::new(vec![0x05, 0x01, 0x02]);
        let result = negotiate_auth(&mut stream).await;
        assert!(result.is_err());
        assert_eq!(stream.output, vec![0x05, 0xFF]);
    }

    #[tokio::test]
    async fn test_parse_connect_ipv4() {
        // VER=5, CMD=1, RSV=0, ATYP=1 (IPv4), IP=192.168.1.100, PORT=8080 (0x1F90)
        let data = vec![
            0x05, 0x01, 0x00, 0x01,
            192, 168, 1, 100,
            0x1F, 0x90,
        ];
        let mut stream = MockStream::new(data);
        let target = parse_connect_request(&mut stream).await.unwrap();
        assert_eq!(target.host, "192.168.1.100");
        assert_eq!(target.port, 8080);
    }

    #[tokio::test]
    async fn test_parse_connect_domain() {
        // VER=5, CMD=1, RSV=0, ATYP=3 (Domain), LEN=10, "google.com", PORT=443 (0x01BB)
        let mut data = vec![0x05, 0x01, 0x00, 0x03, 10];
        data.extend_from_slice(b"google.com");
        data.extend_from_slice(&[0x01, 0xBB]);

        let mut stream = MockStream::new(data);
        let target = parse_connect_request(&mut stream).await.unwrap();
        assert_eq!(target.host, "google.com");
        assert_eq!(target.port, 443);
    }

    #[tokio::test]
    async fn test_parse_connect_unsupported_cmd() {
        // VER=5, CMD=2 (BIND, not CONNECT), RSV=0, ATYP=1...
        let data = vec![0x05, 0x02, 0x00, 0x01, 127, 0, 0, 1, 0x00, 0x50];
        let mut stream = MockStream::new(data);
        let result = parse_connect_request(&mut stream).await;
        assert!(result.is_err());
        assert_eq!(stream.output[1], REP_CMD_NOT_SUPPORTED);
    }
}
