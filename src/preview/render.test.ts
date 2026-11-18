import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { updateSector } from "../map/edit";
import { wallKey } from "../map/geometry";
import { starterMap } from "../map/starter-map";
import {
  describeSurface,
  moveSurfaceHeight,
  paintSurface,
} from "../map/surfaces";
import { compileLumps } from "../wad/compile";
import { createFlatAssets, readWadAssets } from "../wad/assets";
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

function renderStarter(map = starterMap, camera = startCamera(map)) {
  const target = createRenderTarget(320, 200);
  expect(renderScene(target, map, camera, { assets })).toBe(true);
  return (x: number, y: number) => target.surfaces[target.pick[y * 320 + x]];
}

describe("renderScene", () => {
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

  it("makes things selectable", () => {
    const map = {
      ...starterMap,
      things: [
        ...starterMap.things,
        { id: "imp-2", kind: "imp" as const, x: 200, y: 160, angle: 0 },
      ],
    };
    expect(renderStarter(map)(160, 100)).toBe("thing:imp-2");
  });

  it("tints the selected surface", () => {
    const plain = createRenderTarget(320, 200);
    const tinted = createRenderTarget(320, 200);
    const camera = startCamera(starterMap);
    renderScene(plain, starterMap, camera, { assets });
    renderScene(tinted, starterMap, camera, {
      assets,
      selected: "floor:sector-1",
    });
    const pixel = 190 * 320 + 160;
    expect(tinted.colors[pixel]).not.toBe(plain.colors[pixel]);
    expect(tinted.colors[5 * 320 + 160]).toBe(plain.colors[5 * 320 + 160]);
  });

  it("draws a placement ghost that can't be picked", () => {
    const camera = startCamera(starterMap);
    const plain = createRenderTarget(320, 200);
    const ghosted = createRenderTarget(320, 200);
    renderScene(plain, starterMap, camera, { assets });
    renderScene(ghosted, starterMap, camera, {
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
    const camera = startCamera(starterMap);
    const point = { x: 250, y: 200 };
    const screen = projectPoint(target, starterMap, camera, point, 0)!;
    const back = pointOnPlane(
      target,
      starterMap,
      camera,
      screen.x,
      screen.y,
      0,
    )!;
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });

  it("finds no floor above the horizon", () => {
    const target = createRenderTarget(320, 200);
    const camera = startCamera(starterMap);
    expect(pointOnPlane(target, starterMap, camera, 160, 20, 0)).toBeNull();
  });

  it("moves a floor on screen when its height changes", () => {
    const raised = updateSector(starterMap, "sector-2", { floor: 24 });
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
    const map = moveSurfaceHeight(starterMap, "floor:sector-1", 4000);
    expect(map.sectors[0].floor).toBe(120);
  });

  it("paints one wall and compiles it", () => {
    const map = paintSurface(starterMap, wallSurface, "BRICK1");
    expect(describeSurface(map, wallSurface)?.texture).toBe("BRICK1");
    const sidedefs = compileLumps(map).find((l) => l.name === "SIDEDEFS")!;
    const text = String.fromCharCode(...sidedefs.data);
    expect(text.match(/BRICK1/g)).toHaveLength(1);
  });

  it("paints every wall in a room", () => {
    const painted = paintSurface(starterMap, wallSurface, "BRICK1");
    const map = paintSurface(painted, wallSurface, "GRAY1", true);
    expect(map.sectors[0].wallTexture).toBe("GRAY1");
    expect(map.sectors[0].wallOverrides).toBeUndefined();
  });

  it("paints the door from its face", () => {
    const face = `wall:sector-2:${wallKey("v13", "v14")}:upper`;
    const map = paintSurface(starterMap, face, "DOOR3");
    expect(map.sectors[3].door?.texture).toBe("DOOR3");
  });

  it("paints a switch from its wall", () => {
    const face = `wall:sector-1:${wallKey("v15", "v16")}:middle`;
    expect(describeSurface(starterMap, face)?.paints).toBe("switch");
    const map = paintSurface(starterMap, face, "SW1GRAY");
    expect(map.switches[0].texture).toBe("SW1GRAY");
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
    expect(wad.shades[256 * 31 + 100]).not.toBe(wad.shades[100]);
  });
});
