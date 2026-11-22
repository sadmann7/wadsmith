import { describe, expect, it } from "vitest";

import { starterMap } from "@/lib/map/starter-map";

import {
  buildChecksSnapshot,
  checkBuild,
  subscribeBuildChecks,
} from "./build-checks";
import { createMapEntry } from "./episode-data";

describe("build checks", () => {
  it("replaces the snapshot and notifies listeners when a check finishes", async () => {
    const entry = createMapEntry("p", "MAP01", starterMap);
    const before = buildChecksSnapshot();
    expect(before.problem(entry)).toBeUndefined();
    let calls = 0;
    const stop = subscribeBuildChecks(() => {
      calls += 1;
    });
    const problem = await checkBuild(entry);
    stop();
    const after = buildChecksSnapshot();
    expect(calls).toBe(1);
    expect(after).not.toBe(before);
    expect(after.problem(entry)).toBe(problem);
    expect(after.lumps(entry)).not.toBeNull();
  });

  it("keeps the snapshot when a revision was already checked", async () => {
    const entry = createMapEntry("p", "MAP02", starterMap);
    await checkBuild(entry);
    const snapshot = buildChecksSnapshot();
    await checkBuild(entry);
    expect(buildChecksSnapshot()).toBe(snapshot);
  });
});
