import * as React from "react";

import type { EpisodeMap } from "@/lib/episodes/episode-data";
import type { CheckedIssue } from "@/lib/map/checks";

import {
  buildCheckResult,
  buildChecksSnapshot,
  checkBuild,
  noBuildChecks,
  subscribeBuildChecks,
} from "@/lib/episodes/build-checks";

export function useBuildChecks(entries: EpisodeMap[]) {
  useStartChecks(entries);
  const read = entries.length > 0 ? buildChecksSnapshot : () => noBuildChecks;
  return React.useSyncExternalStore(subscribeBuildChecks, read, read);
}

const noVanilla: CheckedIssue[] = [];

export function useBuildResult(entry: EpisodeMap) {
  useStartChecks([entry]);
  const result = React.useSyncExternalStore(
    subscribeBuildChecks,
    () => buildCheckResult(entry.id),
    () => undefined,
  );
  const build = result?.revision === entry.mapRevision ? result.build : null;
  return { problem: build?.problem, vanilla: build?.vanilla ?? noVanilla };
}

function useStartChecks(entries: EpisodeMap[]) {
  React.useEffect(() => {
    for (const entry of entries) if (!entry.broken) void checkBuild(entry);
  });
}
