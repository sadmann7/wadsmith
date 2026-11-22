import type { GameMap } from "@/lib/map/types";

import {
  type CopiedPiece,
  parseFragment,
  serializeFragment,
} from "@/lib/map/fragment";

// A map's id is only its own within one browser, and a first map has the same
// id in every browser, so a piece is marked with this page as well.
const page = crypto.randomUUID();

let held: CopiedPiece | null = null;

// The mark a piece copied from this map on this page carries.
export function originOf(mapId: string) {
  return `${page}:${mapId}`;
}

// The piece last copied in this tab, and the text of it for the system
// clipboard, which carries it to a map in another tab.
export function holdFragment(fragment: GameMap, mapId: string) {
  const origin = originOf(mapId);
  held = { fragment, origin };
  return serializeFragment(fragment, origin);
}

// Clipboard text that holds a piece is at least as new as the one this tab
// remembers, so it takes its place.
export function heldFragment(text = "") {
  held = parseFragment(text) ?? held;
  return held;
}
