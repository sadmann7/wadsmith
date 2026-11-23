import type { CheckedIssue } from "@/lib/map/checks";
import type { GameMap } from "@/lib/map/types";

import { compileLumps } from "./compile";
import { vanillaLimits } from "./limits";
import { checkViews } from "./view-check";

export interface VanillaCheckRequest {
  map: GameMap;
}
// The limits arrive first, and the views once every spot has been looked from.
export interface VanillaCheckResult {
  stage: "limits" | "views";
  issues: CheckedIssue[];
}

const scope = self as unknown as Worker;

scope.addEventListener(
  "message",
  ({ data }: MessageEvent<VanillaCheckRequest>) => {
    let lumps;
    try {
      lumps = compileLumps(data.map);
    } catch {
      scope.postMessage({ stage: "limits", issues: [] });
      scope.postMessage({ stage: "views", issues: [] });
      return;
    }
    const limits: VanillaCheckResult = {
      stage: "limits",
      issues: vanillaLimits(lumps),
    };
    scope.postMessage(limits);
    let issues: CheckedIssue[] = [];
    try {
      issues = checkViews(data.map, lumps);
    } catch {
      // A view that can't be counted leaves the rest of the checks standing.
    }
    const views: VanillaCheckResult = { stage: "views", issues };
    scope.postMessage(views);
  },
);
