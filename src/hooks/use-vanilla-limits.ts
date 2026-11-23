import * as React from "react";

import type { CheckedIssue } from "@/lib/map/checks";
import type { GameMap } from "@/lib/map/types";
import type {
  VanillaCheckRequest,
  VanillaCheckResult,
} from "@/lib/wad/vanilla-worker";

import { compileLumps } from "@/lib/wad/compile";
import { vanillaLimits } from "@/lib/wad/limits";

const settleMs = 1200;
const none: CheckedIssue[] = [];

export interface VanillaLimits {
  issues: CheckedIssue[];
  pending: boolean;
}

interface Found {
  limits: { map: GameMap; issues: CheckedIssue[] } | null;
  views: { map: GameMap; issues: CheckedIssue[] } | null;
}

// Each check gets a fresh worker, so an edit stops a scan that is still
// looking from every spot of the map before it.
export function useVanillaLimits(map: GameMap): VanillaLimits {
  const [found, setFound] = React.useState<Found | null>(null);
  const vanilla = (map.complevel ?? "vanilla") === "vanilla";
  if (!vanilla && found) setFound(null);
  React.useEffect(() => {
    if (!vanilla || typeof Worker === "undefined") return;
    let worker: Worker | null = null;
    const timer = setTimeout(() => {
      worker = new Worker(
        new URL("../lib/wad/vanilla-worker.ts", import.meta.url),
        {
          type: "module",
        },
      );
      worker.addEventListener(
        "message",
        ({ data }: MessageEvent<VanillaCheckResult>) => {
          const result = { map, issues: data.issues };
          setFound((current) => ({
            limits:
              data.stage === "limits" ? result : (current?.limits ?? null),
            views: data.stage === "views" ? result : (current?.views ?? null),
          }));
          if (data.stage === "views") worker?.terminate();
        },
      );
      // Without the worker, the limits are checked on the page instead, and
      // the views go unchecked.
      worker.addEventListener("error", () => {
        worker?.terminate();
        let limits = none;
        try {
          limits = vanillaLimits(compileLumps(map));
        } catch {
          limits = none;
        }
        setFound({
          limits: { map, issues: limits },
          views: { map, issues: none },
        });
      });
      const request: VanillaCheckRequest = { map };
      worker.postMessage(request);
    }, settleMs);
    return () => {
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [map, vanilla]);
  // The last result holds until the next one lands, so warnings don't
  // flicker away on every edit.
  const issues = React.useMemo(
    () => [
      ...(found?.limits?.issues ?? none),
      ...(found?.views?.issues ?? none),
    ],
    [found],
  );
  return {
    issues: vanilla ? issues : none,
    pending:
      vanilla && (found?.limits?.map !== map || found.views?.map !== map),
  };
}
