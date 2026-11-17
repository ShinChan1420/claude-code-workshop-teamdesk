// One Durable Object that fans a "bookings changed" ping out to every open
// browser. No booking data travels over the socket: clients refetch over tRPC.
// It uses the hibernation API, so idle sockets cost nothing while it sleeps.
import { DurableObject } from "cloudflare:workers";

export class BookingsHub extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/notify") {
      const { roomId } = await request.json<{ roomId?: unknown }>();
      if (typeof roomId !== "string") {
        return new Response("roomId required", { status: 400 });
      }
      this.broadcast(roomId);
      return new Response(null, { status: 204 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }

    // biome-ignore lint/correctness/noUndeclaredVariables: WebSocketPair is a workerd global, typed by worker-configuration.d.ts
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(roomId: string): void {
    const message = JSON.stringify({ roomId, type: "bookings.changed" });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // A socket that died mid-send is cleaned up by the runtime.
      }
    }
  }

  // Clients only listen, but a close frame still needs answering.
  override webSocketClose(ws: WebSocket, code: number): void {
    ws.close(code, "closed");
  }
}
