import {
  applyPatch,
  diffMaps,
  getIsEmptyPatch,
  type MapPatch,
  parsePatch,
  patchKeys,
  withoutKeys,
} from "@rooms/map-patch";

import type { GameMap, Point } from "@/lib/map/types";

export interface LivePeer {
  peer: number;
  name: string;
  at?: Point | null;
}

export interface LiveEvents {
  // Someone else's edit, without the things this browser still has edits of
  // its own on the way for, which the server applies after it.
  onRemote: (patch: MapPatch) => void;
  // The map was saved whole elsewhere, so it has to be read again.
  onReload: () => void;
  onPeers: (peers: LivePeer[]) => void;
  // Nothing sent is still on its way, as of the server's revision.
  onIdle: (revision: number) => void;
  onClosed: (refused: boolean) => void;
}

interface LiveOptions extends LiveEvents {
  url: string;
  secret: string;
  name: string;
  map: GameMap;
  connect?: (url: string) => WebSocket;
}

const cursorEveryMs = 100;

// One browser's live link to a map's online copy. It sends each edit as the
// things it changed, applies everyone else's, and keeps everyone's pointers.
export function openLiveMap({
  url,
  secret,
  name,
  map,
  connect = (address) => new WebSocket(address),
  ...events
}: LiveOptions) {
  const socket = connect(url);
  // The map as this browser last sent it, with others' edits taken in, so the
  // next edit is told apart from theirs.
  let base = map;
  let me = 0;
  let revision = 0;
  let sent = 0;
  let closed = false;
  // The last edit sent for each thing, until the server hands it back.
  const waiting = new Map<string, number>();
  const peers = new Map<number, LivePeer>();
  let cursorAt = 0;
  let cursorTimer: ReturnType<typeof setTimeout> | undefined;
  let nextCursor: Point | null = null;

  const post = (message: object) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };
  const showPeers = () => events.onPeers([...peers.values()]);

  socket.addEventListener("open", () => post({ type: "hello", secret, name }));
  socket.addEventListener("close", (event) => {
    if (closed) return;
    closed = true;
    clearTimeout(cursorTimer);
    events.onClosed(event.code === 1008);
  });
  socket.addEventListener("message", (event) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(String(event.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (data.type === "welcome") {
      me = Number(data.peer);
      revision = Number(data.revision);
      for (const peer of (data.peers as LivePeer[] | undefined) ?? []) {
        peers.set(peer.peer, { peer: peer.peer, name: peer.name, at: null });
      }
      showPeers();
    } else if (data.type === "join") {
      const peer = Number(data.peer);
      const named = typeof data.name === "string" ? data.name : "";
      peers.set(peer, { peer, name: named, at: null });
      showPeers();
    } else if (data.type === "leave") {
      peers.delete(Number(data.peer));
      showPeers();
    } else if (data.type === "cursor") {
      const known = peers.get(Number(data.peer));
      if (!known) return;
      known.at = (data.at as Point | null) ?? null;
      showPeers();
    } else if (data.type === "map") {
      events.onReload();
    } else if (data.type === "patch") {
      const patch = parsePatch(data.patch);
      if (!patch) return;
      revision = Number(data.revision);
      if (Number(data.peer) === me) {
        for (const key of patchKeys(patch)) {
          if (waiting.get(key) === data.id) waiting.delete(key);
        }
      } else {
        const theirs = withoutKeys(patch, new Set(waiting.keys()));
        if (!getIsEmptyPatch(theirs)) {
          base = applyPatch(base, theirs);
          events.onRemote(theirs);
        }
      }
      if (waiting.size === 0) events.onIdle(revision);
    }
  });

  return {
    // Sends what changed since the map this browser last knew. It returns
    // false when there was nothing to send.
    send(next: GameMap) {
      const patch = diffMaps(base, next);
      base = next;
      if (getIsEmptyPatch(patch)) return false;
      sent += 1;
      for (const key of patchKeys(patch)) waiting.set(key, sent);
      post({ type: "patch", id: sent, patch });
      return true;
    },
    get idle() {
      return waiting.size === 0;
    },
    // The map as sent, with others' edits taken in.
    get map() {
      return base;
    },
    get revision() {
      return revision;
    },
    // Where this browser's pointer is on the map, at most ten times a second.
    cursor(at: Point | null) {
      nextCursor = at;
      if (cursorTimer) return;
      const wait = Math.max(0, cursorAt + cursorEveryMs - Date.now());
      cursorTimer = setTimeout(() => {
        cursorTimer = undefined;
        cursorAt = Date.now();
        post({ type: "cursor", ...(nextCursor ?? { x: null, y: null }) });
      }, wait);
    },
    close() {
      closed = true;
      clearTimeout(cursorTimer);
      socket.close();
    },
  };
}

export type LiveMap = ReturnType<typeof openLiveMap>;

// The address of a map's live connection on the rooms server.
export function liveUrl(roomsUrl: string, id: string) {
  return `${roomsUrl.replace(/^http/, "ws")}/maps/${id}/live`;
}
