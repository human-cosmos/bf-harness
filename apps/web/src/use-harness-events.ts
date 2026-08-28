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

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/ws`);

    socket.addEventListener("open", () => setConnected(true));
    socket.addEventListener("close", () => setConnected(false));
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

    return () => socket.close();
  }, [taskId]);

  return { connected, events };
}
