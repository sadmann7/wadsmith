// The co-op room server. Each room is one Durable Object that passes every
// message from a player to the room's other players. Messages are opaque to it,
// except that a player names their number once they have one, so a dropped
// connection can still be announced as that player leaving. Under /maps, the
// same Worker keeps the online copies of maps.
import { DurableObject } from "cloudflare:workers";

import { ConnectionLimits } from "./limits";
import { MapCopy, type MapsEnv, routeMaps } from "./maps";
import { allowedOrigin } from "./origin";
import { Gallery, type PublishEnv, routePublished } from "./publish";

interface Env extends MapsEnv, PublishEnv {
  ROOMS: DurableObjectNamespace<Room>;
  ALLOWED_ORIGINS: string;
  ROOM_IDLE_SECONDS?: string;
  ROOM_LIFETIME_SECONDS?: string;
  ROOM_MESSAGES_PER_SECOND?: string;
}

interface Attachment {
  peer: number | null;
  seen: number;
}

const hostPeer = 1;
const maxSockets = 8;
// A quiet connection only records that it was active this often, so traffic
// doesn't rewrite its attachment on every message.
const seenEveryMs = 60_000;
const roomPath = /^\/rooms\/([a-z0-9]{6,32})$/;

class Room extends DurableObject<Env> {
  private readonly limits = new WeakMap<WebSocket, ConnectionLimits>();

  private get idleMs() {
    return Number(this.env.ROOM_IDLE_SECONDS ?? 30 * 60) * 1000;
  }

  private get lifetimeMs() {
    return Number(this.env.ROOM_LIFETIME_SECONDS ?? 8 * 60 * 60) * 1000;
  }

  async fetch() {
    if (this.ctx.getWebSockets().length >= maxSockets) {
      return new Response("This room is full.", { status: 409 });
    }
    const now = Date.now();
    if ((await this.ctx.storage.get<number>("opened")) === undefined) {
      await this.ctx.storage.put("opened", now);
    }
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(now + this.idleMs);
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ peer: null, seen: now } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const now = Date.now();
    let limits = this.limits.get(socket);
    if (!limits) {
      const perSecond = this.env.ROOM_MESSAGES_PER_SECOND;
      limits = new ConnectionLimits(
        now,
        perSecond === undefined ? undefined : Number(perSecond),
      );
      this.limits.set(socket, limits);
    }
    const verdict = limits.check(message, now);
    if (verdict === "close") {
      socket.close(1008, "Too much traffic.");
      this.left(socket);
      return;
    }
    if (verdict === "drop") return;
    const attachment = socket.deserializeAttachment() as Attachment;
    const peer = typeof message === "string" ? identifiedPeer(message) : null;
    if (
      peer !== null ||
      now - attachment.seen > Math.min(seenEveryMs, this.idleMs / 4)
    ) {
      socket.serializeAttachment({
        peer: peer ?? attachment.peer,
        seen: now,
      } satisfies Attachment);
    }
    if (peer === null) this.broadcast(socket, message);
  }

  // Rooms close after a stretch with no traffic, and after a fixed lifetime.
  async alarm() {
    const sockets = this.ctx.getWebSockets();
    const now = Date.now();
    const opened = (await this.ctx.storage.get<number>("opened")) ?? now;
    const seen = Math.max(
      0,
      ...sockets.map(
        (socket) => (socket.deserializeAttachment() as Attachment).seen,
      ),
    );
    const expired = now - opened >= this.lifetimeMs;
    if (sockets.length > 0 && !expired && now - seen < this.idleMs) {
      await this.ctx.storage.setAlarm(
        Math.min(seen + this.idleMs, opened + this.lifetimeMs),
      );
      return;
    }
    for (const socket of sockets) {
      socket.serializeAttachment({ peer: null, seen } satisfies Attachment);
      socket.close(
        1000,
        expired ? "This room has expired." : "This room was idle.",
      );
    }
    await this.ctx.storage.deleteAll();
  }

  webSocketClose(socket: WebSocket) {
    this.left(socket);
  }

  webSocketError(socket: WebSocket) {
    this.left(socket);
  }

  private left(socket: WebSocket) {
    const { peer, seen } = socket.deserializeAttachment() as Attachment;
    socket.serializeAttachment({ peer: null, seen } satisfies Attachment);
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
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";
    const allowed = allowedOrigin(origin, env.ALLOWED_ORIGINS);
    const headers: Record<string, string> = allowed
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        }
      : { Vary: "Origin" };
    const maps = await routeMaps(request, env, headers);
    if (maps) return maps;
    const published = await routePublished(request, env, headers);
    if (published) return published;
    const match = roomPath.exec(new URL(request.url).pathname);
    if (!match) return new Response("Not found.", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket.", { status: 426 });
    }
    if (!allowed) return new Response("Forbidden.", { status: 403 });
    return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
  },
} satisfies ExportedHandler<Env>;

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

export { Gallery, MapCopy, Room };
