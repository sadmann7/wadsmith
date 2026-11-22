// Published maps: a frozen copy of a map or episode behind a link that never
// changes. The built WAD, the map file it came from and a small manifest are
// kept in R2 by content hash, and a Gallery Durable Object lists the ones
// their authors chose to show.
import { DurableObject } from "cloudflare:workers";

export interface PublishEnv {
  PUBLISHED: R2Bucket;
  GALLERY: DurableObjectNamespace<Gallery>;
  NEW_PUBLISHES?: RateLimit;
}

// A published WAD and its map file are each at most this big.
export const maxPublishedBytes = 8 * 1024 * 1024;

const galleryPage = 30;
const publishedPath = /^\/published(?:\/([0-9a-f]{20})(\/wad|\/source)?)?$/;
const galleryPath = /^\/gallery$/;
// A published copy never changes, so a browser may keep it for good.
const forever = "public, max-age=31536000, immutable";

export interface Manifest {
  id: string;
  kind: "map" | "episode";
  title: string;
  author: string;
  // The game it was made for, and the compatibility level it plays in.
  game: string;
  complevel: string;
  // The map to start on, as the engine numbers it.
  warp: number;
  maps: { slot: string; name: string }[];
  wad: string;
  source: string;
  listed: boolean;
  publishedAt: number;
}

type Listing = Pick<
  Manifest,
  "id" | "kind" | "title" | "author" | "game" | "publishedAt"
> & { maps: number };

class Gallery extends DurableObject<PublishEnv> {
  constructor(ctx: DurableObjectState, env: PublishEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(`create table if not exists listed (
      id text primary key,
      kind text not null,
      title text not null,
      author text not null,
      game text not null,
      maps integer not null,
      published_at integer not null
    )`);
    ctx.storage.sql.exec(
      "create index if not exists listed_by_time on listed (published_at)",
    );
  }

  add(entry: Listing) {
    this.ctx.storage.sql.exec(
      `insert or ignore into listed
        (id, kind, title, author, game, maps, published_at)
        values (?, ?, ?, ?, ?, ?, ?)`,
      entry.id,
      entry.kind,
      entry.title,
      entry.author,
      entry.game,
      entry.maps,
      entry.publishedAt,
    );
  }

  // The newest listed copies, published before the time given.
  list(before: number): Listing[] {
    return this.ctx.storage.sql
      .exec<{
        id: string;
        kind: "map" | "episode";
        title: string;
        author: string;
        game: string;
        maps: number;
        published_at: number;
      }>(
        `select * from listed where published_at < ?
          order by published_at desc limit ?`,
        before,
        galleryPage,
      )
      .toArray()
      .map(({ published_at: publishedAt, ...row }) => ({
        ...row,
        publishedAt,
      }));
  }
}

// Answers a request under /published or /gallery, or returns null for any
// other path.
export async function routePublished(
  request: Request,
  env: PublishEnv,
  headers: Record<string, string>,
): Promise<Response | null> {
  const { pathname, searchParams } = new URL(request.url);
  const published = publishedPath.exec(pathname);
  const isGallery = galleryPath.test(pathname);
  if (!published && !isGallery) return null;
  const reply = (
    body: unknown,
    status = 200,
    extra: Record<string, string> = {},
  ) => Response.json(body, { status, headers: { ...headers, ...extra } });
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  try {
    const gallery = env.GALLERY.get(env.GALLERY.idFromName("gallery"));
    if (isGallery) {
      if (request.method !== "GET") return reply({ error: "Not found." }, 404);
      const before = Number(searchParams.get("before") ?? Date.now() + 1);
      return reply({
        maps: await gallery.list(Number.isFinite(before) ? before : Date.now()),
      });
    }
    const [, id, part] = published ?? [];
    if (!id) {
      if (request.method !== "POST") return reply({ error: "Not found." }, 404);
      if (!headers["Access-Control-Allow-Origin"]) {
        return reply({ error: "Forbidden." }, 403);
      }
      const ip = request.headers.get("CF-Connecting-IP") ?? "local";
      if (
        env.NEW_PUBLISHES &&
        !(await env.NEW_PUBLISHES.limit({ key: ip })).success
      ) {
        return reply(
          { error: "Too many maps published. Try again soon." },
          429,
        );
      }
      return await publish(request, env, gallery, reply);
    }
    if (request.method !== "GET") return reply({ error: "Not found." }, 404);
    const manifest = await env.PUBLISHED.get(`published/${id}.json`);
    if (!manifest) return reply({ error: "No such map." }, 404);
    if (!part) {
      return new Response(manifest.body, {
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Cache-Control": forever,
        },
      });
    }
    const { wad, source } = (await manifest.json()) as Manifest;
    const file = await env.PUBLISHED.get(
      part === "/wad" ? `wads/${wad}` : `sources/${source}`,
    );
    if (!file) return reply({ error: "That file is missing." }, 404);
    return new Response(file.body, {
      headers: {
        ...headers,
        "Content-Type":
          part === "/wad" ? "application/octet-stream" : "application/json",
        "Cache-Control": forever,
      },
    });
  } catch {
    return reply({ error: "That didn't work. Try again soon." }, 500);
  }
}

const idLength = 20;

async function publish(
  request: Request,
  env: PublishEnv,
  gallery: DurableObjectStub<Gallery>,
  reply: (body: unknown, status?: number) => Response,
) {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  // A WAD and its map file, sent as base64 in JSON.
  if (length > 3 * maxPublishedBytes) {
    return reply({ error: "That's too big to publish." }, 413);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return reply({ error: "A publish is a JSON object." }, 400);
  }
  const wad = decode(body.wad);
  const source = typeof body.source === "string" ? body.source : null;
  if (!wad || !source)
    return reply({ error: "A publish needs a WAD and its map file." }, 400);
  if (
    wad.length > maxPublishedBytes ||
    new TextEncoder().encode(source).length > maxPublishedBytes
  ) {
    return reply({ error: "That's too big to publish." }, 413);
  }
  if (String.fromCharCode(...wad.subarray(0, 4)) !== "PWAD") {
    return reply({ error: "That isn't a PWAD." }, 400);
  }
  try {
    JSON.parse(source);
  } catch {
    return reply({ error: "The map file isn't valid." }, 400);
  }
  const details = parseDetails(body);
  if (!details) return reply({ error: "The details aren't valid." }, 400);
  const wadHash = await hash(wad);
  const sourceHash = await hash(new TextEncoder().encode(source));
  // The same content and details always get the same link.
  const id = (
    await hash(
      new TextEncoder().encode(
        JSON.stringify({ ...details, wad: wadHash, source: sourceHash }),
      ),
    )
  ).slice(0, idLength);
  const key = `published/${id}.json`;
  const existing = await env.PUBLISHED.head(key);
  const manifest: Manifest = existing
    ? ((await (await env.PUBLISHED.get(key))?.json()) as Manifest)
    : {
        id,
        ...details,
        wad: wadHash,
        source: sourceHash,
        publishedAt: Date.now(),
      };
  if (!existing) {
    await Promise.all([
      env.PUBLISHED.put(`wads/${wadHash}`, wad),
      env.PUBLISHED.put(`sources/${sourceHash}`, source),
    ]);
    await env.PUBLISHED.put(key, JSON.stringify(manifest), {
      httpMetadata: { contentType: "application/json" },
    });
  }
  if (manifest.listed) {
    await gallery.add({
      id,
      kind: manifest.kind,
      title: manifest.title,
      author: manifest.author,
      game: manifest.game,
      maps: manifest.maps.length,
      publishedAt: manifest.publishedAt,
    });
  }
  return reply({ id, existed: Boolean(existing) }, existing ? 200 : 201);
}

const maxTitleLength = 80;
const maxAuthorLength = 40;
const maxMaps = 36;

function parseDetails(body: Record<string, unknown>) {
  const { kind, title, author, game, complevel, warp, maps, listed } = body;
  if (kind !== "map" && kind !== "episode") return null;
  if (typeof title !== "string" || !title.trim()) return null;
  if (typeof game !== "string" || !/^[a-z0-9-]{1,32}$/.test(game)) return null;
  if (typeof complevel !== "string" || !/^[a-z0-9]{1,16}$/.test(complevel)) {
    return null;
  }
  if (
    !Number.isInteger(warp) ||
    (warp as number) < 1 ||
    (warp as number) > 99
  ) {
    return null;
  }
  if (!Array.isArray(maps) || maps.length === 0 || maps.length > maxMaps) {
    return null;
  }
  const levels = maps.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const { slot, name } = item as Record<string, unknown>;
    return typeof slot === "string" && /^(MAP\d\d|E\dM\d)$/.test(slot)
      ? [
          {
            slot,
            name: typeof name === "string" ? name.slice(0, maxTitleLength) : "",
          },
        ]
      : [];
  });
  if (levels.length !== maps.length) return null;
  return {
    kind,
    title: title.trim().slice(0, maxTitleLength),
    author:
      typeof author === "string" ? author.trim().slice(0, maxAuthorLength) : "",
    game,
    complevel,
    warp: warp as number,
    maps: levels,
    listed: listed === true,
  } satisfies Omit<Manifest, "id" | "wad" | "source" | "publishedAt">;
}

function decode(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hash(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export { Gallery };
