// The online copy of a map: one Durable Object per map, holding its latest
// version and a revision number. Anyone with the map's id can read it, and
// only a request with its edit secret can write it, and only on top of the
// revision it last saw, so a stale device can't overwrite a newer copy.
import { DurableObject } from "cloudflare:workers";

export interface MapsEnv {
  MAPS: DurableObjectNamespace<MapCopy>;
  NEW_MAPS?: RateLimit;
}

// A map file holds at most this much, as the editor's own limit says.
export const maxMapBytes = 5 * 1024 * 1024;
const idLength = 16;
const secretBytes = 24;
const mapPath = /^\/maps(?:\/([a-z0-9]{16}))?$/;

interface Stored {
  revision: number;
  secret: string;
  map: string;
}

type Write =
  | { ok: true; revision: number }
  | { ok: false; status: 403 | 404 }
  | { ok: false; status: 409; revision: number; map: string };

class MapCopy extends DurableObject {
  async create(secret: string, map: string) {
    if (await this.ctx.storage.get<number>("revision")) return false;
    await this.ctx.storage.put({ revision: 1, secret, map });
    return true;
  }

  async read() {
    const { revision, map } = await this.stored();
    return revision && map ? { revision, map } : null;
  }

  async write(secret: string, base: number, map: string): Promise<Write> {
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
        map: stored.map ?? "{}",
      };
    }
    const revision = stored.revision + 1;
    await this.ctx.storage.put({ revision, map });
    return { ok: true, revision };
  }

  private async stored(): Promise<Partial<Stored>> {
    const values = await this.ctx.storage.get<string | number>([
      "revision",
      "secret",
      "map",
    ]);
    return Object.fromEntries(values);
  }
}

// Answers a request under /maps, or returns null for any other path.
export async function handleMaps(
  request: Request,
  env: MapsEnv,
  headers: Record<string, string>,
): Promise<Response | null> {
  const match = mapPath.exec(new URL(request.url).pathname);
  if (!match) return null;
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

  // The map's text, refused when it is too big or isn't JSON.
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
