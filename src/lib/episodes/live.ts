import {
  applyPatch,
  diffMaps,
  fitPatch,
  getIsEmptyPatch,
  type MapPatch,
  maxPatchLength,
  parsePatch,
  randomSuffix,
  suffixPattern,
} from "@rooms/map-patch";

import type { GameMap, Point } from "@/lib/map/types";

import { setIdSuffix } from "@/lib/map/edit";

export interface LivePeer {
  peer: number;
  name: string;
  at?: Point | null;
}

export interface LiveEvents {
  // What changed in the map this browser shows because of someone else, as
  // a patch to apply to it. It can carry a new name.
  onChange: (patch: MapPatch) => void;
  onPeers: (peers: LivePeer[]) => void;
  // The server has every edit this browser made, as of its revision.
  onIdle: (revision: number) => void;
  // The link stopped for good, because its secret no longer edits the map.
  onRefused: () => void;
  // Whether the link is connected, for showing it.
  onConnected: (connected: boolean) => void;
  // The server turned an edit away, which then came off the map shown.
  onDropped: (reason: string) => void;
}

interface LiveOptions extends LiveEvents {
  url: string;
  secret: string;
  name: string;
  // The map as this browser shows it when the link opens.
  map: GameMap;
  connect?: (url: string) => WebSocket;
}

const cursorEveryMs = 100;
const reconnectMs = [1000, 2000, 5000, 10_000, 30_000];
// The close code the server uses for a link whose secret it refused.
export const refusedCode = 4003;

// The letters that end ids this page makes for an online map. The server
// may hand out others on joining, unlike every other editor's.
let ownSuffix = randomSuffix();

// Whether ids made from now on are for an online map, which others may add
// to at the same moment.
export function setOnlineIds(isOnline: boolean) {
  setIdSuffix(isOnline ? ownSuffix : "");
}

// One browser's live link to a map's online copy. The server orders every
// edit, and this browser shows the map as the server confirmed it with its
// own unconfirmed edits played on top. Others' edits, a reconnect and the map
// sent on joining land on the confirmed map, and its own edits play again.
export function openLiveMap({
  url,
  secret,
  name,
  map,
  connect = (address) => new WebSocket(address),
  ...events
}: LiveOptions) {
  // Names this browser to the server across reconnects, so an edit sent
  // again after a drop isn't applied twice.
  const client = Array.from(
    crypto.getRandomValues(new Uint8Array(12)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  let confirmed: GameMap | null = null;
  let shown = map;
  let revision = 0;
  let suffix = ownSuffix;
  let sent = 0;
  const pending: { id: number; patch: MapPatch }[] = [];
  const peers = new Map<number, LivePeer>();
  let socket: WebSocket | null = null;
  let me = 0;
  let welcomed = false;
  let stopped = false;
  let attempts = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let cursorAt = 0;
  let cursorTimer: ReturnType<typeof setTimeout> | undefined;
  let nextCursor: Point | null = null;

  const showPeers = () => events.onPeers([...peers.values()]);
  const post = (message: object) => {
    if (welcomed && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };

  // Shows the confirmed map with this browser's edits on top, and hands the
  // editor what that changed.
  const replay = () => {
    if (!confirmed) return;
    let next = confirmed;
    // Each waiting edit lands as the server will land it, and one it will
    // turn away is left off.
    for (const { patch } of pending) {
      const fit = fitPatch(next, patch);
      if ("patch" in fit) next = applyPatch(next, fit.patch);
    }
    const change = diffMaps(shown, next);
    const renamed = next.name !== shown.name ? (next.name ?? null) : undefined;
    shown = next;
    const patch: MapPatch =
      renamed === undefined
        ? change
        : { ...change, fields: { ...change.fields, name: renamed } };
    if (!getIsEmptyPatch(patch)) events.onChange(patch);
  };

  const idle = () => {
    if (pending.length === 0) events.onIdle(revision);
  };

  const open = () => {
    const opened = connect(url);
    socket = opened;
    welcomed = false;
    opened.addEventListener("open", () =>
      opened.send(
        JSON.stringify({
          type: "hello",
          secret,
          name,
          client,
          suffix,
        }),
      ),
    );
    opened.addEventListener("close", (event) => {
      if (socket !== opened) return;
      socket = null;
      welcomed = false;
      peers.clear();
      showPeers();
      events.onConnected(false);
      if (stopped) return;
      if (event.code === refusedCode) {
        stopped = true;
        events.onRefused();
        return;
      }
      const wait = reconnectMs[Math.min(attempts, reconnectMs.length - 1)];
      attempts += 1;
      retry = setTimeout(open, wait);
    });
    opened.addEventListener("message", (event) => {
      if (socket !== opened) return;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (data.type === "welcome") {
        attempts = 0;
        me = Number(data.peer);
        if (
          typeof data.suffix === "string" &&
          suffixPattern.test(data.suffix)
        ) {
          ownSuffix = data.suffix;
          suffix = data.suffix;
        }
        setIdSuffix(suffix);
        revision = Number(data.revision);
        confirmed = data.map as GameMap;
        peers.clear();
        for (const peer of (data.peers as LivePeer[] | undefined) ?? []) {
          peers.set(peer.peer, { peer: peer.peer, name: peer.name, at: null });
        }
        showPeers();
        welcomed = true;
        events.onConnected(true);
        replay();
        // Edits not confirmed before a drop go again. The server skips any
        // it already took.
        for (const { id, patch } of pending) {
          post({ type: "patch", id, patch });
        }
        idle();
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
      } else if (data.type === "map" && confirmed) {
        // The map was saved whole elsewhere.
        revision = Number(data.revision);
        confirmed = data.map as GameMap;
        replay();
      } else if (data.type === "patch" && confirmed) {
        const patch = parsePatch(data.patch);
        if (!patch) return;
        revision = Number(data.revision);
        confirmed = applyPatch(confirmed, patch);
        if (Number(data.peer) === me && data.client === client) {
          confirm(Number(data.id));
        } else replay();
        idle();
      } else if (data.type === "ack") {
        // An edit sent again that the server had already taken.
        revision = Number(data.revision);
        confirm(Number(data.id));
        replay();
        idle();
      } else if (data.type === "refused") {
        // The server didn't take the edit, so it comes off the map shown.
        confirm(Number(data.id));
        replay();
        idle();
        // After idle, so the message about it stays up.
        events.onDropped(typeof data.error === "string" ? data.error : "");
      }
    });
  };

  const confirm = (id: number) => {
    const at = pending.findIndex((item) => item.id === id);
    if (at >= 0) pending.splice(at, 1);
  };

  const push = (patch: MapPatch) => {
    // An edit too long to send would close the link on every try, so it is
    // taken back here instead.
    if (JSON.stringify(patch).length > maxPatchLength) {
      replay();
      events.onDropped("too-big");
      return;
    }
    sent += 1;
    pending.push({ id: sent, patch });
    post({ type: "patch", id: sent, patch });
  };

  setIdSuffix(suffix);
  open();

  return {
    // Sends what changed from the map this browser shows. It returns false
    // when there was nothing to send.
    send(next: GameMap) {
      const patch = diffMaps(shown, next);
      shown = { ...next, name: shown.name };
      if (getIsEmptyPatch(patch)) return false;
      push(patch);
      return true;
    },
    // Renames the map for everyone. A map's name isn't part of its edits.
    rename(next: string) {
      if (next === shown.name) return;
      shown = { ...shown, name: next };
      push({ fields: { name: next } });
    },
    get idle() {
      return pending.length === 0 && welcomed;
    },
    // The map as the server last confirmed it, or null before it answered.
    get confirmed() {
      return confirmed;
    },
    get revision() {
      return revision;
    },
    // The letters that end the ids this browser makes.
    get suffix() {
      return suffix;
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
      stopped = true;
      clearTimeout(retry);
      clearTimeout(cursorTimer);
      socket?.close();
      socket = null;
    },
  };
}

export type LiveMap = ReturnType<typeof openLiveMap>;

// The address of a map's live connection on the rooms server.
export function liveUrl(roomsUrl: string, id: string) {
  return `${roomsUrl.replace(/^http/, "ws")}/maps/${id}/live`;
}
