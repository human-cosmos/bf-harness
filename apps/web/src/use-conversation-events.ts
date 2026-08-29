import { useEffect, useState } from "react";

export interface ConversationWebSocketEvent {
  type: string;
  taskId?: string;
  scope?: {
    kind: "task" | "conversation";
    id: string;
  };
  payload?: Record<string, unknown>;
  emittedAt: string;
}

export function useConversationEvents(conversationId?: string) {
  const [events, setEvents] = useState<ConversationWebSocketEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    if (!conversationId) return;
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

      socket.addEventListener("message", (message) => {
        try {
          const event = JSON.parse(message.data) as ConversationWebSocketEvent;
          if (
            event.scope?.kind === "conversation" &&
            event.scope.id === conversationId
          ) {
            setEvents((current) => [...current.slice(-199), event]);
          }
        } catch {
          // Ignore malformed frames.
        }
      });
    }

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [conversationId]);

  return { connected, reconnecting, events };
}
