import * as React from "react";

import type { EpisodeMap } from "@/lib/episodes/episode-data";

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

export function useBuildProblem(entry: EpisodeMap) {
  useStartChecks([entry]);
  const result = React.useSyncExternalStore(
    subscribeBuildChecks,
    () => buildCheckResult(entry.id),
    () => undefined,
  );
  return result?.revision === entry.mapRevision
    ? result.build.problem
    : undefined;
}

function useStartChecks(entries: EpisodeMap[]) {
  React.useEffect(() => {
    for (const entry of entries) if (!entry.broken) void checkBuild(entry);
  });
}
