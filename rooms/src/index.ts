// The co-op room server. Each room is one Durable Object that passes every
// message from a player to the room's other players. Messages are opaque to it,
// except that a player names their number once they have one, so a dropped
// connection can still be announced as that player leaving.
import { DurableObject } from "cloudflare:workers";

import { allowedOrigin } from "./origin";

type Env = {
  ROOMS: DurableObjectNamespace<Room>;
  ALLOWED_ORIGINS: string;
};

type Attachment = { peer: number | null };

const hostPeer = 1;
const maxSockets = 8;
const roomPath = /^\/rooms\/([a-z0-9]{6,32})$/;

function identifiedPeer(message: string) {
  if (!message.startsWith('{"type":"identify"')) return null;
  try {
    const { peer } = JSON.parse(message) as { peer: unknown };
    return Number.isInteger(peer) && (peer as number) > 0
      ? (peer as number)
      : null;
  } catch {
    return null;
  }
}

class Room extends DurableObject<Env> {
  fetch() {
    if (this.ctx.getWebSockets().length >= maxSockets) {
      return new Response("This room is full.", { status: 409 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ peer: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const peer = typeof message === "string" ? identifiedPeer(message) : null;
    if (peer !== null) {
      socket.serializeAttachment({ peer } satisfies Attachment);
      return;
    }
    this.broadcast(socket, message);
  }

  webSocketClose(socket: WebSocket) {
    this.left(socket);
  }

  webSocketError(socket: WebSocket) {
    this.left(socket);
  }

  private left(socket: WebSocket) {
    const { peer } = socket.deserializeAttachment() as Attachment;
    socket.serializeAttachment({ peer: null } satisfies Attachment);
    try {
      socket.close();
    } catch {
      // The socket may already be closed.
    }
    if (peer === null) return;
    this.broadcast(
      socket,
      JSON.stringify(
        peer === hostPeer ? { type: "close" } : { type: "leave", peer },
      ),
    );
  }

  private broadcast(from: WebSocket, message: string | ArrayBuffer) {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === from) continue;
      try {
        socket.send(message);
      } catch {
        // A closing socket gets its own close event.
      }
    }
  }
}

export default {
  fetch(request, env) {
    const match = roomPath.exec(new URL(request.url).pathname);
    if (!match) return new Response("Not found.", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket.", { status: 426 });
    }
    if (
      !allowedOrigin(request.headers.get("Origin") ?? "", env.ALLOWED_ORIGINS)
    ) {
      return new Response("Forbidden.", { status: 403 });
    }
    return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
  },
} satisfies ExportedHandler<Env>;

export { Room };
