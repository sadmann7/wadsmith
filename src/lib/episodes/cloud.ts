import type { GameMap } from "@/lib/map/types";

import { parseMap } from "@/lib/map/storage";

// How a map in this browser is tied to its online copy: the copy's id, the
// edit secret when this browser may change it, the revision this browser last
// agreed with, and whether it has saved edits the copy doesn't have yet.
export interface CloudLink {
  id: string;
  secret?: string;
  revision: number;
  pending?: boolean;
}

export type CloudWrite =
  | { kind: "saved"; revision: number }
  | { kind: "conflict"; revision: number; map: GameMap };

export interface CloudApi {
  create: (map: GameMap) => Promise<Required<Omit<CloudLink, "pending">>>;
  read: (id: string) => Promise<{ revision: number; map: GameMap } | null>;
  write: (link: CloudLink, map: GameMap) => Promise<CloudWrite>;
}

export class CloudError extends Error {}

const idPattern = /^[a-z0-9]{16}$/;
const secretPattern = /^[0-9a-f]{48}$/;
const sharedPath = /^\/shared\/([a-z0-9]{16})\/?$/;

// The rooms server keeps the online copies. It is reached over plain HTTP at
// the address its WebSocket rooms use.
export function cloudBase(roomsUrl = process.env.NEXT_PUBLIC_ROOMS_URL) {
  return roomsUrl ? roomsUrl.replace(/^ws(s?):/, "http$1:") : null;
}

export function createCloudApi(base: string, send = fetch): CloudApi {
  const call = async (path: string, init?: RequestInit) => {
    let response: Response;
    try {
      response = await send(`${base}${path}`, init);
    } catch {
      throw new CloudError("The online copy can't be reached right now.");
    }
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    return { status: response.status, body };
  };
  return {
    async create(map) {
      const { status, body } = await call("/maps", {
        method: "POST",
        body: JSON.stringify(map),
      });
      if (status !== 201) throw failure(body);
      const { id, secret, revision } = body;
      if (
        typeof id !== "string" ||
        !idPattern.test(id) ||
        typeof secret !== "string" ||
        !secretPattern.test(secret) ||
        revision !== 1
      ) {
        throw new CloudError("The online copy answered oddly.");
      }
      return { id, secret, revision };
    },
    async read(id) {
      const { status, body } = await call(`/maps/${id}`);
      if (status === 404) return null;
      if (status !== 200) throw failure(body);
      return { revision: revisionOf(body), map: parseMap(body.map) };
    },
    async write(link, map) {
      if (!link.secret) throw new CloudError("This copy can only be read.");
      const { status, body } = await call(
        `/maps/${link.id}?base=${link.revision}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${link.secret}` },
          body: JSON.stringify(map),
        },
      );
      if (status === 200) return { kind: "saved", revision: revisionOf(body) };
      if (status === 409) {
        return {
          kind: "conflict",
          revision: revisionOf(body),
          map: parseMap(body.map),
        };
      }
      throw failure(body);
    },
  };
}

// The edit link carries its secret after "#", which browsers never send to a
// server, so it stays out of every log on the way.
export function editLink(origin: string, link: CloudLink) {
  return link.secret
    ? `${origin}/shared/${link.id}#${link.secret}`
    : viewLink(origin, link);
}

export function viewLink(origin: string, link: CloudLink) {
  return `${origin}/shared/${link.id}`;
}

// The online copy a page's address opens, if it names one.
export function sharedTarget(pathname: string, hash: string) {
  const id = sharedPath.exec(pathname)?.[1];
  if (!id) return null;
  const secret = hash.replace(/^#/, "");
  return secretPattern.test(secret) ? { id, secret } : { id };
}

export function parseCloudLink(value: unknown): CloudLink | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { id, secret, revision, pending } = value as Record<string, unknown>;
  if (typeof id !== "string" || !idPattern.test(id)) return undefined;
  if (!Number.isInteger(revision) || (revision as number) < 1) {
    return undefined;
  }
  return {
    id,
    revision: revision as number,
    ...(typeof secret === "string" && secretPattern.test(secret) && { secret }),
    ...(pending === true && { pending }),
  };
}

// What to do with a map's online copy as it opens or after an edit: pull a
// newer copy this browser has no edits against, push edits the copy lacks,
// or report a conflict when both changed.
export async function syncMap(
  api: CloudApi,
  link: CloudLink,
  map: GameMap,
): Promise<
  | { kind: "same" }
  | { kind: "pulled"; link: CloudLink; map: GameMap }
  | { kind: "pushed"; link: CloudLink }
  | { kind: "conflict"; revision: number; map: GameMap }
> {
  if (link.pending && link.secret) {
    const written = await api.write(link, map);
    if (written.kind === "conflict") return written;
    return {
      kind: "pushed",
      link: { ...link, revision: written.revision, pending: undefined },
    };
  }
  const online = await api.read(link.id);
  if (!online) throw new CloudError("The online copy no longer exists.");
  if (online.revision <= link.revision) return { kind: "same" };
  if (link.pending) {
    return { kind: "conflict", revision: online.revision, map: online.map };
  }
  return {
    kind: "pulled",
    link: { ...link, revision: online.revision },
    map: online.map,
  };
}

function failure(body: Record<string, unknown>) {
  return new CloudError(
    typeof body.error === "string"
      ? body.error
      : "The online copy refused the change.",
  );
}

function revisionOf(body: Record<string, unknown>) {
  const { revision } = body;
  if (!Number.isInteger(revision) || (revision as number) < 1) {
    throw new CloudError("The online copy answered oddly.");
  }
  return revision as number;
}
