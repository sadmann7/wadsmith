import type { GameMap } from "@/lib/map/types";

import {
  type CopiedPiece,
  parseFragment,
  serializeFragment,
} from "@/lib/map/fragment";

let held: CopiedPiece | null = null;

// The piece last copied in this tab, and the text of it for the system
// clipboard, which carries it to a map in another tab.
export function holdFragment(fragment: GameMap, origin: string) {
  held = { fragment, origin };
  return serializeFragment(fragment, origin);
}

// Clipboard text that holds a piece is at least as new as the one this tab
// remembers, so it takes its place.
export function heldFragment(text = "") {
  held = parseFragment(text) ?? held;
  return held;
}
