import type { CheckedIssue } from "@/lib/map/checks";
import type { GameMap } from "@/lib/map/types";

import type { Lump } from "./compile";

import { vanillaLimits } from "./limits";
import { checkViews } from "./view-check";

export function vanillaWarnings(map: GameMap, lumps: Lump[]): CheckedIssue[] {
  if ((map.complevel ?? "vanilla") !== "vanilla") return [];
  return [...vanillaLimits(lumps), ...checkViews(map, lumps)];
}
