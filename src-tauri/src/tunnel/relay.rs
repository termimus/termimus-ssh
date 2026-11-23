//! Bidirectional byte relay between a local TCP stream and an SSH channel,
//! shared by local, remote and SOCKS5 forwarding.
//!
//! EOF is a half-close: it only means that side has finished *sending*. Each
//! direction is therefore tracked separately, and the relay ends only when
//! both directions are done (or either side fully closes / errors).

use russh::client;
use russh::{Channel, ChannelMsg};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// The parts of an SSH channel the relay needs. Exists so the relay logic can
/// be unit-tested with an in-memory channel.
pub(crate) trait RelayChannel {
    async fn send_data(&mut self, data: &[u8]) -> bool;
    async fn send_eof(&mut self);
    async fn recv(&mut self) -> Option<ChannelMsg>;
    async fn close(&mut self);
}

impl RelayChannel for Channel<client::Msg> {
    async fn send_data(&mut self, data: &[u8]) -> bool {
        self.data(data).await.is_ok()
    }
    async fn send_eof(&mut self) {
        let _ = self.eof().await;
    }
    async fn recv(&mut self) -> Option<ChannelMsg> {
        self.wait().await
    }
    async fn close(&mut self) {
        let _ = Channel::close(self).await;
    }
}

/// Shuttle bytes in both directions until both have reached EOF, either side
/// closes, or an I/O error occurs. Always closes the channel on exit.
pub(crate) async fn relay<S, C>(mut stream: S, mut channel: C)
where
    S: AsyncRead + AsyncWrite + Unpin,
    C: RelayChannel,
{
    let mut buf = vec![0u8; 32 * 1024];
    // Local side finished sending (we forwarded EOF to the channel).
    let mut local_eof = false;
    // Remote side finished sending (we shut down the stream's write half).
    let mut remote_eof = false;

    while !(local_eof && remote_eof) {
        tokio::select! {
            read_result = stream.read(&mut buf), if !local_eof => {
                match read_result {
                    Ok(0) => {
                        local_eof = true;
                        channel.send_eof().await;
                    }
                    Ok(n) => {
                        if !channel.send_data(&buf[..n]).await {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            msg = channel.recv() => {
                match msg {
                    Some(ChannelMsg::Data { ref data }) if !remote_eof => {
                        if stream.write_all(data).await.is_err() {
                            break;
                        }
                    }
                    Some(ChannelMsg::Eof) if !remote_eof => {
                        remote_eof = true;
                        // Propagate the half-close as a TCP FIN; keep reading
                        // from the local side.
                        if stream.shutdown().await.is_err() {
                            break;
                        }
                    }
                    Some(ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
        }
    }

    channel.close().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;
    use tokio::sync::mpsc;

    #[derive(Debug, PartialEq)]
    enum Sent {
        Data(Vec<u8>),
        Eof,
        Close,
    }

    struct MockChannel {
        incoming: mpsc::UnboundedReceiver<ChannelMsg>,
        sent: mpsc::UnboundedSender<Sent>,
    }

    impl RelayChannel for MockChannel {
        async fn send_data(&mut self, data: &[u8]) -> bool {
            self.sent.send(Sent::Data(data.to_vec())).is_ok()
        }
        async fn send_eof(&mut self) {
            let _ = self.sent.send(Sent::Eof);
        }
        async fn recv(&mut self) -> Option<ChannelMsg> {
            self.incoming.recv().await
        }
        async fn close(&mut self) {
            let _ = self.sent.send(Sent::Close);
        }
    }

    fn mock() -> (
        MockChannel,
        mpsc::UnboundedSender<ChannelMsg>,
        mpsc::UnboundedReceiver<Sent>,
    ) {
        let (in_tx, in_rx) = mpsc::unbounded_channel();
        let (out_tx, out_rx) = mpsc::unbounded_channel();
        (MockChannel { incoming: in_rx, sent: out_tx }, in_tx, out_rx)
    }

    async fn with_timeout<T>(f: impl std::future::Future<Output = T>) -> T {
        tokio::time::timeout(std::time::Duration::from_secs(2), f)
            .await
            .expect("timed out")
    }

    /// Regression for #61: the remote sends HELLO then EOF but keeps
    /// reading; the local client must still be able to send ACK.
    #[tokio::test]
    async fn remote_eof_keeps_local_to_remote_open() {
        let (channel, to_relay, mut from_relay) = mock();
        let (mut client, relay_side) = duplex(1024);
        let task = tokio::spawn(relay(relay_side, channel));

        to_relay.send(ChannelMsg::Data { data: b"HELLO".to_vec().into() }).unwrap();
        to_relay.send(ChannelMsg::Eof).unwrap();

        // Client sees HELLO followed by EOF.
        let mut got = Vec::new();
        with_timeout(client.read_to_end(&mut got)).await.unwrap();
        assert_eq!(got, b"HELLO");

        // ...and can still send ACK through the half-open connection.
        client.write_all(b"ACK").await.unwrap();
        assert_eq!(with_timeout(from_relay.recv()).await, Some(Sent::Data(b"ACK".to_vec())));

        // Closing the client's sending half finishes the relay.
        client.shutdown().await.unwrap();
        assert_eq!(with_timeout(from_relay.recv()).await, Some(Sent::Eof));
        assert_eq!(with_timeout(from_relay.recv()).await, Some(Sent::Close));
        with_timeout(task).await.unwrap();
    }

    /// Mirror case: local EOF must not stop data flowing back from remote.
    #[tokio::test]
    async fn local_eof_keeps_remote_to_local_open() {
        let (channel, to_relay, mut from_relay) = mock();
        let (mut client, relay_side) = duplex(1024);
        let task = tokio::spawn(relay(relay_side, channel));

        client.shutdown().await.unwrap();
        assert_eq!(with_timeout(from_relay.recv()).await, Some(Sent::Eof));

        to_relay.send(ChannelMsg::Data { data: b"REPLY".to_vec().into() }).unwrap();
        to_relay.send(ChannelMsg::Eof).unwrap();

        let mut got = Vec::new();
        with_timeout(client.read_to_end(&mut got)).await.unwrap();
        assert_eq!(got, b"REPLY");
        assert_eq!(with_timeout(from_relay.recv()).await, Some(Sent::Close));
        with_timeout(task).await.unwrap();
    }

    /// A full Close from the remote still tears down both directions.
    #[tokio::test]
    async fn remote_close_ends_relay() {
        let (channel, to_relay, mut from_relay) = mock();
        let (_client, relay_side) = duplex(1024);
        let task = tokio::spawn(relay(relay_side, channel));

        to_relay.send(ChannelMsg::Close).unwrap();
        assert_eq!(with_timeout(from_relay.recv()).await, Some(Sent::Close));
        with_timeout(task).await.unwrap();
    }
}
