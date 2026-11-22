import * as React from "react";

import {
  buildCheckResult,
  buildChecksSnapshot,
  checkBuild,
  noBuildChecks,
  subscribeBuildChecks,
} from "@/lib/episodes/build-checks";
import type { EpisodeMap } from "@/lib/episodes/episode-data";

function useStartChecks(entries: EpisodeMap[]) {
  React.useEffect(() => {
    for (const entry of entries) if (!entry.broken) void checkBuild(entry);
  });
}

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
