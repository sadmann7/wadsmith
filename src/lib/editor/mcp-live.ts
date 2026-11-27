import { applyPatch, diffMaps } from "@rooms/map-patch";

import type { GameMap, Point } from "@/lib/map/types";

import { sharedTarget } from "@/lib/episodes/cloud";
import { liveUrl, openLiveMap } from "@/lib/episodes/live";
import { boxOf } from "@/lib/map/geometry";

import type { McpMapStore } from "./mcp-server";

export interface LiveStoreOptions {
  // The map's edit link, as Share in the editor gives it.
  editLink: string;
  // The rooms server the map's online copy lives on.
  roomsUrl: string;
  // The name the others see in their list of people editing.
  name: string;
  connect?: (url: string) => WebSocket;
  // How long to wait for the rooms server to let the link in.
  timeoutMs?: number;
}

const droppedReasons: Record<string, string> = {
  "missing-corners":
    "Someone removed a corner that edit drew on at the same moment, so it was taken back. Look at the map again and redo it.",
  "too-big": "That edit was too big to send, so it was taken back.",
  taken:
    "Someone added something with the same id at the same moment, so that edit was taken back. Redo it.",
};

// Joins an online map's live link, so the server's edits land on the map
// everyone with the link is editing, and theirs land on the server's.
export async function joinLiveMap({
  editLink,
  roomsUrl,
  name,
  connect,
  timeoutMs = 15_000,
}: LiveStoreOptions) {
  let address: URL;
  try {
    address = new URL(editLink);
  } catch {
    throw new Error(`${editLink} isn't a link.`);
  }
  const target = sharedTarget(address.pathname, address.hash);
  if (!target?.secret) {
    throw new Error(
      "That isn't an edit link. Copy the edit link from Share in the editor.",
    );
  }
  let current: GameMap = {
    vertices: {},
    sectors: [],
    things: [],
    switches: [],
  };
  const notices: string[] = [];
  let connected = false;
  let refused = false;
  let ready: (() => void) | undefined;
  let failed: ((error: Error) => void) | undefined;
  const welcomed = new Promise<void>((resolve, reject) => {
    ready = resolve;
    failed = reject;
  });
  const link = openLiveMap({
    url: liveUrl(roomsUrl, target.id),
    secret: target.secret,
    name,
    map: current,
    ...(connect && { connect }),
    onChange: (patch) => {
      current = applyPatch(current, patch);
    },
    onPeers: () => {},
    onIdle: () => {},
    onRefused: () => {
      refused = true;
      failed?.(new Error("The rooms server refused the edit link."));
    },
    onConnected: (next) => {
      if (next && !connected) ready?.();
      if (!next && connected) {
        notices.push(
          "The live link dropped. Edits wait here and go out once it is back.",
        );
      }
      connected = next;
    },
    onDropped: (reason) => {
      notices.push(
        droppedReasons[reason] ??
          "The rooms server turned an edit away, so it was taken back.",
      );
    },
  });
  const timer = setTimeout(
    () => failed?.(new Error(`The rooms server at ${roomsUrl} didn't answer.`)),
    timeoutMs,
  );
  try {
    await welcomed;
  } catch (error) {
    link.close();
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const store: McpMapStore = {
    update(step) {
      if (refused) throw new Error("The edit link no longer edits this map.");
      const { map, value } = step(current);
      if (map !== current) {
        const at = changedAt(current, map);
        link.send(map);
        if (map.name !== current.name) link.rename(map.name ?? "");
        current = map;
        if (at) link.cursor(at);
      }
      return value;
    },
    notices: () => notices.splice(0),
  };

  return {
    store,
    // Waits until the rooms server has every edit, then lets go of the link.
    async close(waitMs = 10_000) {
      const until = Date.now() + waitMs;
      while (!link.idle && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      link.close();
    },
  };
}

// Where an edit landed, so the others see the agent's pointer where it
// works.
function changedAt(before: GameMap, after: GameMap): Point | null {
  const patch = diffMaps(before, after);
  const touched = (name: "things" | "sectors" | "vertices") => [
    ...Object.keys(patch.set?.[name] ?? {}),
    ...Object.keys(patch.merge?.[name] ?? {}),
  ];
  const thing = after.things.find((item) =>
    touched("things").includes(item.id),
  );
  if (thing) return { x: thing.x, y: thing.y };
  const room = after.sectors.find((item) =>
    touched("sectors").includes(item.id),
  );
  const corners = room
    ? room.vertices.flatMap((id) => after.vertices[id] ?? [])
    : touched("vertices").flatMap((id) => after.vertices[id] ?? []);
  if (corners.length === 0) return null;
  const box = boxOf(corners);
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
}
