import * as React from "react";

import type { GameMap } from "../map/types";
import type { Lump } from "../wad/compile";
import type { BuildCheckRequest, BuildCheckResult } from "./build-worker";
import { buildMap, type EpisodeMap } from "./episode-data";

type Build = Pick<BuildCheckResult, "problem" | "lumps">;

type Check = {
  revision: number;
  result: Promise<string | null>;
  build?: Build;
};

type Job = { id: number; map: GameMap; done: (build: Build) => void };

type Builder = { worker: Worker; job: Job | null };

// Building a big map's nodes takes seconds, so it runs off the page's thread
// once per saved revision, on a few workers at once.
const checks = new Map<string, Check>();
const queue: Job[] = [];
const builders: Builder[] = [];
const listeners = new Set<() => void>();
let nextId = 0;

function builderLimit() {
  return Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
}

function startBuilder() {
  const builder: Builder = {
    worker: new Worker(new URL("./build-worker.ts", import.meta.url), {
      type: "module",
    }),
    job: null,
  };
  builder.worker.addEventListener(
    "message",
    ({ data }: MessageEvent<BuildCheckResult>) => {
      if (builder.job?.id !== data.id) return;
      builder.job.done(data);
      builder.job = null;
      runQueue();
    },
  );
  // Without the worker, its map is built on the page instead, a frame later.
  builder.worker.addEventListener("error", async () => {
    const { job } = builder;
    builder.worker.terminate();
    builders.splice(builders.indexOf(builder), 1);
    runQueue();
    if (!job) return;
    await new Promise((next) => setTimeout(next));
    job.done(buildMap(job.map));
  });
  builders.push(builder);
  return builder;
}

function runQueue() {
  while (queue.length > 0) {
    const builder =
      builders.find((item) => !item.job) ??
      (builders.length < builderLimit() ? startBuilder() : null);
    if (!builder) return;
    const job = queue.shift()!;
    builder.job = job;
    const request: BuildCheckRequest = { id: job.id, map: job.map };
    builder.worker.postMessage(request);
  }
}

function checkBuild(entry: EpisodeMap) {
  const known = checks.get(entry.id);
  if (known?.revision === entry.mapRevision) return known.result;
  const check: Check = {
    revision: entry.mapRevision,
    result: new Promise<Build>((resolve) => {
      if (typeof Worker === "undefined") {
        resolve(buildMap(entry.map));
        return;
      }
      queue.push({ id: nextId++, map: entry.map, done: resolve });
      runQueue();
    }).then((build) => {
      check.build = build;
      for (const listener of listeners) listener();
      return build.problem;
    }),
  };
  checks.set(entry.id, check);
  return check.result;
}

function knownBuild(entry: EpisodeMap) {
  const known = checks.get(entry.id);
  return known?.revision === entry.mapRevision ? known.build : undefined;
}

function knownBuildProblem(entry: EpisodeMap) {
  return knownBuild(entry)?.problem;
}

function knownLumps(entry: EpisodeMap): Lump[] | null {
  return knownBuild(entry)?.lumps ?? null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Rerenders when a check of one of these maps finishes, so knownBuildProblem
// catches up.
function useBuildChecks(entries: EpisodeMap[]) {
  React.useSyncExternalStore(
    subscribe,
    () =>
      entries.filter((entry) => knownBuildProblem(entry) !== undefined).length,
    () => 0,
  );
  React.useEffect(() => {
    for (const entry of entries) if (!entry.broken) void checkBuild(entry);
  });
}

export { checkBuild, knownBuildProblem, knownLumps, useBuildChecks };
