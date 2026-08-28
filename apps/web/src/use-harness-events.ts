import { useEffect, useState } from "react";

export interface HarnessEvent {
  type: string;
  taskId?: string;
  payload?: unknown;
  emittedAt: string;
}

export function useHarnessEvents(taskId?: string) {
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/api/ws`);

      socket.addEventListener("open", () => {
        retryCount = 0;
        setConnected(true);
        setReconnecting(false);
      });

      socket.addEventListener("close", () => {
        if (disposed) return;
        setConnected(false);
        setReconnecting(true);
        const delay = Math.min(1000 * 2 ** retryCount, 15_000);
        retryCount += 1;
        retryTimer = setTimeout(connect, delay);
      });

      socket.addEventListener("error", () => {
        // The close handler owns reconnection to avoid duplicate attempts.
      });

      socket.addEventListener("message", (message) => {
        try {
          const event = JSON.parse(message.data) as HarnessEvent;
          if (!taskId || !event.taskId || event.taskId === taskId) {
            setEvents((current) => [...current.slice(-99), event]);
          }
        } catch {
          // Ignore non-JSON or malformed frames.
        }
      });
    }

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [taskId]);

  return { connected, reconnecting, events };
}
