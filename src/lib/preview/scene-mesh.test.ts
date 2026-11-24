import { describe, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";
import type { Picture, SceneAssets } from "@/lib/wad/assets";

import { defined } from "@/lib/defined";
import { addDetail, updateLine, updateLineSide } from "@/lib/map/edit";
import { sectorAt, sectorEdges, wallKey } from "@/lib/map/geometry";
import { islandMap, pillarMap, testMap } from "@/lib/map/test-map";
import { freedoomNames } from "@/lib/map/textures";

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
  vertexFloats,
} from "./scene-mesh";

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

const texelAssets: SceneAssets = {
  shades: Uint32Array.from({ length: 32 * 256 }, (_, index) => index & 255),
  names: freedoomNames,
  texture: () => texelPicture(64, 128),
  flat: () => texelPicture(64, 64),
  sprite: () => null,
  frame: () => null,
};

function wrap(value: number, size: number) {
  return ((Math.floor(value) % size) + size) % size;
}

// Draws the map with the column renderer and, for every wall pixel, checks
// the texel against the one the mesh's corners give at that spot.
function compareWalls(map: GameMap, camera: Camera) {
  const target = createRenderTarget(320, 200);
  renderScene(target, map, camera, {
    assets: texelAssets,
    fullbright: true,
    things: false,
  });
  const mesh = buildSceneMesh(withMovers(map, []), { assets: texelAssets });
  const { forward, right } = cameraBasis(camera);
  const eye = eyeOf(map, camera);
  const { vertices } = mesh;
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
    const mesh = buildSceneMesh(withMovers(islandMap, []), {
      assets: texelAssets,
    });
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
    const mesh = buildSceneMesh(map, { assets: texelAssets });
    expect(mesh.maskedCount).toBe(12);
    const heights = new Set<number>();
    for (let at = mesh.maskedStart; at < mesh.maskedStart + 12; at += 1) {
      const base = at * vertexFloats;
      expect(mesh.vertices[base + 9]).toBe(meshFlags.masked);
      heights.add(mesh.vertices[base + 2]);
    }
    const tallest = Math.max(...heights) - Math.min(...heights);
    expect(tallest).toBeLessThanOrEqual(128);
  });
});

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
