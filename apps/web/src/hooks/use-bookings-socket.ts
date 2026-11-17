import { useEffect, useRef } from "react";

const RECONNECT_DELAY_MS = 2000;

/**
 * Listens on /api/ws for "bookings changed" pings and calls `onChange` with the
 * room that changed. The socket carries no booking data: refetch it yourself.
 * If the connection drops it reconnects once after two seconds.
 */
export function useBookingsSocket(onChange: (roomId: string) => void): void {
  // A ref keeps the socket open across renders when the callback changes.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = (canRetry: boolean) => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${scheme}://${window.location.host}/api/ws`);
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as {
            roomId?: unknown;
            type?: unknown;
          };
          if (
            message.type === "bookings.changed" &&
            typeof message.roomId === "string"
          ) {
            onChangeRef.current(message.roomId);
          }
        } catch {
          // Not one of our pings; ignore it.
        }
      };
      socket.onclose = () => {
        if (closed || !canRetry) {
          return;
        }
        timer = setTimeout(() => connect(false), RECONNECT_DELAY_MS);
      };
    };

    connect(true);

    return () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, []);
}
