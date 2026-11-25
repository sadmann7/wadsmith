import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";

import { sectorAt } from "@/lib/map/geometry";
import { testMap } from "@/lib/map/test-map";
import { createFlatAssets } from "@/lib/wad/assets";
import { decompileMap } from "@/lib/wad/decompile";
import { readMaps } from "@/lib/wad/read-map";

import { type Camera, startCamera } from "./render";
import type { SceneRenderer, SceneRendererKind } from "./scene-renderer";
import {
  editAt,
  frameStats,
  measureRenderer,
  runSpeedTest,
  type SpeedTestClock,
  type SpeedTestResult,
  speedTestEdits,
  speedTestPath,
  speedTestReport,
} from "./speed-test";

const wadPath = resolve(
  import.meta.dirname,
  "../../../public/engine/freedoom2.wad",
);
const assets = createFlatAssets();
const scene = { name: "Test map", map: testMap, assets, sky: "SKY1" };

interface Drawn {
  map: GameMap;
  camera: Camera;
  opened: readonly string[];
}

function fakeRenderer(kind: SceneRendererKind, clock: FakeClock) {
  const drawn: Drawn[] = [];
  let destroyed = 0;
  let reads = 0;
  const renderer: SceneRenderer = {
    kind,
    width: 320,
    height: 200,
    focal: 160,
    sizeFor: () => ({ width: 320, height: 200 }),
    resize: () => undefined,
    render(map, camera, options) {
      drawn.push({ map, camera, opened: options.opened ?? [] });
      clock.time += 4;
    },
    surfaceAt() {
      reads += 1;
      clock.time += 2;
      return { key: null, distance: Infinity };
    },
    surfaceCounts: () => new Map(),
    destroy() {
      destroyed += 1;
    },
  };
  return {
    renderer,
    drawn,
    destroyed: () => destroyed,
    reads: () => reads,
  };
}

interface FakeClock extends SpeedTestClock {
  time: number;
  frames: number;
}

// Frames start every gap milliseconds, plus whatever onFrame adds.
function fakeClock(
  gap = 10,
  onFrame?: (frame: number) => number | void,
): FakeClock {
  let stamp = 0;
  const clock: FakeClock = {
    time: 0,
    frames: 0,
    frame: async () => {
      clock.frames += 1;
      stamp += gap + (onFrame?.(clock.frames) ?? 0);
      clock.time = stamp;
      return stamp;
    },
    now: () => clock.time,
  };
  return clock;
}

describe("speedTestPath", () => {
  it("is the same every time for a map", () => {
    expect(speedTestPath(testMap, 120)).toEqual(speedTestPath(testMap, 120));
  });

  it("starts at the player start and stays inside the map", () => {
    const path = speedTestPath(testMap, 120);
    expect(path).toHaveLength(120);
    const start = startCamera(testMap);
    expect(path[0]).toMatchObject({ x: start.x, y: start.y });
    expect(path[0].angle).toBeCloseTo(start.angle);
    for (const camera of path) {
      expect(sectorAt(testMap, camera)).not.toBeNull();
      expect(Math.abs(camera.pitch ?? 0)).toBeLessThanOrEqual(0.15);
    }
  });

  it("turns once round at each room it stops in", () => {
    const path = speedTestPath(testMap, 120);
    const stops = new Set(path.map((camera) => `${camera.x},${camera.y}`));
    const share = path.length / stops.size;
    const turned = path[share - 1].angle - path[0].angle;
    expect(turned).toBeCloseTo(Math.PI * 2 * ((share - 1) / share));
  });

  it("still makes a path on a map with no rooms", () => {
    const empty: GameMap = { ...testMap, sectors: [], things: [] };
    expect(speedTestPath(empty, 10)).toHaveLength(10);
    expect(speedTestEdits(empty)).toEqual([]);
  });
});

describe.skipIf(!existsSync(wadPath))("speedTestPath on Freedoom", () => {
  it("stops in six rooms of MAP03 and never leaves the map", () => {
    const doom = readMaps([
      { name: "freedoom2.wad", data: readFileSync(wadPath) },
    ]).find((item) => item.slot === "MAP03");
    const map = decompileMap(doom!).map;
    const path = speedTestPath(map);
    expect(new Set(path.map((c) => `${c.x},${c.y}`)).size).toBe(6);
    for (const camera of path) expect(sectorAt(map, camera)).not.toBeNull();
    expect(speedTestEdits(map).map((edit) => edit.name)).toEqual([
      "floor height",
      "light",
      "wall offset",
      "corner move",
      "thing move",
      "open a door",
    ]);
  });
});

describe("speedTestEdits", () => {
  it("changes the map or the opened doors each time, leaving the map given", () => {
    const before = structuredClone(testMap);
    for (const edit of speedTestEdits(testMap)) {
      const next = edit.apply(testMap, [], 0);
      expect(next.map !== testMap || next.opened.length > 0).toBe(true);
    }
    expect(testMap).toEqual(before);
  });

  it("lands every 24 frames and takes turns", () => {
    const edits = speedTestEdits(testMap);
    expect(editAt(edits, 0)).toBeNull();
    expect(editAt(edits, 23)).toBeNull();
    expect(editAt(edits, 24)).toEqual({ edit: edits[0], step: 0 });
    expect(editAt(edits, 48)).toEqual({ edit: edits[1], step: 1 });
    expect(editAt([], 24)).toBeNull();
  });
});

describe("frameStats", () => {
  it("takes the median and 95th percentile", () => {
    const values = Array.from({ length: 100 }, (_, index) => 100 - index);
    expect(frameStats(values)).toEqual({ median: 51, p95: 96 });
  });

  it("is zero with nothing to count", () => {
    expect(frameStats([])).toEqual({ median: 0, p95: 0 });
  });
});

describe("measureRenderer", () => {
  it("times frames, draws and edits", async () => {
    const clock = fakeClock(10);
    const fake = fakeRenderer("columns", clock);
    const result = await measureRenderer(fake.renderer, scene, {
      frames: 120,
      clock,
    });
    expect(fake.drawn).toHaveLength(120);
    expect(result).toMatchObject({
      kind: "columns",
      width: 320,
      height: 200,
      frames: 120,
      frame: { median: 10, p95: 10 },
      fps: 100,
      draw: { median: 4, p95: 4 },
      firstFrame: 6,
    });
    expect(result.edits).toHaveLength(4);
    expect(result.edits.every((edit) => edit.ms === 6)).toBe(true);
    expect(fake.reads()).toBe(5);
    expect(fake.drawn[24].map).not.toBe(testMap);
    expect(fake.drawn[23].map).toBe(testMap);
  });

  it("leaves the frame after an edit out of the frame times", async () => {
    const clock = fakeClock(10, (frame) => (frame === 26 ? 50 : 0));
    const fake = fakeRenderer("webgl", clock);
    const result = await measureRenderer(fake.renderer, scene, {
      frames: 40,
      clock,
    });
    expect(result.frame.p95).toBe(10);
  });
});

describe("runSpeedTest", () => {
  const device = () => ({
    browser: "Test browser",
    gpu: "Test GPU",
    pixelRatio: 2,
    stage: { width: 640, height: 400 },
  });

  it("runs the column renderer and then WebGL, destroying each", async () => {
    const clock = fakeClock();
    const made = new Map<SceneRendererKind, ReturnType<typeof fakeRenderer>>();
    const result = await runSpeedTest({
      scene,
      clock,
      device,
      frames: 30,
      createRenderer: (kind) => {
        const fake = fakeRenderer(kind, clock);
        made.set(kind, fake);
        return fake.renderer;
      },
    });
    expect([...made.keys()]).toEqual(["columns", "webgl"]);
    expect(made.get("columns")!.destroyed()).toBe(1);
    expect(made.get("webgl")!.destroyed()).toBe(1);
    expect(result.renderers.map((item) => item.kind)).toEqual([
      "columns",
      "webgl",
    ]);
    expect(result.scene).toEqual({
      name: "Test map",
      rooms: testMap.sectors.length,
    });
  });

  it("says WebGL is missing when the browser falls back to columns", async () => {
    const clock = fakeClock();
    const fallbacks: ReturnType<typeof fakeRenderer>[] = [];
    const result = await runSpeedTest({
      scene,
      clock,
      device,
      frames: 30,
      createRenderer: () => {
        const fake = fakeRenderer("columns", clock);
        fallbacks.push(fake);
        return fake.renderer;
      },
    });
    expect(result.renderers[1]).toEqual({ kind: "webgl", missing: true });
    expect(fallbacks.every((fake) => fake.destroyed() === 1)).toBe(true);
  });

  it("stops when cancelled and still destroys the renderer", async () => {
    const controller = new AbortController();
    const clock = fakeClock(10, (frame) => {
      if (frame === 12) controller.abort();
    });
    const fake = fakeRenderer("columns", clock);
    const before = structuredClone(testMap);
    await expect(
      runSpeedTest({
        scene,
        clock,
        device,
        signal: controller.signal,
        createRenderer: () => fake.renderer,
      }),
    ).rejects.toThrow();
    expect(fake.destroyed()).toBe(1);
    expect(fake.drawn).toHaveLength(11);
    expect(testMap).toEqual(before);
  });
});

describe("speedTestReport", () => {
  it("reads as plain text to paste", () => {
    const result: SpeedTestResult = {
      scene: { name: "Freedoom MAP03", rooms: 475 },
      frames: 360,
      device: {
        browser: "Safari 19",
        gpu: null,
        pixelRatio: 2,
        stage: { width: 618, height: 386 },
      },
      renderers: [
        {
          kind: "columns",
          width: 989,
          height: 400,
          frames: 360,
          frame: { median: 16.66, p95: 18.21 },
          fps: 59.84,
          draw: { median: 9.12, p95: 12 },
          firstFrame: 25.3,
          edits: [
            { name: "floor height", ms: 9 },
            { name: "light", ms: 11 },
            { name: "floor height", ms: 10 },
          ],
        },
        { kind: "webgl", missing: true },
      ],
    };
    expect(speedTestReport(result)).toBe(
      [
        "Wadsmith 3D speed test",
        "Map: Freedoom MAP03, 475 rooms, 360 frames on a fixed path",
        "Browser: Safari 19",
        "GPU: not shown by this browser",
        "Device pixel ratio: 2",
        "View: 618×386 CSS pixels",
        "",
        "Column renderer",
        "  Canvas: 989×400",
        "  Frame time: median 16.7 ms, p95 18.2 ms, 59.8 fps",
        "  Draw time: median 9.1 ms, p95 12.0 ms",
        "  First frame: 25.3 ms",
        "  Edit to screen: median 10.0 ms, max 11.0 ms, 3 edits",
        "  By edit: floor height 10.0 ms, light 11.0 ms",
        "",
        "WebGL renderer",
        "  Not available in this browser",
      ].join("\n"),
    );
  });
});
