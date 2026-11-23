import * as React from "react";

import type { CheckedIssue } from "@/lib/map/checks";
import type { GameMap } from "@/lib/map/types";

import { buildInBackground } from "@/lib/episodes/build-checks";
import { vanillaLimits } from "@/lib/wad/limits";

const settleMs = 1200;
const none: CheckedIssue[] = [];

export interface VanillaLimits {
  issues: CheckedIssue[];
  pending: boolean;
}

export function useVanillaLimits(map: GameMap): VanillaLimits {
  const [found, setFound] = React.useState<{
    map: GameMap;
    issues: CheckedIssue[];
  } | null>(null);
  const vanilla = (map.complevel ?? "vanilla") === "vanilla";
  if (!vanilla && found) setFound(null);
  React.useEffect(() => {
    if (!vanilla) return;
    const stop = new AbortController();
    const timer = setTimeout(() => {
      void buildInBackground(map, stop.signal).then(({ lumps }) => {
        if (stop.signal.aborted) return;
        setFound({ map, issues: lumps ? vanillaLimits(lumps) : none });
      });
    }, settleMs);
    return () => {
      stop.abort();
      clearTimeout(timer);
    };
  }, [map, vanilla]);
  // The last result holds until the next build lands, so warnings don't
  // flicker away on every edit.
  return {
    issues: vanilla ? (found?.issues ?? none) : none,
    pending: vanilla && found?.map !== map,
  };
}
