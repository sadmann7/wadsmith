import { useEffect, useSyncExternalStore } from "react";

import type { GameMap } from "../map/types";
import type { BuildCheckRequest, BuildCheckResult } from "./build-worker";
import { buildProblem, type ProjectMap } from "./episode-data";

type Check = {
  revision: number;
  result: Promise<string | null>;
  problem?: string | null;
};

// Building a big map's nodes takes seconds, so it runs off the page's thread
// once per saved revision.
const checks = new Map<string, Check>();
const waiting = new Map<
  number,
  { map: GameMap; done: (problem: string | null) => void }
>();
const listeners = new Set<() => void>();
let worker: Worker | null = null;
let nextId = 0;

function startWorker() {
  const started = new Worker(new URL("./build-worker.ts", import.meta.url), {
    type: "module",
  });
  started.addEventListener(
    "message",
    ({ data }: MessageEvent<BuildCheckResult>) => {
      waiting.get(data.id)?.done(data.problem);
      waiting.delete(data.id);
    },
  );
  // Without the worker, the waiting maps are built on the page instead, with
  // a frame between maps.
  started.addEventListener("error", async () => {
    const stranded = [...waiting.values()];
    waiting.clear();
    started.terminate();
    worker = null;
    for (const { map, done } of stranded) {
      await new Promise((next) => setTimeout(next));
      done(buildProblem(map));
    }
  });
  return started;
}

function checkBuild(entry: ProjectMap) {
  const known = checks.get(entry.id);
  if (known?.revision === entry.mapRevision) return known.result;
  const check: Check = {
    revision: entry.mapRevision,
    result: new Promise<string | null>((resolve) => {
      if (typeof Worker === "undefined") {
        resolve(buildProblem(entry.map));
        return;
      }
      worker ??= startWorker();
      const id = nextId++;
      waiting.set(id, { map: entry.map, done: resolve });
      const request: BuildCheckRequest = { id, map: entry.map };
      worker.postMessage(request);
    }).then((problem) => {
      check.problem = problem;
      for (const listener of listeners) listener();
      return problem;
    }),
  };
  checks.set(entry.id, check);
  return check.result;
}

function knownBuildProblem(entry: ProjectMap) {
  const known = checks.get(entry.id);
  return known?.revision === entry.mapRevision ? known.problem : undefined;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Rerenders when a check of one of these maps finishes, so knownBuildProblem
// catches up.
function useBuildChecks(entries: ProjectMap[]) {
  useSyncExternalStore(
    subscribe,
    () =>
      entries.filter((entry) => knownBuildProblem(entry) !== undefined).length,
    () => 0,
  );
  useEffect(() => {
    for (const entry of entries) if (!entry.broken) void checkBuild(entry);
  });
}

export { checkBuild, knownBuildProblem, useBuildChecks };
