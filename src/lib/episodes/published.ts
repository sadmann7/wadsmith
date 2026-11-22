import { cloudBase } from "./cloud";

// A frozen copy of a map or episode, as the rooms server describes it.
export interface PublishedMap {
  id: string;
  kind: "map" | "episode";
  title: string;
  author: string;
  game: string;
  complevel: string;
  warp: number;
  maps: { slot: string; name: string }[];
  listed: boolean;
  publishedAt: number;
}

export type GalleryEntry = Pick<
  PublishedMap,
  "id" | "kind" | "title" | "author" | "game" | "publishedAt"
> & { maps: number };

export interface PublishRequest {
  kind: "map" | "episode";
  title: string;
  author: string;
  game: string;
  complevel: string;
  warp: number;
  maps: { slot: string; name: string }[];
  listed: boolean;
  wad: Uint8Array;
  // The map file or episode backup the WAD was built from.
  source: string;
}

const idPattern = /^[0-9a-f]{20}$/;
const playPath = /^\/play\/([0-9a-f]{20})\/?$/;

export const publishBase = cloudBase();

export function playLink(origin: string, id: string) {
  return `${origin}/play/${id}`;
}

// The published copy a page's address opens, if it names one.
export function playTarget(pathname: string) {
  return playPath.exec(pathname)?.[1] ?? null;
}

export async function publish(
  request: PublishRequest,
  base = publishBase,
  send = fetch,
) {
  if (!base) throw new Error("This copy of Wadsmith can't publish maps.");
  const { wad, ...details } = request;
  const response = await send(`${base}/published`, {
    method: "POST",
    body: JSON.stringify({ ...details, wad: toBase64(wad) }),
  }).catch(() => {
    throw new Error("The server can't be reached right now.");
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok || typeof body.id !== "string" || !idPattern.test(body.id)) {
    throw new Error(
      typeof body.error === "string" ? body.error : "The map wasn't published.",
    );
  }
  return body.id;
}

export async function readPublished(id: string, base = publishBase) {
  if (!base || !idPattern.test(id)) return null;
  const [manifest, wad] = await Promise.all([
    fetch(`${base}/published/${id}`),
    fetch(`${base}/published/${id}/wad`),
  ]);
  if (manifest.status === 404) return null;
  if (!manifest.ok || !wad.ok) {
    throw new Error("The published map can't be read right now.");
  }
  return {
    details: (await manifest.json()) as PublishedMap,
    wad: new Uint8Array(await wad.arrayBuffer()),
  };
}

export async function listGallery(base = publishBase, before?: number) {
  if (!base) return [];
  const response = await fetch(
    `${base}/gallery${before ? `?before=${before}` : ""}`,
  );
  if (!response.ok) throw new Error("The gallery can't be read right now.");
  const { maps } = (await response.json()) as { maps: GalleryEntry[] };
  return maps.filter((entry) => idPattern.test(entry.id));
}

function toBase64(bytes: Uint8Array) {
  let text = "";
  const step = 0x8000;
  for (let at = 0; at < bytes.length; at += step) {
    text += String.fromCharCode(...bytes.subarray(at, at + step));
  }
  return btoa(text);
}
