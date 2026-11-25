import { describe, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";
import type { Picture, SceneAssets } from "@/lib/wad/assets";

import { defined } from "@/lib/defined";
import {
  addDetail,
  addThing,
  removeSector,
  updateLine,
  updateLineSide,
  updateSector,
  updateThing,
} from "@/lib/map/edit";
import { sectorAt, sectorEdges, wallKey } from "@/lib/map/geometry";
import { islandMap, pillarMap, testMap } from "@/lib/map/test-map";
import { freedoomNames } from "@/lib/map/textures";
import { gameTexturesOf } from "@/lib/wad/assets";

import { withMovers } from "./movers";
import {
  type Camera,
  cameraBasis,
  createRenderTarget,
  eyeOf,
  focalOf,
  pointOnPlane,
  projectPoint,
  renderScene,
  startCamera,
} from "./render";
import {
  buildSceneMesh,
  flatPieces,
  meshFlags,
  type SceneMesh,
  updateSceneMesh,
  vertexFloats,
} from "./scene-mesh";

const texelAssets: SceneAssets = {
  shades: Uint32Array.from({ length: 32 * 256 }, (_, index) => index & 255),
  names: freedoomNames,
  texture: () => texelPicture(64, 128),
  firstTexture: null,
  flatOrder: [],
  flat: () => texelPicture(64, 64),
  sprite: () => null,
  frame: () => null,
};

// Each texel's palette index is its column and row, four bits each, and the
// shades leave indexes as they are, so a drawn color names the texel drawn.
function texelPicture(width: number, height: number): Picture {
  const pixels = new Uint8Array(width * height);
  for (let column = 0; column < width; column += 1) {
    for (let row = 0; row < height; row += 1) {
      pixels[column * height + row] = ((column & 15) << 4) | (row & 15);
    }
  }
  return {
    width,
    height,
    leftOffset: 0,
    topOffset: 0,
    pixels,
    opaque: new Uint8Array(width * height).fill(1),
  };
}

describe("buildSceneMesh", () => {
  it("lays wall textures where the column renderer does", () => {
    const { checked, matched } = compareWalls(testMap, startCamera(testMap));
    expect(checked).toBeGreaterThan(5000);
    expect(matched / checked).toBeGreaterThan(0.97);
  });

  it("keeps offsets and pegging the column renderer's way", () => {
    let map = testMap;
    for (const sector of map.sectors) {
      for (const { from, to } of sectorEdges(sector)) {
        const wall = wallKey(from, to);
        map = updateLineSide(map, wall, sector.id, {
          offsetX: 13,
          offsetY: 7,
        });
        map = updateLine(map, wall, { upperFixed: true, lowerFixed: true });
      }
    }
    const camera = { ...startCamera(map), angle: 20 };
    const { checked, matched } = compareWalls(map, camera);
    expect(checked).toBeGreaterThan(5000);
    expect(matched / checked).toBeGreaterThan(0.97);
  });

  it("names every surface the column renderer shows", () => {
    const target = createRenderTarget(320, 200);
    const camera = startCamera(islandMap);
    renderScene(target, islandMap, camera, { assets: texelAssets });
    const mesh = buildSceneMesh(
      withMovers(islandMap, [], gameTexturesOf(texelAssets)),
      {
        assets: texelAssets,
      },
    );
    for (const key of new Set(target.surfaces.slice(1))) {
      expect(mesh.ids.has(key), key).toBe(true);
    }
  });

  it("hangs a line's middle texture both ways and no further than it reaches", () => {
    const added = defined(
      addDetail(
        testMap,
        [
          { x: 100, y: 100 },
          { x: 100, y: 200 },
        ],
        1,
      ),
    );
    const sector = defined(sectorAt(added.map, { x: 100, y: 150 }));
    const keysOf = (map: GameMap) =>
      sectorEdges(
        defined(map.sectors.find((item) => item.id === sector.id)),
      ).map(({ from, to }) => wallKey(from, to));
    const before = new Set(keysOf(testMap));
    const detail = defined(keysOf(added.map).find((key) => !before.has(key)));
    const map = updateLineSide(added.map, detail, sector.id, {
      middle: "MIDGRATE",
    });
    const masked = layers(buildSceneMesh(map, { assets: texelAssets })).masked;
    expect(masked.length).toBe(12 * vertexFloats);
    const heights = new Set<number>();
    for (let base = 0; base < masked.length; base += vertexFloats) {
      expect(masked[base + 9]).toBe(meshFlags.masked);
      heights.add(masked[base + 2]);
    }
    const tallest = Math.max(...heights) - Math.min(...heights);
    expect(tallest).toBeLessThanOrEqual(128);
  });
});

// Draws the map with the column renderer and, for every wall pixel, checks
// the texel against the one the mesh's corners give at that spot.
function compareWalls(map: GameMap, camera: Camera) {
  const target = createRenderTarget(320, 200);
  renderScene(target, map, camera, {
    assets: texelAssets,
    fullbright: true,
    things: false,
  });
  const mesh = buildSceneMesh(
    withMovers(map, [], gameTexturesOf(texelAssets)),
    { assets: texelAssets },
  );
  const { forward, right } = cameraBasis(camera);
  const eye = eyeOf(map, camera);
  const vertices = layers(mesh).solid;
  let checked = 0;
  let matched = 0;
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const index = y * target.width + x;
      const key = target.surfaces[target.pick[index]];
      if (!key?.startsWith("wall:")) continue;
      const id = mesh.ids.get(key);
      expect(id, key).toBeDefined();
      const distance = target.depth[index];
      const spread =
        ((2 * (x + 0.5)) / target.width - 1) * (160 / target.focal);
      const point = {
        x: camera.x + (forward.x + right.x * spread) * distance,
        y: camera.y + (forward.y + right.y * spread) * distance,
        z: eye + ((target.height / 2 - y - 0.5) * distance) / target.focal,
      };
      let best: { u: number; v: number; gap: number } | null = null;
      for (let at = 0; at < vertices.length; at += vertexFloats * 6) {
        if (vertices[at + 6] !== id) continue;
        const a = { x: vertices[at], y: vertices[at + 1] };
        const b = {
          x: vertices[at + vertexFloats],
          y: vertices[at + vertexFloats + 1],
        };
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const share =
          ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) /
          (length * length);
        const gap = Math.abs(
          ((point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x)) /
            length,
        );
        if (share < -0.01 || share > 1.01 || (best && gap >= best.gap)) {
          continue;
        }
        const uA = vertices[at + 3];
        const uB = vertices[at + vertexFloats + 3];
        const rowTop = vertices[at + 4] + vertices[at + 2];
        best = { u: uA + (uB - uA) * share, v: rowTop - point.z, gap };
      }
      if (!best) continue;
      checked += 1;
      const color = target.colors[index] & 255;
      if (
        color >> 4 === wrap(best.u, 64) % 16 &&
        (color & 15) === wrap(best.v, 128) % 16
      ) {
        matched += 1;
      }
    }
  }
  return { checked, matched };
}

function layers(mesh: SceneMesh) {
  const join = (part: "solid" | "flats" | "masked") => {
    const chunks = [...mesh.chunks.values()].map((chunk) => chunk[part]);
    const out = new Float32Array(chunks.reduce((sum, c) => sum + c.length, 0));
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  };
  return { solid: join("solid"), flats: join("flats"), masked: join("masked") };
}

function wrap(value: number, size: number) {
  return ((Math.floor(value) % size) + size) % size;
}

describe("updateSceneMesh", () => {
  const [wall] = sectorEdges(testMap.sectors[0]).map(({ from, to }) =>
    wallKey(from, to),
  );
  const corner = testMap.sectors[1].vertices[0];
  const edits: [string, GameMap, (map: GameMap) => GameMap][] = [
    ["a floor", testMap, (map) => updateSector(map, "sector-2", { floor: 24 })],
    ["a light", testMap, (map) => updateSector(map, "sector-1", { light: 96 })],
    [
      "a sky",
      testMap,
      (map) => updateSector(map, "sector-3", { ceilingTexture: "F_SKY1" }),
    ],
    [
      "an offset",
      testMap,
      (map) =>
        updateLineSide(map, wall, "sector-1", { offsetX: 13, offsetY: 7 }),
    ],
    [
      "a pegged line",
      testMap,
      (map) => updateLine(map, wall, { lowerFixed: true }),
    ],
    [
      "a corner",
      testMap,
      (map) => ({
        ...map,
        vertices: {
          ...map.vertices,
          [corner]: {
            x: map.vertices[corner].x + 16,
            y: map.vertices[corner].y - 8,
          },
        },
      }),
    ],
    [
      "a thing",
      testMap,
      (map) => updateThing(map, "imp-1", { x: 400, y: 120 }),
    ],
    [
      "a new thing",
      testMap,
      (map) => addThing(map, "medikit", { x: 300, y: 150 }).map,
    ],
    [
      "a removed room",
      islandMap,
      (map) => removeSector(map, map.sectors[1].id),
    ],
    [
      "a moved island",
      islandMap,
      (map) => ({
        ...map,
        vertices: Object.fromEntries(
          Object.entries(map.vertices).map(([id, point]) => [
            id,
            map.sectors[1].vertices.includes(id)
              ? { x: point.x + 32, y: point.y + 16 }
              : point,
          ]),
        ),
      }),
    ],
    [
      "an opened door",
      testMap,
      (map) => withMovers(map, ["sector-4"], gameTexturesOf(texelAssets)),
    ],
  ];

  it.each(edits)("ends where a fresh build does after %s", (_, start, edit) => {
    const options = { assets: texelAssets, sky: "SKY1" };
    const before = buildSceneMesh(start, options);
    const after = edit(start);
    const { mesh, changes } = updateSceneMesh(before, after, options);
    expect(changes.full).toBe(false);
    expect(described(mesh)).toEqual(described(buildSceneMesh(after, options)));
  });

  it("rebuilds only the rooms a height reaches", () => {
    const options = { assets: texelAssets };
    const mesh = buildSceneMesh(testMap, options);
    const { changes } = updateSceneMesh(
      mesh,
      updateSector(testMap, "sector-1", { light: 200 }),
      options,
    );
    expect(changes.sectors.toSorted()).toEqual(["sector-1", "sector-2"]);
    expect(changes.things).toEqual(["player-1"]);
  });
});

// A mesh by room and thing, with pictures and surfaces named, and floors and
// ceilings by the area they cover, since an update may cut them differently.
function described(mesh: SceneMesh) {
  const named = (vertices: Float32Array) => {
    const out: string[] = [];
    for (let at = 0; at < vertices.length; at += vertexFloats) {
      const row = [...vertices.subarray(at, at + vertexFloats)];
      row[5] = mesh.pictures[row[5]].key as never;
      row[6] = mesh.surfaces[row[6]] as never;
      out.push(row.join(","));
    }
    return out;
  };
  const sectors = Object.fromEntries(
    [...mesh.chunks].map(([id, chunk]) => {
      const planes = new Map<string, number>();
      for (let at = 0; at < chunk.flats.length; at += vertexFloats * 3) {
        const point = (index: number) => {
          const base = at + index * vertexFloats;
          return { x: chunk.flats[base], y: chunk.flats[base + 1] };
        };
        const [a, b, c] = [point(0), point(1), point(2)];
        const area = Math.abs(
          (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y),
        );
        const key = named(chunk.flats.subarray(at, at + vertexFloats))[0]
          .split(",")
          .filter((_, index) => index === 2 || index > 4)
          .join(",");
        planes.set(key, (planes.get(key) ?? 0) + area / 2);
      }
      return [
        id,
        {
          solid: named(chunk.solid),
          masked: named(chunk.masked),
          seeThrough: chunk.seeThrough.map((item) => mesh.surfaces[item]),
          planes: Object.fromEntries(
            [...planes].map(([key, area]) => [key, Math.round(area)]),
          ),
        },
      ];
    }),
  );
  const things = Object.fromEntries(
    [...mesh.sprites].map(([id, sprite]) => [id, named(sprite)]),
  );
  return { sectors, things };
}

describe("flatPieces", () => {
  it.each([
    ["the starter map", testMap],
    ["a room inside a room", islandMap],
    ["a pillar", pillarMap],
  ])("gives each spot to the room the 3D view finds there in %s", (_, map) => {
    const pieces = flatPieces(map);
    const xs = Object.values(map.vertices).map((point) => point.x);
    const ys = Object.values(map.vertices).map((point) => point.y);
    const [left, right] = [Math.min(...xs), Math.max(...xs)];
    const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
    const inside = (
      point: { x: number; y: number },
      corners: readonly { x: number; y: number }[],
    ) => {
      let isInside = false;
      corners.forEach((a, index) => {
        const b = corners[(index + 1) % corners.length];
        if (
          a.y > point.y !== b.y > point.y &&
          point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
        ) {
          isInside = !isInside;
        }
      });
      return isInside;
    };
    for (let step = 0; step < 400; step += 1) {
      const point = {
        x: left + ((step * 7919) % 997) * ((right - left) / 997) + 0.37,
        y: top + ((step * 104729) % 991) * ((bottom - top) / 991) + 0.41,
      };
      const owners = pieces
        .filter((piece) => inside(point, piece.corners))
        .map((piece) => piece.sector.id);
      const expected = sectorAt(map, point)?.id;
      expect(owners, `${point.x},${point.y}`).toEqual(
        expected ? [expected] : [],
      );
    }
  });
});

describe("a view that tilts", () => {
  const viewport = {
    width: 320,
    height: 200,
    focal: focalOf(200),
    tilts: true,
  };
  const camera = startCamera(testMap);

  it("matches the sheared view while level", () => {
    const point = { x: 250, y: 200 };
    const level = defined(projectPoint(viewport, testMap, camera, point, 0));
    const sheared = defined(
      projectPoint(createRenderTarget(320, 200), testMap, camera, point, 0),
    );
    expect(level.x).toBeCloseTo(sheared.x);
    expect(level.y).toBeCloseTo(sheared.y);
  });

  it("finds the floor point under a pixel while looking down", () => {
    const down = { ...camera, pitch: -0.9 };
    const point = { x: 220, y: 170 };
    const screen = defined(projectPoint(viewport, testMap, down, point, 0));
    const back = defined(
      pointOnPlane(viewport, testMap, down, screen.x, screen.y, 0),
    );
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });

  it("keeps the middle of the view on what it looks at", () => {
    const up = { ...camera, pitch: 0.4 };
    const { forward } = cameraBasis(up);
    const tilt = 0.4 / 0.8;
    const reach = 100;
    const plane = eyeOf(testMap, up) + Math.tan(tilt) * reach;
    const screen = defined(
      projectPoint(
        viewport,
        testMap,
        up,
        { x: up.x + forward.x * reach, y: up.y + forward.y * reach },
        plane,
      ),
    );
    expect(screen.x).toBeCloseTo(160);
    expect(screen.y).toBeCloseTo(100);
  });
});
