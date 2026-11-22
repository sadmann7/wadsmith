import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";

import { defined } from "@/lib/defined";
import { thingKinds } from "@/lib/map/catalog";
import { updateLine, updateLineSide, updateSector } from "@/lib/map/edit";
import { addDetail, makePillar } from "@/lib/map/edit";
import { wallKey } from "@/lib/map/geometry";
import { parseMapFile, serializeMap } from "@/lib/map/storage";
import {
  describeSurface,
  moveSurfaceHeight,
  paintSurface,
} from "@/lib/map/surfaces";
import { islandMap, testMap } from "@/lib/map/test-map";
import {
  createFlatAssets,
  gameFlatShade,
  gameWallShade,
  readWadAssets,
  type SceneAssets,
} from "@/lib/wad/assets";
import { compileLumps } from "@/lib/wad/compile";

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
  "../../../public/engine/freedoom2.wad",
);

const stripes = {
  width: 64,
  height: 64,
  leftOffset: 0,
  topOffset: 0,
  pixels: Uint8Array.from({ length: 64 * 64 }, (_, index) => index >> 6),
  opaque: new Uint8Array(64 * 64).fill(1),
};

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
    const screen = defined(projectPoint(target, testMap, camera, point, 0));
    const back = defined(
      pointOnPlane(target, testMap, camera, screen.x, screen.y, 0),
    );
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
    const sidedefs = defined(
      compileLumps(map).find((l) => l.name === "SIDEDEFS"),
    );
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

  it("paints one face of the door, or the whole door", () => {
    const wall = wallKey("v13", "v14");
    const face = `wall:sector-2:${wall}:upper`;
    const map = paintSurface(testMap, face, "DOOR3");
    expect(map.lines?.[wall]?.sides?.["sector-2"]?.upper).toBe("DOOR3");
    expect(map.sectors[3].door?.texture).toBe("BIGDOOR2");
    const whole = paintSurface(map, face, "DOOR3", true);
    expect(whole.sectors[3].door?.texture).toBe("DOOR3");
    expect(whole.lines).toBeUndefined();
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

describe("the sky, open lines and movers", () => {
  // Each column of the sky is one color, so a pixel says which column it is.
  const skyPicture = {
    width: 256,
    height: 128,
    leftOffset: 0,
    topOffset: 0,
    pixels: Uint8Array.from({ length: 256 * 128 }, (_, index) => index >> 7),
    opaque: new Uint8Array(256 * 128).fill(1),
  };
  const grate = (opaque: number) => ({
    width: 64,
    height: 128,
    leftOffset: 0,
    topOffset: 0,
    pixels: new Uint8Array(64 * 128).fill(7),
    opaque: new Uint8Array(64 * 128).fill(opaque),
  });
  const withTextures = (
    extra: Record<string, ReturnType<typeof grate>>,
  ): SceneAssets => ({
    ...assets,
    texture: (name) => extra[name] ?? assets.texture(name),
  });
  const open = wallKey("v3", "v4");
  const outdoors: GameMap = {
    ...testMap,
    sectors: testMap.sectors.map((sector) =>
      sector.id === "sector-1" || sector.id === "sector-2"
        ? { ...sector, ceilingTexture: "F_SKY1" }
        : sector,
    ),
  };
  const colorAt = (map: GameMap, angle: number, x: number, y: number) => {
    const target = createRenderTarget(320, 200);
    renderScene(
      target,
      map,
      { ...startCamera(map), angle },
      { assets: withTextures({ SKY1: skyPicture }), sky: "SKY1" },
    );
    return {
      color: target.colors[y * 320 + x],
      surface: target.surfaces[target.pick[y * 320 + x]],
    };
  };

  it("draws the sky where a ceiling wears the sky flat, by the way you look", () => {
    const east = colorAt(outdoors, 0, 160, 5);
    expect(east.surface).toBe("ceiling:sector-1");
    expect(east.color).toBe(assets.shades[255]);
    // An eighth of a turn is an eighth of the sky's four wraps on.
    expect(colorAt(outdoors, 45, 160, 5).color).toBe(assets.shades[127]);
    expect(colorAt(testMap, 0, 160, 5).color).not.toBe(east.color);
  });

  it("draws sky and no wall between two rooms open to it", () => {
    expect(renderStarter()(160, 60)).toBe(`wall:sector-1:${open}:upper`);
    const between = colorAt(outdoors, 0, 160, 60);
    expect(between.surface).toBe("ceiling:sector-1");
    expect(between.color).toBe(assets.shades[255]);
  });

  it("draws a middle texture on an open line and sees through its holes", () => {
    const fenced = updateLineSide(testMap, open, "sector-1", {
      middle: "GRATE",
    });
    const pick = (opaque: number) => {
      const target = createRenderTarget(320, 200);
      renderScene(target, fenced, startCamera(fenced), {
        assets: withTextures({ GRATE: grate(opaque) }),
      });
      return target.surfaces[target.pick[96 * 320 + 160]];
    };
    expect(pick(1)).toBe(`wall:sector-1:${open}:middle`);
    expect(pick(0)).toBe(renderStarter()(160, 96));
  });

  it("outlines a selected see-through texture round its span, not its holes", () => {
    const fenced = updateLineSide(testMap, open, "sector-1", {
      middle: "GRATE",
    });
    // Every other pixel is a hole.
    const checkered = {
      ...grate(1),
      opaque: Uint8Array.from({ length: 64 * 128 }, (_, index) => index % 2),
    };
    const target = createRenderTarget(320, 200);
    renderScene(target, fenced, startCamera(fenced), {
      assets: withTextures({ GRATE: checkered }),
      selected: `wall:sector-1:${open}:middle`,
    });
    const span = target.extent.filter((id) => id !== 0).length;
    const outlined = target.colors.filter(
      (color) => color === 0xff2b6aff,
    ).length;
    expect(span).toBeGreaterThan(1000);
    expect(outlined).toBeGreaterThan(0);
    expect(outlined).toBeLessThan(span / 4);
  });

  it("doesn't outline what shows through a see-through texture hole by hole", () => {
    const fenced = updateLineSide(testMap, open, "sector-1", {
      middle: "GRATE",
    });
    const checkered = {
      ...grate(1),
      opaque: Uint8Array.from({ length: 64 * 128 }, (_, index) => index % 2),
    };
    const hovered = (map: GameMap) => {
      const target = createRenderTarget(320, 200);
      renderScene(target, map, startCamera(map), {
        assets: withTextures({ GRATE: checkered }),
        hovered: "wall:sector-2:v13|v14:upper",
      });
      return target.colors.filter((color) => color === 0xffffffff).length;
    };
    // The door's face behind the fence gets no more outline than without it.
    expect(hovered(testMap)).toBeGreaterThan(0);
    expect(hovered(fenced)).toBeLessThanOrEqual(hovered(testMap));
  });

  it("outlines a thing in front of a see-through texture all the way round", () => {
    const things = [
      ...testMap.things,
      { id: "imp-2", kind: "imp" as const, x: 200, y: 160, angle: 0 },
    ];
    const outlined = (map: GameMap) => {
      const target = createRenderTarget(320, 200);
      renderScene(target, map, startCamera(map), {
        assets: withTextures({ GRATE: grate(1) }),
        selected: "thing:imp-2",
      });
      return target.colors.filter((color) => color === 0xff2b6aff).length;
    };
    const fenced = updateLineSide(testMap, open, "sector-1", {
      middle: "GRATE",
    });
    expect(outlined({ ...testMap, things })).toBeGreaterThan(0);
    expect(outlined({ ...fenced, things })).toBe(
      outlined({ ...testMap, things }),
    );
  });

  it("shows a taller room's walls above a lower one when both are open to the sky", () => {
    const yard: GameMap = {
      ...outdoors,
      sectors: outdoors.sectors.map((sector) =>
        sector.id === "sector-2" ? { ...sector, ceiling: 512 } : sector,
      ),
    };
    // The start room's ceiling crosses the view at row 52, and the corridor's
    // far wall rises well above it.
    expect(colorAt(yard, 0, 160, 30).surface).toMatch(/^wall:sector-2:/);
    expect(colorAt(outdoors, 0, 160, 30).surface).toBe("ceiling:sector-1");
  });

  it("runs a middle texture from the viewer's left on both sides of a line", () => {
    const lined = defined(
      addDetail(islandMap, [
        { x: 96, y: 128 },
        { x: 96, y: 384 },
      ]),
    ).map;
    const line = wallKey(
      ...(defined(lined.sectors[0].details)[0] as [string, string]),
    );
    const striped = updateLineSide(lined, line, "yard", { middle: "STRIPES" });
    // Each column of the texture is its own color, and the shades keep a
    // color's number, so a pixel says which column it shows.
    const numbered: SceneAssets = {
      ...withTextures({
        STRIPES: {
          ...grate(1),
          pixels: Uint8Array.from({ length: 64 * 128 }, (_, index) =>
            Math.floor(index / 128),
          ),
        },
      }),
      shades: Uint32Array.from({ length: 32 * 256 }, (_, index) => index & 255),
    };
    const columns = (camera: { x: number; y: number; angle: number }) => {
      const target = createRenderTarget(320, 200);
      renderScene(target, striped, camera, { assets: numbered });
      return [150, 170].map((x) => target.colors[100 * 320 + x]);
    };
    // The line is 64 away on either side, so twenty pixels are eight units.
    expect(columns({ x: 32, y: 288, angle: 0 })).toEqual([28, 36]);
    expect(columns({ x: 160, y: 288, angle: 180 })).toEqual([28, 36]);
  });

  it("outlines every picked surface like the selected one", () => {
    const outlined = (picked: string[]) => {
      const target = createRenderTarget(320, 200);
      renderScene(target, testMap, startCamera(testMap), { assets, picked });
      return target.colors.filter((color) => color === 0xff2b6aff).length;
    };
    expect(outlined([])).toBe(0);
    const floor = outlined(["floor:sector-1"]);
    expect(floor).toBeGreaterThan(0);
    expect(outlined(["floor:sector-1", "ceiling:sector-1"])).toBeGreaterThan(
      floor,
    );
  });

  it("shows a door open when asked, to look through it", () => {
    const target = createRenderTarget(320, 200);
    renderScene(target, testMap, startCamera(testMap), {
      assets,
      opened: ["sector-4"],
    });
    expect(target.surfaces[target.pick[96 * 320 + 160]]).not.toMatch(/upper$/);
    expect(renderStarter()(160, 96)).toMatch(/upper$/);
  });
});

describe.skipIf(!existsSync(wadPath))("readWadAssets", () => {
  it("composes textures, flats and sprites from Freedoom", () => {
    const wad = readWadAssets(readFileSync(wadPath));
    expect(wad.texture("STARTAN3").width).toBeGreaterThan(1);
    expect(new Set(wad.texture("STARTAN3").pixels).size).toBeGreaterThan(4);
    expect(wad.flat("FLOOR4_8").width).toBe(64);
    expect(new Set(wad.flat("FLOOR4_8").pixels).size).toBeGreaterThan(4);
    const imp = defined(wad.sprite("imp"));
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
    expect(wad.names.walls).toContain("STARTAN3");
    expect(wad.names.walls).not.toContain("-");
    expect(wad.names.flats).toContain("FLOOR4_8");
    expect(wad.names.flats).not.toContain("F_START");
    expect(wad.names.middles).toContain("MIDGRATE");
    expect(wad.names.middles).toContain("STARTAN3");
    expect(wad.names.middles.indexOf("MIDGRATE")).toBeLessThan(
      wad.names.middles.indexOf("STARTAN3"),
    );
    expect(wad.names.walls).not.toContain("MIDGRATE");
    expect(wad.names.textures).toContain("MIDGRATE");
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

  it("sees through a line drawn inside a room", () => {
    const lined = defined(
      addDetail(islandMap, [
        { x: 128, y: 128 },
        { x: 384, y: 128 },
      ]),
    );
    const pick = renderStarter(lined.map, camera);
    expect(pick(160, 100)).toBe("wall:yard:c|d:middle");
    expect(pick(160, 109)).toBe("floor:stage");
    expect(pick(160, 170)).toBe("floor:yard");
  });

  it("shows a pillar as solid wall", () => {
    const pick = renderStarter(defined(makePillar(islandMap, "stage")), camera);
    expect(pick(160, 100)).toBe("wall:yard:e|f:middle");
    expect(pick(160, 170)).toBe("floor:yard");
  });
});

function renderStarter(map = testMap, camera = startCamera(map)) {
  const target = createRenderTarget(320, 200);
  expect(renderScene(target, map, camera, { assets })).toBe(true);
  return (x: number, y: number) => target.surfaces[target.pick[y * 320 + x]];
}
