// One Durable Object per map holds its latest version and a revision number.
// Anyone with the map's id can read it. A write needs the edit secret and the
// current revision, so a stale device can't overwrite a newer copy.
import { DurableObject } from "cloudflare:workers";

import { ConnectionLimits } from "./limits";
import {
  applyPatch,
  fitPatch,
  type MapPatch,
  maxPatchLength,
  missingCorners,
  parsePatch,
  randomSuffix,
} from "./map-patch";

export interface MapsEnv {
  MAPS: DurableObjectNamespace<MapCopy>;
  NEW_MAPS?: RateLimit;
  MAP_HELLO_SECONDS?: string;
}

export const maxMapBytes = 5 * 1024 * 1024;

const mapPath = /^\/maps(?:\/([a-z0-9]{16})(\/live)?)?$/;
// People editing one map at once.
const maxEditors = 16;
const maxNameLength = 24;
// Edits land in memory at once and reach storage at most this often.
const saveEveryMs = 1000;
// The close code for a link whose secret is refused, so it doesn't retry.
const refusedCode = 4003;

// Who a live connection is: 0 until it shows the map's secret.
interface Editor {
  peer: number;
  name: string;
  since: number;
  // Names one browser's link across its reconnects.
  client?: string;
  // Ends the ids this browser makes, unlike any other editor's.
  suffix?: string;
}

const clientPattern = /^[0-9a-f]{24}$/;
const suffixPattern = /^[a-z]{1,8}$/;
// How long the last edit each browser sent is remembered, to skip it when
// sent again after a drop.
const seenMs = 24 * 60 * 60 * 1000;

interface Stored {
  revision: number;
  secret: string;
  parts: number;
  // The revision the parts hold. Edits after it wait in the log.
  saved: number;
}

type Write =
  | { ok: true; revision: number }
  | { ok: false; status: 403 | 404 }
  | { ok: false; status: 409; revision: number; map: string };

class MapCopy extends DurableObject<MapsEnv> {
  private readonly limits = new WeakMap<WebSocket, ConnectionLimits>();
  // The map as last stored, kept while the object is awake so each edit
  // doesn't read and parse it again.
  private cached: { revision: number; map: Record<string, unknown> } | null =
    null;
  // The cached map has edits storage doesn't have yet, and when it last
  // caught up.
  private dirty = false;
  private savedAt = 0;
  // At least the cached map's size in bytes, measured again only near the
  // limit.
  private size = 0;

  // How long a live connection has to show the secret before it is let go.
  private get helloMs() {
    return Number(this.env.MAP_HELLO_SECONDS ?? 10) * 1000;
  }

  // A live connection, which edits the map once it shows the secret and sees
  // everyone else's edits and pointers.
  async fetch(request: Request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket.", { status: 426 });
    }
    if (!(await this.ctx.storage.get<number>("revision"))) {
      return new Response("No such map.", { status: 404 });
    }
    this.dropSilent(Date.now());
    if (this.ctx.getWebSockets().length >= maxEditors) {
      return new Response("This map has as many editors as it can take.", {
        status: 409,
      });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const now = Date.now();
    server.serializeAttachment({
      peer: 0,
      name: "",
      since: now,
    } satisfies Editor);
    await this.wakeAt(now + this.helloMs);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const now = Date.now();
    let limits = this.limits.get(socket);
    if (!limits) {
      // One edit can be as big as a map, like pasting half of one.
      limits = new ConnectionLimits(now, 60, maxPatchLength + 64 * 1024);
      this.limits.set(socket, limits);
    }
    const verdict = limits.check(message, now);
    if (verdict === "close" || typeof message !== "string") {
      socket.close(1008, "Too much traffic.");
      return;
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(message) as Record<string, unknown>;
    } catch {
      return;
    }
    if (verdict === "drop") {
      // A pointer can be skipped, but a skipped edit has to be said.
      if (data.type === "patch") {
        socket.send(JSON.stringify({ type: "refused", id: data.id }));
      }
      return;
    }
    const editor = socket.deserializeAttachment() as Editor;
    if (!editor.peer) {
      await this.hello(socket, data);
      return;
    }
    if (data.type === "patch") {
      await this.patch(socket, editor, data);
    } else if (data.type === "cursor") {
      const { x, y } = data;
      const at =
        typeof x === "number" &&
        typeof y === "number" &&
        Number.isFinite(x) &&
        Number.isFinite(y)
          ? { x: Math.round(x), y: Math.round(y) }
          : null;
      this.broadcast(
        JSON.stringify({ type: "cursor", peer: editor.peer, at }),
        socket,
      );
    }
  }

  webSocketClose(socket: WebSocket) {
    this.left(socket);
  }

  webSocketError(socket: WebSocket) {
    this.left(socket);
  }

  private async hello(socket: WebSocket, data: Record<string, unknown>) {
    const secret = typeof data.secret === "string" ? data.secret : "";
    const stored = await this.stored();
    if (data.type !== "hello" || !(await sameHash(secret, stored.secret))) {
      socket.close(refusedCode, "This link can't edit the map.");
      return;
    }
    const others = this.editors().filter((item) => item.socket !== socket);
    const peer = Math.max(0, ...others.map((item) => item.editor.peer)) + 1;
    const name =
      typeof data.name === "string"
        ? data.name.trim().slice(0, maxNameLength)
        : "";
    const client =
      typeof data.client === "string" && clientPattern.test(data.client)
        ? data.client
        : undefined;
    const taken = new Set(others.map((item) => item.editor.suffix));
    let suffix =
      typeof data.suffix === "string" && suffixPattern.test(data.suffix)
        ? data.suffix
        : "";
    while (!suffix || taken.has(suffix)) suffix = randomSuffix();
    socket.serializeAttachment({
      peer,
      name,
      since: Date.now(),
      client,
      suffix,
    } satisfies Editor);
    // The welcome carries the map as it stands, so the link starts from what
    // every later edit it hears lands on.
    const { revision, map } = await this.current();
    socket.send(
      JSON.stringify({
        type: "welcome",
        peer,
        suffix,
        revision,
        map,
        peers: others.map(({ editor: other }) => ({
          peer: other.peer,
          name: other.name,
        })),
      }),
    );
    this.broadcast(JSON.stringify({ type: "join", peer, name }), socket);
  }

  // Edits apply in the order they arrive, and everyone, the sender too, hears
  // each one with its revision, so every copy ends up the same.
  private async patch(
    socket: WebSocket,
    editor: Editor,
    data: Record<string, unknown>,
  ) {
    const patch = parsePatch(data.patch);
    const id = Number(data.id);
    if (!patch || !Number.isSafeInteger(id) || id < 1) return;
    const current = await this.current();
    const seenKey = editor.client ? `seen:${editor.client}` : null;
    const seen = seenKey
      ? await this.ctx.storage.get<{ id: number; at: number }>(seenKey)
      : undefined;
    if (seen && id <= seen.id) {
      socket.send(
        JSON.stringify({ type: "ack", id, revision: current.revision }),
      );
      return;
    }
    const fitted = fitPatch(current.map, patch);
    if (!fitted) {
      socket.send(JSON.stringify({ type: "refused", id, error: "taken" }));
      return;
    }
    const map = applyPatch(current.map, fitted);
    // An edit that would leave a room on corners that are gone is turned
    // away, and its sender's copy takes it back.
    const before = missingCorners(current.map);
    if ([...missingCorners(map)].some((corner) => !before.has(corner))) {
      socket.send(
        JSON.stringify({ type: "refused", id, error: "missing-corners" }),
      );
      return;
    }
    // A map grows by at most what the patch holds, so the whole map is
    // measured again only when that could take it past the limit.
    let size = this.size + byteLength(JSON.stringify(fitted));
    if (size > maxMapBytes) size = byteLength(JSON.stringify(map));
    if (size > maxMapBytes) {
      socket.send(
        JSON.stringify({ type: "refused", id: data.id, error: "too-big" }),
      );
      return;
    }
    this.size = size;
    const revision = current.revision + 1;
    // Each edit is kept in a small log entry before anyone hears of it, and
    // the log folds into the whole map at most once a second.
    await this.ctx.storage.put({
      [logKey(revision)]: JSON.stringify(fitted),
      revision,
      ...(seenKey && { [seenKey]: { id, at: Date.now() } }),
    });
    this.cached = { revision, map };
    this.dirty = true;
    if (Date.now() - this.savedAt >= saveEveryMs) await this.save();
    else await this.wakeAt(this.savedAt + saveEveryMs);
    this.broadcast(
      JSON.stringify({
        type: "patch",
        patch: fitted,
        revision,
        peer: editor.peer,
        client: editor.client,
        id,
      }),
    );
  }

  // Folds the log into the whole map.
  private async save() {
    if (!this.dirty || !this.cached) return;
    const { parts } = await this.stored();
    const { revision, map } = this.cached;
    const text = JSON.stringify(map);
    this.size = byteLength(text);
    await this.ctx.storage.put({
      ...partsOf(text, parts ?? 0),
      revision,
      saved: revision,
    });
    const now = Date.now();
    const stale = [
      ...(
        await this.ctx.storage.list<{ id: number; at: number }>({
          prefix: "seen:",
        })
      ).entries(),
    ].flatMap(([key, value]) => (now - value.at > seenMs ? [key] : []));
    const logged = [
      ...(await this.ctx.storage.list({ prefix: logPrefix })).keys(),
      ...stale,
    ];
    for (let at = 0; at < logged.length; at += 128) {
      await this.ctx.storage.delete(logged.slice(at, at + 128));
    }
    this.dirty = false;
    this.savedAt = Date.now();
  }

  // Saves what waits, and lets go of connections that never showed the
  // secret.
  async alarm() {
    await this.save();
    let next = this.dropSilent(Date.now());
    if (this.dirty) next = Math.min(next, this.savedAt + saveEveryMs);
    if (next < Infinity) await this.ctx.storage.setAlarm(next);
  }

  // Closes connections that never showed the secret in time, so they can't
  // hold every place. Returns when the next one runs out.
  private dropSilent(now: number) {
    let next = Infinity;
    for (const socket of this.ctx.getWebSockets()) {
      const { peer, since } = socket.deserializeAttachment() as Editor;
      if (peer) continue;
      if (now - since < this.helloMs) {
        next = Math.min(next, since + this.helloMs);
        continue;
      }
      socket.serializeAttachment({
        peer: 0,
        name: "",
        since: 0,
      } satisfies Editor);
      try {
        socket.close(refusedCode, "No hello.");
      } catch {
        // It may already be closed.
      }
    }
    return next;
  }

  private async wakeAt(time: number) {
    const set = await this.ctx.storage.getAlarm();
    if (set === null || set > time) await this.ctx.storage.setAlarm(time);
  }

  // The map with every logged edit, as in memory or rebuilt from storage.
  private async current() {
    if (this.dirty && this.cached) return this.cached;
    const { revision = 0, parts = 0, saved = revision } = await this.stored();
    if (this.cached?.revision !== revision) {
      const text = (await this.map(parts)) || "{}";
      this.size = byteLength(text);
      let map = JSON.parse(text) as Record<string, unknown>;
      const logged = await this.ctx.storage.list<string>({ prefix: logPrefix });
      let replayed = false;
      for (const [key, patch] of logged) {
        if (Number(key.slice(logPrefix.length)) <= saved) continue;
        map = applyPatch(map, JSON.parse(patch) as MapPatch);
        replayed = true;
      }
      if (replayed) this.size = byteLength(JSON.stringify(map));
      this.cached = { revision, map };
      this.dirty = replayed;
    }
    return this.cached;
  }

  private editors() {
    return this.ctx.getWebSockets().flatMap((socket) => {
      const editor = socket.deserializeAttachment() as Editor;
      return editor.peer ? [{ socket, editor }] : [];
    });
  }

  private left(socket: WebSocket) {
    const { peer, since, client } = socket.deserializeAttachment() as Editor;
    socket.serializeAttachment({
      peer: 0,
      name: "",
      since,
      client,
    } satisfies Editor);
    try {
      socket.close();
    } catch {
      // The socket may already be closed.
    }
    if (peer) this.broadcast(JSON.stringify({ type: "leave", peer }), socket);
  }

  private broadcast(message: string, except?: WebSocket) {
    for (const { socket } of this.editors()) {
      if (socket === except) continue;
      try {
        socket.send(message);
      } catch {
        // A closing socket gets its own close event.
      }
    }
  }

  async create(secret: string, map: string) {
    if (await this.ctx.storage.get<number>("revision")) return false;
    await this.ctx.storage.put({
      ...partsOf(map, 0),
      revision: 1,
      saved: 1,
      secret,
    });
    return true;
  }

  async read() {
    if (!(await this.ctx.storage.get<number>("revision"))) return null;
    const { revision, map } = await this.current();
    return { revision, map: JSON.stringify(map) };
  }

  async write(secret: string, base: number, map: string): Promise<Write> {
    await this.current();
    await this.save();
    const stored = await this.stored();
    if (!stored.revision) return { ok: false, status: 404 };
    if (!(await sameHash(secret, stored.secret))) {
      return { ok: false, status: 403 };
    }
    if (base !== stored.revision) {
      return {
        ok: false,
        status: 409,
        revision: stored.revision,
        map: await this.map(stored.parts ?? 0),
      };
    }
    const revision = stored.revision + 1;
    // Puts of up to 128 keys land together, so a reader sees all of a new
    // version or none of it.
    await this.ctx.storage.put({
      ...partsOf(map, stored.parts ?? 0),
      revision,
      saved: revision,
    });
    this.cached = null;
    // Live editors take the whole new map from a read.
    this.broadcast(
      JSON.stringify({
        type: "map",
        revision,
        map: JSON.parse(map) as unknown,
      }),
    );
    return { ok: true, revision };
  }

  private async stored(): Promise<Partial<Stored>> {
    const values = await this.ctx.storage.get<string | number>([
      "revision",
      "secret",
      "parts",
      "saved",
    ]);
    return Object.fromEntries(values);
  }

  private async map(parts: number) {
    const keys = Array.from({ length: parts }, (_, index) => `map:${index}`);
    const values = await this.ctx.storage.get<string>(keys);
    return keys.map((key) => values.get(key) ?? "").join("");
  }
}

export async function routeMaps(
  request: Request,
  env: MapsEnv,
  headers: Record<string, string>,
): Promise<Response | null> {
  if (!mapPath.test(new URL(request.url).pathname)) return null;
  try {
    return await answer(request, env, headers);
  } catch {
    // The browser only reads an answer that carries its CORS headers.
    return Response.json(
      { error: "The online copy couldn't be saved. Try again soon." },
      { status: 500, headers },
    );
  }
}

// A stored value has to stay under 2 MB, so a map is kept in parts of this
// many characters, each at most 3 bytes in UTF-8.
const partLength = 512 * 1024;

function partsOf(map: string, before: number) {
  const parts = Math.max(1, Math.ceil(map.length / partLength));
  const entries: Record<string, string | number> = { parts };
  for (let index = 0; index < parts; index += 1) {
    entries[`map:${index}`] = map.slice(
      index * partLength,
      (index + 1) * partLength,
    );
  }
  for (let index = parts; index < before; index += 1) {
    entries[`map:${index}`] = "";
  }
  return entries;
}

const idLength = 16;
const secretBytes = 24;

async function answer(
  request: Request,
  env: MapsEnv,
  headers: Record<string, string>,
): Promise<Response> {
  const match = mapPath.exec(new URL(request.url).pathname);
  if (!match) return Response.json({ error: "Not found." }, { status: 404 });
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers });
  const id = match[1];
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (!id) {
    if (request.method !== "POST") return reply({ error: "Not found." }, 404);
    const ip = request.headers.get("CF-Connecting-IP") ?? "local";
    if (env.NEW_MAPS && !(await env.NEW_MAPS.limit({ key: ip })).success) {
      return reply({ error: "Too many new maps. Try again soon." }, 429);
    }
    const map = await readMap(request);
    if (map instanceof Response) return map;
    const newId = randomText(idLength);
    const secret = toHex(crypto.getRandomValues(new Uint8Array(secretBytes)));
    const copy = env.MAPS.get(env.MAPS.idFromName(newId));
    if (!(await copy.create(await hash(secret), map))) {
      return reply({ error: "Try again." }, 409);
    }
    return reply({ id: newId, secret, revision: 1 }, 201);
  }
  const copy = env.MAPS.get(env.MAPS.idFromName(id));
  if (match[2]) {
    if (!headers["Access-Control-Allow-Origin"]) {
      return new Response("Forbidden.", { status: 403 });
    }
    return copy.fetch(request);
  }
  if (request.method === "GET") {
    const found = await copy.read();
    return found
      ? reply({ revision: found.revision, map: JSON.parse(found.map) })
      : reply({ error: "No such map." }, 404);
  }
  if (request.method !== "PUT") return reply({ error: "Not found." }, 404);
  const secret = /^Bearer (\S+)$/.exec(
    request.headers.get("Authorization") ?? "",
  )?.[1];
  const base = Number(new URL(request.url).searchParams.get("base"));
  if (!secret || !Number.isInteger(base) || base < 1) {
    return reply({ error: "An edit needs the map's secret and base." }, 400);
  }
  const map = await readMap(request);
  if (map instanceof Response) return map;
  const written = await copy.write(secret, base, map);
  if (written.ok) return reply({ revision: written.revision });
  if (written.status === 409) {
    return reply(
      { revision: written.revision, map: JSON.parse(written.map) },
      409,
    );
  }
  return reply(
    {
      error:
        written.status === 404 ? "No such map." : "This link can't edit it.",
    },
    written.status,
  );

  async function readMap(from: Request) {
    const length = Number(from.headers.get("Content-Length") ?? 0);
    if (length > maxMapBytes) {
      return reply({ error: "The map is too big." }, 413);
    }
    const text = await from.text();
    if (new TextEncoder().encode(text).length > maxMapBytes) {
      return reply({ error: "The map is too big." }, 413);
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null) throw new Error();
    } catch {
      return reply({ error: "A map is a JSON object." }, 400);
    }
    return text;
  }
}

const logPrefix = "log:";

// Padded, so the log lists in order.
function logKey(revision: number) {
  return `${logPrefix}${String(revision).padStart(12, "0")}`;
}

function byteLength(text: string) {
  return new TextEncoder().encode(text).length;
}

function randomText(length: number) {
  const letters = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    crypto.getRandomValues(new Uint8Array(length)),
    (byte) => letters[byte % letters.length],
  ).join("");
}

async function hash(text: string) {
  return toHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  );
}

async function sameHash(secret: string, stored = "") {
  const given = await hash(secret);
  if (given.length !== stored.length) return false;
  let difference = 0;
  for (let at = 0; at < given.length; at += 1) {
    difference |= given.charCodeAt(at) ^ stored.charCodeAt(at);
  }
  return difference === 0;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export { MapCopy };
