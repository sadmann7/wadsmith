import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { thingKinds } from "../map/catalog";
import { updateLine, updateLineSide, updateSector } from "../map/edit";
import { parseMapFile, serializeMap } from "../map/storage";
import { wallKey } from "../map/geometry";
import { makePillar } from "../map/edit";
import { islandMap, testMap } from "../map/test-map";
import {
  describeSurface,
  moveSurfaceHeight,
  paintSurface,
} from "../map/surfaces";
import type { GameMap } from "../map/types";
import { compileLumps } from "../wad/compile";
import {
  createFlatAssets,
  gameFlatShade,
  gameWallShade,
  readWadAssets,
  type SceneAssets,
} from "../wad/assets";
import {
  createRenderTarget,
  pointOnPlane,
  projectPoint,
  renderScene,
  startCamera,
} from "./render";

const assets = createFlatAssets();
const wadPath = resolve(
  import.meta.dirname,
  "../../public/engine/freedoom2.wad",
);

function renderStarter(map = testMap, camera = startCamera(map)) {
  const target = createRenderTarget(320, 200);
  expect(renderScene(target, map, camera, { assets })).toBe(true);
  return (x: number, y: number) => target.surfaces[target.pick[y * 320 + x]];
}

const stripes = {
  width: 64,
  height: 64,
  leftOffset: 0,
  topOffset: 0,
  pixels: Uint8Array.from({ length: 64 * 64 }, (_, index) => index >> 6),
  opaque: new Uint8Array(64 * 64).fill(1),
};
const stripedAssets: SceneAssets = {
  ...assets,
  shades: Uint32Array.from({ length: 256 * 32 }, (_, index) => index % 256),
  texture: () => stripes,
};

function columnAhead(vertices: string[], offsetX?: number) {
  const room: GameMap = {
    vertices: {
      a: { x: 0, y: 0 },
      b: { x: 128, y: 0 },
      c: { x: 128, y: 96 },
      d: { x: 0, y: 96 },
    },
    sectors: [{ ...testMap.sectors[0], vertices }],
    things: [],
    switches: [],
  };
  const map = updateLineSide(room, wallKey("b", "c"), room.sectors[0].id, {
    offsetX,
  });
  const target = createRenderTarget(320, 200);
  renderScene(
    target,
    map,
    { x: 64, y: 40, angle: 0 },
    { assets: stripedAssets },
  );
  return target.colors[100 * 320 + 160];
}

describe("renderScene", () => {
  it("runs wall textures from the viewer's left in either winding", () => {
    expect(columnAhead(["a", "b", "c", "d"])).toBe(40);
    expect(columnAhead(["d", "c", "b", "a"])).toBe(40);
  });

  it("shifts a wall by its side's offset", () => {
    expect(columnAhead(["a", "b", "c", "d"], 8)).toBe(48);
    expect(columnAhead(["d", "c", "b", "a"], -8)).toBe(32);
  });

  it("records which surface each pixel shows", () => {
    const at = renderStarter();
    expect(at(160, 190)).toBe("floor:sector-1");
    expect(at(160, 5)).toBe("ceiling:sector-1");
    expect(at(4, 100)).toMatch(/^wall:sector-1:/);
  });

  it("shows a door as closed", () => {
    const at = renderStarter();
    expect(at(160, 96)).toMatch(/^wall:sector-2:.*:upper$/);
  });

  it("shows an edit after rendering the map before it", () => {
    expect(renderStarter()(160, 96)).toMatch(/upper$/);
    const opened = {
      ...testMap,
      sectors: testMap.sectors.map((sector) =>
        sector.id === "sector-4" ? { ...sector, door: undefined } : sector,
      ),
    };
    expect(renderStarter(opened)(160, 96)).not.toMatch(/upper$/);
    expect(renderStarter()(160, 96)).toMatch(/upper$/);
  });

  it("makes things selectable", () => {
    const map = {
      ...testMap,
      things: [
        ...testMap.things,
        { id: "imp-2", kind: "imp" as const, x: 200, y: 160, angle: 0 },
      ],
    };
    expect(renderStarter(map)(160, 100)).toBe("thing:imp-2");
  });

  it("outlines the selected surface without recoloring it", () => {
    const plain = createRenderTarget(320, 200);
    const outlined = createRenderTarget(320, 200);
    const camera = startCamera(testMap);
    renderScene(plain, testMap, camera, { assets });
    renderScene(outlined, testMap, camera, {
      assets,
      selected: "floor:sector-1",
    });
    const inside = 190 * 320 + 160;
    expect(outlined.pick[inside]).toBe(plain.pick[inside]);
    expect(outlined.colors[inside]).toBe(plain.colors[inside]);
    expect(outlined.colors.some((color) => color === 0xff2b6aff)).toBe(true);
    expect(outlined.colors[5 * 320 + 160]).toBe(plain.colors[5 * 320 + 160]);
  });

  it("draws a placement ghost that can't be picked", () => {
    const camera = startCamera(testMap);
    const plain = createRenderTarget(320, 200);
    const ghosted = createRenderTarget(320, 200);
    renderScene(plain, testMap, camera, { assets });
    renderScene(ghosted, testMap, camera, {
      assets,
      ghost: { kind: "imp", x: 200, y: 160 },
    });
    const pixel = 105 * 320 + 160;
    expect(ghosted.colors[pixel]).not.toBe(plain.colors[pixel]);
    expect(ghosted.pick[pixel]).toBe(plain.pick[pixel]);
    expect(ghosted.surfaces).not.toContain("thing:");
  });

  it("converts between floor points and the screen", () => {
    const target = createRenderTarget(320, 200);
    const camera = startCamera(testMap);
    const point = { x: 250, y: 200 };
    const screen = projectPoint(target, testMap, camera, point, 0)!;
    const back = pointOnPlane(target, testMap, camera, screen.x, screen.y, 0)!;
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });

  it("finds no floor above the horizon", () => {
    const target = createRenderTarget(320, 200);
    const camera = startCamera(testMap);
    expect(pointOnPlane(target, testMap, camera, 160, 20, 0)).toBeNull();
  });

  it("moves a floor on screen when its height changes", () => {
    const raised = updateSector(testMap, "sector-2", { floor: 24 });
    const before = renderStarter();
    const after = renderStarter(raised);
    const count = (read: typeof before) =>
      Array.from({ length: 200 }, (_, y) => read(160, y)).filter((key) =>
        key.endsWith(":lower"),
      ).length;
    expect(count(after)).toBeGreaterThan(count(before));
  });
});

describe("surface edits", () => {
  const wall = wallKey("v1", "v15");
  const wallSurface = `wall:sector-1:${wall}:middle`;

  it("keeps floors below ceilings", () => {
    const map = moveSurfaceHeight(testMap, "floor:sector-1", 4000);
    expect(map.sectors[0].floor).toBe(120);
  });

  it("paints one wall and compiles it", () => {
    const map = paintSurface(testMap, wallSurface, "BRICK1");
    expect(describeSurface(map, wallSurface)?.texture).toBe("BRICK1");
    const sidedefs = compileLumps(map).find((l) => l.name === "SIDEDEFS")!;
    const text = String.fromCharCode(...sidedefs.data);
    expect(text.match(/BRICK1/g)).toHaveLength(1);
  });

  it("paints every wall in a room", () => {
    const painted = paintSurface(testMap, wallSurface, "BRICK1");
    const map = paintSurface(painted, wallSurface, "GRAY1", true);
    expect(map.sectors[0].wallTexture).toBe("GRAY1");
    expect(map.sectors[0].wallOverrides).toBeUndefined();
  });

  it("paints one part of a shared wall on one side", () => {
    const shared = wallKey("v3", "v4");
    const lower = `wall:sector-1:${shared}:lower`;
    const map = paintSurface(testMap, lower, "BRICK1");
    expect(describeSurface(map, lower)?.texture).toBe("BRICK1");
    expect(describeSurface(map, `wall:sector-2:${shared}:lower`)?.texture).toBe(
      testMap.sectors[1].wallTexture,
    );
    const repainted = paintSurface(map, lower, "GRAY1", true);
    expect(repainted.lines).toBeUndefined();
  });

  it("offers switch textures on a switched open wall, but not for the whole room", () => {
    const shared = wallKey("v3", "v4");
    const lower = `wall:sector-1:${shared}:lower`;
    expect(describeSurface(testMap, lower)?.textures).not.toContain("SW1GRAY");
    const switched = updateLine(testMap, shared, {
      action: { kind: "floor-lower", trigger: "switch", repeat: true, tag: 0 },
    });
    expect(describeSurface(switched, lower)?.textures).toContain("SW1GRAY");
    const map = paintSurface(switched, lower, "SW1GRAY");
    expect(describeSurface(map, lower)?.texture).toBe("SW1GRAY");
    expect(parseMapFile(serializeMap(map))).toEqual(map);
    expect(paintSurface(map, lower, "SW1GRAY", true)).toBe(map);
  });

  it("paints the door from its face", () => {
    const face = `wall:sector-2:${wallKey("v13", "v14")}:upper`;
    const map = paintSurface(testMap, face, "DOOR3");
    expect(map.sectors[3].door?.texture).toBe("DOOR3");
  });

  it("paints a switch from its wall", () => {
    const face = `wall:sector-1:${wallKey("v15", "v16")}:middle`;
    expect(describeSurface(testMap, face)?.paints).toBe("switch");
    const map = paintSurface(testMap, face, "SW1GRAY");
    expect(map.switches[0].texture).toBe("SW1GRAY");
  });
});

describe("game lighting", () => {
  it("follows the engine's light bands", () => {
    expect(gameWallShade(255)).toBe(0);
    expect(gameWallShade(176)).toBe(8);
    expect(gameWallShade(160)).toBe(12);
    expect(gameWallShade(112)).toBe(24);
    expect(gameWallShade(0)).toBe(31);
  });

  it("darkens walls and floors with distance", () => {
    expect(gameWallShade(160, 80)).toBe(4);
    expect(gameWallShade(160, 640)).toBe(18);
    expect(gameWallShade(160, 160, -1)).toBe(16);
    expect(gameFlatShade(160, 80)).toBe(7);
    expect(gameFlatShade(160, 4096)).toBe(20);
  });
});

describe.skipIf(!existsSync(wadPath))("readWadAssets", () => {
  it("composes textures, flats and sprites from Freedoom", () => {
    const wad = readWadAssets(readFileSync(wadPath));
    expect(wad.texture("STARTAN3").width).toBeGreaterThan(1);
    expect(new Set(wad.texture("STARTAN3").pixels).size).toBeGreaterThan(4);
    expect(wad.flat("FLOOR4_8").width).toBe(64);
    expect(new Set(wad.flat("FLOOR4_8").pixels).size).toBeGreaterThan(4);
    const imp = wad.sprite("imp")!;
    expect(imp.height).toBeGreaterThan(30);
    expect(imp.opaque.includes(0)).toBe(true);
    expect(wad.sprite("player")).not.toBeNull();
    const unseen = [
      "dead-lost-soul",
      "boss-shooter",
      "spawn-spot",
      "teleport-destination",
    ];
    for (const kind of thingKinds) {
      expect(wad.sprite(kind) === null, kind).toBe(unseen.includes(kind));
    }
    expect(wad.shades[256 * 31 + 100]).not.toBe(wad.shades[100]);
  });
});

describe("rooms inside rooms", () => {
  const camera = { x: 256, y: 64, angle: 270 };

  it("looks over a raised room's step onto its floor", () => {
    const pick = renderStarter(islandMap, camera);
    expect(pick(160, 170)).toBe("floor:yard");
    expect(pick(160, 130)).toBe("wall:yard:e|f:lower");
    expect(pick(160, 109)).toBe("floor:stage");
    expect(pick(160, 90)).toBe("wall:yard:c|d:middle");
    expect(pick(160, 20)).toBe("ceiling:stage");
  });

  it("shows a pillar as solid wall", () => {
    const pick = renderStarter(makePillar(islandMap, "stage")!, camera);
    expect(pick(160, 100)).toBe("wall:yard:e|f:middle");
    expect(pick(160, 170)).toBe("floor:yard");
  });
});
