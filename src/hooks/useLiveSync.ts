import { useEffect, useRef } from "react";
import { useSyncStore } from "../stores/useSyncStore";
import { parseSyncEvents } from "../lib/syncEvents";

/**
 * Root-level hook that maintains a continuous WebSocket connection
 * with the self-hosted sync relay server whenever autoSync is enabled.
 * Listens for remote SYNC_UPDATED events and automatically pulls & merges changes.
 */
export function useLiveSync() {
  const autoSync = useSyncStore((s) => s.autoSync);
  const serverUrl = useSyncStore((s) => s.serverUrl);
  const authToken = useSyncStore((s) => s.authToken);
  const getDeviceId = useSyncStore((s) => s.getDeviceId);
  const pull = useSyncStore((s) => s.pull);

  const pullRef = useRef(pull);
  pullRef.current = pull;

  useEffect(() => {
    if (!autoSync || !serverUrl) return;

    const cleanUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!cleanUrl) return;

    let wsUrl = cleanUrl.replace(/^http/, "ws");
    if (authToken) {
      wsUrl += `/api/v1/sync/ws?token=${encodeURIComponent(authToken)}`;
    } else {
      wsUrl += `/api/v1/sync/ws`;
    }

    let socket: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isDisposed = false;

    function connect() {
      if (isDisposed) return;

      try {
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
          useSyncStore.setState({ syncStatus: "connected", lastError: null });
        };

        socket.onmessage = async (event) => {
          if (typeof event.data !== "string") return;
          // A message may carry several events (older relays batch them);
          // non-JSON control messages yield no events.
          const myDeviceId = getDeviceId();
          const remoteUpdate = parseSyncEvents(event.data).some((data) => {
            if (!data || typeof data !== "object") return false;
            const { type, device_id } = data as { type?: unknown; device_id?: unknown };
            // Ignore broadcasts originating from this device itself
            return type === "SYNC_UPDATED" && !(device_id && device_id === myDeviceId);
          });
          if (remoteUpdate) {
            // One pull fetches the latest state, however many updates arrived.
            await pullRef.current().catch(() => {
              // Error is already tracked in store
            });
          }
        };

        socket.onclose = () => {
          if (!isDisposed && autoSync) {
            reconnectTimeout = setTimeout(connect, 5000);
          }
        };

        socket.onerror = () => {
          socket?.close();
        };
      } catch {
        // Connection attempt failed, retry
        if (!isDisposed && autoSync) {
          reconnectTimeout = setTimeout(connect, 5000);
        }
      }
    }

    connect();

    return () => {
      isDisposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    };
  }, [autoSync, serverUrl, authToken, getDeviceId]);
}
