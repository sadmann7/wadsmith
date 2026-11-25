import type { GameMap, Sector } from "@/lib/map/types";

import { defaultGame, defaultSky } from "@/lib/engine/game";
import { fetchFreedoom } from "@/lib/engine/iwad";
import { updateLineSide, updateSector, updateThing } from "@/lib/map/edit";
import {
  clearView,
  roomPoint,
  sectorAt,
  sectorEdges,
  sectorPolygon,
  signedArea,
  wallKey,
} from "@/lib/map/geometry";
import { readWadAssets, type SceneAssets } from "@/lib/wad/assets";
import { decompileMap } from "@/lib/wad/decompile";
import { readMaps } from "@/lib/wad/read-map";

import type { SceneRenderer, SceneRendererKind } from "./scene-renderer";

import { getIsMover } from "./movers";
import { type Camera, startCamera } from "./render";

export const speedTestFrames = 360;

const warmupFrames = 10;
const editEvery = 24;
const pitchSwing = 0.15;

export interface SpeedTestScene {
  name: string;
  map: GameMap;
  assets: SceneAssets;
  sky: string | null;
}

export const freedoomSlot = "MAP03";

// The bundled map, the same on every device, so runs compare.
export async function loadFreedoomScene(): Promise<SpeedTestScene> {
  const { data } = await fetchFreedoom();
  const doom = readMaps([{ name: "freedoom2.wad", data }]).find(
    (item) => item.slot === freedoomSlot,
  );
  if (!doom) throw new Error(`Freedoom has no ${freedoomSlot}.`);
  return {
    name: `Freedoom ${freedoomSlot}`,
    map: decompileMap(doom).map,
    assets: readWadAssets(data),
    sky: defaultSky(freedoomSlot, defaultGame),
  };
}

export interface SpeedTestEdit {
  name: string;
  apply: (
    map: GameMap,
    opened: string[],
    step: number,
  ) => {
    map: GameMap;
    opened: string[];
  };
}

export interface FrameStats {
  median: number;
  p95: number;
}

export interface RendererResult {
  kind: SceneRendererKind;
  width: number;
  height: number;
  frames: number;
  frame: FrameStats;
  fps: number;
  draw: FrameStats;
  firstFrame: number;
  edits: { name: string; ms: number }[];
}

export interface SpeedTestDevice {
  browser: string;
  gpu: string | null;
  pixelRatio: number;
  stage: { width: number; height: number };
}

export interface SpeedTestResult {
  scene: { name: string; rooms: number };
  frames: number;
  device: SpeedTestDevice;
  renderers: (RendererResult | { kind: SceneRendererKind; missing: true })[];
}

export interface SpeedTestClock {
  frame: () => Promise<number>;
  now: () => number;
}

// Each station is a room the camera stands in for an equal share of the
// frames, turning once round and nodding, so every frame is drawn from inside
// the map. The path depends only on the map.
export function speedTestPath(map: GameMap, frames = speedTestFrames) {
  const stations = pathStations(map);
  const share = frames / stations.length;
  return Array.from({ length: frames }, (_, index): Camera => {
    const at = Math.min(stations.length - 1, Math.floor(index / share));
    const local = (index - at * share) / share;
    const station = stations[at];
    return {
      x: station.x,
      y: station.y,
      angle: station.angle + local * Math.PI * 2,
      pitch: pitchSwing * Math.sin(local * Math.PI * 4),
      lift: 0,
    };
  });
}

// The edits a person makes most, each on the same room, wall, corner, thing
// and door of a map every run.
export function speedTestEdits(map: GameMap): SpeedTestEdit[] {
  const rooms = map.sectors.filter(
    (sector) => !sector.door && sector.vertices.length >= 3,
  );
  const room = rooms[Math.floor(rooms.length / 2)];
  const thing = map.things[Math.floor(map.things.length / 2)];
  const door = map.sectors.find(
    (sector) => sector.door || getIsMover(map, sector.id),
  );
  const edits: SpeedTestEdit[] = [];
  if (room) {
    const wall = sectorEdges(room).map(({ from, to }) => wallKey(from, to))[0];
    const corner = room.vertices[0];
    edits.push(
      {
        name: "floor height",
        apply: (next, opened, step) => ({
          map: updateSector(next, room.id, {
            floor: room.floor + 8 * (1 + (step % 4)),
          }),
          opened,
        }),
      },
      {
        name: "light",
        apply: (next, opened, step) => ({
          map: updateSector(next, room.id, { light: 64 + 16 * (step % 8) }),
          opened,
        }),
      },
    );
    if (wall) {
      edits.push({
        name: "wall offset",
        apply: (next, opened, step) => ({
          map: updateLineSide(next, wall, room.id, { offsetX: step % 64 }),
          opened,
        }),
      });
    }
    const point = map.vertices[corner];
    if (point) {
      edits.push({
        name: "corner move",
        apply: (next, opened, step) => ({
          map: {
            ...next,
            vertices: {
              ...next.vertices,
              [corner]: { x: point.x + 1 + (step % 4), y: point.y },
            },
          },
          opened,
        }),
      });
    }
  }
  if (thing) {
    edits.push({
      name: "thing move",
      apply: (next, opened, step) => ({
        map: updateThing(next, thing.id, { x: thing.x + 1 + (step % 4) }),
        opened,
      }),
    });
  }
  if (door) {
    edits.push({
      name: "open a door",
      apply: (next, opened) => ({
        map: next,
        opened: opened.includes(door.id) ? [] : [door.id],
      }),
    });
  }
  return edits;
}

// Which edit, if any, lands on a frame.
export function editAt(edits: SpeedTestEdit[], index: number) {
  if (edits.length === 0 || index === 0 || index % editEvery !== 0) {
    return null;
  }
  const step = index / editEvery - 1;
  return { edit: edits[step % edits.length], step };
}

export function frameStats(values: readonly number[]): FrameStats {
  if (values.length === 0) return { median: 0, p95: 0 };
  const sorted = values.toSorted((a, b) => a - b);
  const at = (share: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
  return { median: at(0.5), p95: at(0.95) };
}

// Draws the path once on a renderer and times it. Frames that carry an edit
// read a pixel back, which waits for the GPU to finish drawing it, so the
// gap after one is left out of the frame times.
export async function measureRenderer(
  renderer: SceneRenderer,
  scene: SpeedTestScene,
  {
    frames = speedTestFrames,
    clock,
    signal,
    onProgress,
  }: {
    frames?: number;
    clock: SpeedTestClock;
    signal?: AbortSignal;
    onProgress?: (frame: number) => void;
  },
): Promise<RendererResult> {
  const cameras = speedTestPath(scene.map, frames);
  const edits = speedTestEdits(scene.map);
  const options = { assets: scene.assets, sky: scene.sky };
  const middle = {
    x: Math.floor(renderer.width / 2),
    y: Math.floor(renderer.height / 2),
  };
  let map = scene.map;
  let opened: string[] = [];
  const stamps: number[] = [];
  const draws: number[] = [];
  const edited = new Set<number>();
  const editTimes: { name: string; ms: number }[] = [];
  let firstFrame = 0;
  for (let index = 0; index < frames; index += 1) {
    signal?.throwIfAborted();
    stamps.push(await clock.frame());
    signal?.throwIfAborted();
    const planned = editAt(edits, index);
    if (planned) {
      ({ map, opened } = planned.edit.apply(map, opened, planned.step));
    }
    const start = clock.now();
    renderer.render(map, cameras[index], { ...options, opened }, null);
    if (planned || index === 0) renderer.surfaceAt(middle.x, middle.y);
    const ms = clock.now() - start;
    if (index === 0) firstFrame = ms;
    else if (planned) {
      edited.add(index);
      editTimes.push({ name: planned.edit.name, ms });
    } else draws.push(ms);
    onProgress?.(index + 1);
  }
  const gaps: number[] = [];
  for (let index = warmupFrames + 1; index < stamps.length; index += 1) {
    if (edited.has(index - 1)) continue;
    gaps.push(stamps[index] - stamps[index - 1]);
  }
  const total = gaps.reduce((sum, gap) => sum + gap, 0);
  return {
    kind: renderer.kind,
    width: renderer.width,
    height: renderer.height,
    frames,
    frame: frameStats(gaps),
    fps: total > 0 ? (gaps.length * 1000) / total : 0,
    draw: frameStats(draws.slice(warmupFrames)),
    firstFrame,
    edits: editTimes,
  };
}

// Runs each renderer in turn on a renderer made for it, and always destroys
// that renderer, also when the run is cancelled.
export async function runSpeedTest({
  scene,
  kinds = ["columns", "webgl"],
  createRenderer,
  device,
  clock,
  frames = speedTestFrames,
  signal,
  onProgress,
}: {
  scene: SpeedTestScene;
  kinds?: SceneRendererKind[];
  createRenderer: (kind: SceneRendererKind) => SceneRenderer | null;
  device: () => SpeedTestDevice;
  clock: SpeedTestClock;
  frames?: number;
  signal?: AbortSignal;
  onProgress?: (kind: SceneRendererKind, frame: number) => void;
}): Promise<SpeedTestResult> {
  const renderers: SpeedTestResult["renderers"] = [];
  for (const kind of kinds) {
    signal?.throwIfAborted();
    const renderer = createRenderer(kind);
    if (!renderer || renderer.kind !== kind) {
      renderer?.destroy();
      renderers.push({ kind, missing: true });
      continue;
    }
    try {
      renderers.push(
        await measureRenderer(renderer, scene, {
          frames,
          clock,
          signal,
          onProgress: (frame) => onProgress?.(kind, frame),
        }),
      );
    } finally {
      renderer.destroy();
    }
  }
  return {
    scene: { name: scene.name, rooms: scene.map.sectors.length },
    frames,
    device: device(),
    renderers,
  };
}

const stationLimit = 6;

function pathStations(map: GameMap) {
  const start = startCamera(map);
  const startRoom = sectorAt(map, start);
  const rooms = map.sectors
    .filter((sector) => !sector.door && sector.id !== startRoom?.id)
    .map((sector) => ({ sector, area: Math.abs(areaOf(map, sector)) }))
    .filter(({ area }) => area > 0)
    .sort((a, b) => b.area - a.area || a.sector.id.localeCompare(b.sector.id))
    .slice(0, stationLimit - 1)
    .flatMap(({ sector }) => {
      const at = roomPoint(map, sector);
      if (sectorAt(map, at)?.id !== sector.id) return [];
      return [{ ...at, angle: clearView(map, sector, at) }];
    });
  const stations = [start];
  while (rooms.length > 0) {
    const last = stations[stations.length - 1];
    let nearest = 0;
    for (let index = 1; index < rooms.length; index += 1) {
      if (distance(last, rooms[index]) < distance(last, rooms[nearest])) {
        nearest = index;
      }
    }
    stations.push(...rooms.splice(nearest, 1));
  }
  return stations;
}

function areaOf(map: GameMap, sector: Sector) {
  return sector.vertices.length >= 3
    ? signedArea(sectorPolygon(map, sector))
    : 0;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const rendererNames: Record<SceneRendererKind, string> = {
  columns: "Column renderer",
  webgl: "WebGL renderer",
};

export function speedTestReport(result: SpeedTestResult) {
  const { device } = result;
  const lines = [
    "Wadsmith 3D speed test",
    `Map: ${result.scene.name}, ${result.scene.rooms} rooms, ${result.frames} frames on a fixed path`,
    `Browser: ${device.browser}`,
    `GPU: ${device.gpu ?? "not shown by this browser"}`,
    `Device pixel ratio: ${device.pixelRatio}`,
    `View: ${device.stage.width}×${device.stage.height} CSS pixels`,
  ];
  for (const item of result.renderers) {
    lines.push("", rendererNames[item.kind]);
    if ("missing" in item) {
      lines.push("  Not available in this browser");
      continue;
    }
    const editMs = item.edits.map((edit) => edit.ms);
    const byName = new Map<string, number[]>();
    for (const edit of item.edits) {
      byName.set(edit.name, [...(byName.get(edit.name) ?? []), edit.ms]);
    }
    lines.push(
      `  Canvas: ${item.width}×${item.height}`,
      `  Frame time: median ${ms(item.frame.median)}, p95 ${ms(item.frame.p95)}, ${item.fps.toFixed(1)} fps`,
      `  CPU time per frame: median ${ms(item.draw.median)}, p95 ${ms(item.draw.p95)}`,
      `  First frame: ${ms(item.firstFrame)}`,
    );
    if (editMs.length > 0) {
      lines.push(
        `  Edit to screen: median ${ms(frameStats(editMs).median)}, max ${ms(Math.max(...editMs))}, ${editMs.length} edits`,
        `  By edit: ${[...byName].map(([name, values]) => `${name} ${ms(frameStats(values).median)}`).join(", ")}`,
      );
    }
  }
  return lines.join("\n");
}

export function gpuName() {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!gl) return null;
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name: unknown = gl.getParameter(
    info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER,
  );
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return typeof name === "string" && name ? name : null;
}

export const animationClock: SpeedTestClock = {
  frame: () => new Promise((resolve) => requestAnimationFrame(resolve)),
  now: () => performance.now(),
};

function ms(value: number) {
  return `${value.toFixed(1)} ms`;
}
