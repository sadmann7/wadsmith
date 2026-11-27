import { describe, expect, it } from "vitest";

import type { GameMap, Thing } from "@/lib/map/types";

import { testMap } from "@/lib/map/test-map";

import { SceneCamera } from "./scene-camera";

const hall: GameMap = {
  ...testMap,
  vertices: {
    a: { x: 0, y: 0 },
    b: { x: 512, y: 0 },
    c: { x: 512, y: 512 },
    d: { x: 0, y: 512 },
    e: { x: 64, y: 64 },
    f: { x: 448, y: 64 },
    g: { x: 448, y: 448 },
    h: { x: 64, y: 448 },
  },
  sectors: [
    {
      ...testMap.sectors[0],
      vertices: ["a", "b", "c", "d"],
      holes: [["e", "f", "g", "h"]],
    },
  ],
  things: [],
  lines: {},
  switches: [],
};

describe("SceneCamera", () => {
  it("faces down the walkway when shown a room from its side", () => {
    const camera = new SceneCamera(hall);
    camera.lookAt(hall, { x: 32, y: 256 }, null);
    expect(camera.position).toMatchObject({ x: 32, y: 256, angle: 90 });
  });

  it("faces the target when there is one", () => {
    const camera = new SceneCamera(hall);
    camera.lookAt(hall, { x: 32, y: 256 }, { x: 32, y: 480 });
    expect(camera.position.angle).toBe(-90);
  });

  it("follows the player start when an edit here moves it", () => {
    const camera = new SceneCamera({ ...hall, things: [playerAt(128, 128)] });
    camera.sync({ ...hall, things: [playerAt(32, 256)] });
    expect(camera.position).toMatchObject({ x: 32, y: 256 });
  });

  it("stays put when someone else adds or moves the player start", () => {
    const camera = new SceneCamera(hall);
    const before = camera.position;
    const theirs = { ...hall, things: [playerAt(32, 256)] };
    camera.keep(theirs);
    camera.sync(theirs);
    expect(camera.position).toEqual(before);
    camera.sync({ ...theirs, sectors: [...theirs.sectors] }, true);
    camera.sync({ ...theirs, sectors: [...theirs.sectors] });
    expect(camera.position).toEqual(before);
  });

  it("leaves a room someone else removed for the player start", () => {
    const camera = new SceneCamera(hall);
    camera.moveTo(hall, { x: 32, y: 256 });
    const theirs = { ...hall, sectors: [], things: [playerAt(600, 600)] };
    camera.keep(theirs);
    camera.sync(theirs);
    expect(camera.position).toMatchObject({ x: 600, y: 600 });
  });
});

function playerAt(x: number, y: number): Thing {
  return { id: "start", kind: "player", x, y, angle: 0 };
}
