import * as React from "react";

import {
  checkBuild,
  knownBuildProblem,
  subscribeBuildChecks,
} from "@/lib/episodes/build-checks";
import type { EpisodeMap } from "@/lib/episodes/episode-data";

// Rerenders when a check of one of these maps finishes, so knownBuildProblem
// catches up.
export function useBuildChecks(entries: EpisodeMap[]) {
  React.useSyncExternalStore(
    subscribeBuildChecks,
    () =>
      entries.filter((entry) => knownBuildProblem(entry) !== undefined).length,
    () => 0,
  );
  React.useEffect(() => {
    for (const entry of entries) if (!entry.broken) void checkBuild(entry);
  });
}
