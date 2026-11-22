import type { GameMap } from "@/lib/map/types";
import type { Lump } from "@/lib/wad/compile";
import type { BuildCheckRequest, BuildCheckResult } from "./build-worker";
import { buildMap, type EpisodeMap } from "./episode-data";

type Build = Pick<BuildCheckResult, "problem" | "lumps">;

interface Check {
  revision: number;
  result: Promise<string | null>;
  build?: Build;
}

interface Job {
  id: number;
  map: GameMap;
  done: (build: Build) => void;
}

interface Builder {
  worker: Worker;
  job: Job | null;
}

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

export function checkBuild(entry: EpisodeMap) {
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

export function knownBuildProblem(entry: EpisodeMap) {
  return knownBuild(entry)?.problem;
}

export function knownLumps(entry: EpisodeMap): Lump[] | null {
  return knownBuild(entry)?.lumps ?? null;
}

export function subscribeBuildChecks(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
