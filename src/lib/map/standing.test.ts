import { describe, expect, it } from "vitest";

import type { GameMap } from "./types";

import { updateLine, updateSector } from "./edit";
import { standingSpot, walkStep } from "./standing";
import { testMap } from "./test-map";

describe("a spot to stand on", () => {
  it("keeps a spot with room around it", () => {
    expect(standingSpot(testMap, { x: 96.4, y: 160 })).toEqual({
      x: 96,
      y: 160,
    });
  });

  it("steps off a wall the player's box would cross", () => {
    // Two units from the start room's west wall.
    expect(standingSpot(testMap, { x: 2, y: 160 })).toEqual({ x: 17, y: 160 });
    // Tucked into its north-west corner.
    expect(standingSpot(testMap, { x: 3, y: 5 })).toEqual({ x: 17, y: 17 });
  });

  it("leaves a doorway that can be walked through alone", () => {
    // The corridor's floor is a step down from the start room's.
    expect(standingSpot(testMap, { x: 380, y: 160 })).toEqual({
      x: 380,
      y: 160,
    });
  });

  it("steps back from a ledge too high to climb and a door", () => {
    const raised = updateSector(testMap, "sector-2", { floor: 64 });
    expect(standingSpot(raised, { x: 380, y: 160 })).toEqual({
      x: 367,
      y: 160,
    });
    // The arena's door stands shut beside its west wall.
    expect(standingSpot(testMap, { x: 516, y: 160 })).toEqual({
      x: 529,
      y: 160,
    });
  });

  it("settles beside a slanted wall and a door jamb", () => {
    const slanted: GameMap = {
      vertices: {
        a: { x: 1000, y: 1000 },
        b: { x: 1400, y: 1100 },
        c: { x: 1500, y: 1500 },
        d: { x: 1050, y: 1400 },
      },
      sectors: [{ ...testMap.sectors[0], vertices: ["a", "b", "c", "d"] }],
      things: [],
      switches: [],
    };
    // Five units inside the first wall, which runs at a slant.
    expect(standingSpot(slanted, { x: 1042.8, y: 1015.3 })).not.toBeNull();
    for (let step = 20; step < 180; step += 1) {
      const along = step / 200;
      const near = standingSpot(slanted, {
        x: 1000 + 400 * along + 2,
        y: 1000 + 100 * along + 6,
      });
      expect(near).not.toBeNull();
      // A spot found is one the next look leaves where it is.
      expect(near && standingSpot(slanted, near)).toEqual(near);
    }
    // In the arena, a unit off its west wall beside the door.
    expect(standingSpot(testMap, { x: 513, y: 95 })).not.toBeNull();
  });

  it("backs out of a sharp corner to the nearest clear spot", () => {
    const wedge: GameMap = {
      vertices: {
        a: { x: 0, y: 0 },
        b: { x: 512, y: 0 },
        c: { x: 512, y: 512 },
      },
      sectors: [{ ...testMap.sectors[0], vertices: ["a", "b", "c"] }],
      things: [],
      switches: [],
    };
    const spot = standingSpot(wedge, { x: 32.9, y: 18.1 });
    expect(spot).not.toBeNull();
    expect(spot && standingSpot(wedge, spot)).toEqual(spot);
    expect(spot?.y).toBe(17);
  });

  it("steps back from a line that blocks everything", () => {
    const fenced = updateLine(testMap, "v3|v4", { blocksAll: true });
    expect(standingSpot(fenced, { x: 380, y: 160 })).toEqual({
      x: 367,
      y: 160,
    });
  });

  it("steps back from an MBF21 line that blocks players", () => {
    const fenced = updateLine({ ...testMap, complevel: "mbf21" }, "v3|v4", {
      blocksPlayers: true,
    });
    expect(walkStep(fenced, { x: 360, y: 160 }, { x: 372, y: 160 })).toEqual({
      x: 360,
      y: 160,
    });
    expect(
      walkStep(
        { ...fenced, complevel: "mbf" },
        { x: 360, y: 160 },
        {
          x: 372,
          y: 160,
        },
      ),
    ).toEqual({ x: 372, y: 160 });
  });

  it("finds no spot under a ceiling too low to stand under", () => {
    const low = updateSector(testMap, "sector-1", { ceiling: 48 });
    expect(standingSpot(low, { x: 96, y: 160 })).toBeNull();
  });

  it("finds no spot outside the map, in a door or where nothing fits", () => {
    expect(standingSpot(testMap, { x: -50, y: 160 })).toBeNull();
    expect(standingSpot(testMap, { x: 504, y: 160 })).toBeNull();
    expect(standingSpot(testMap, { x: 0, y: 160 })).toBeNull();
    // The corridor is 128 across, and a player needs 34 of it.
    const squeezed: typeof testMap = {
      ...testMap,
      vertices: {
        ...testMap.vertices,
        v4: { x: 384, y: 120 },
        v14: { x: 496, y: 120 },
        v8: { x: 512, y: 120 },
      },
    };
    expect(standingSpot(squeezed, { x: 440, y: 108 })).toBeNull();
  });
});

describe("walking the 3D view", () => {
  it("walks across open floor and down a step", () => {
    expect(walkStep(testMap, { x: 96, y: 160 }, { x: 104, y: 160 })).toEqual({
      x: 104,
      y: 160,
    });
    expect(walkStep(testMap, { x: 380, y: 160 }, { x: 388, y: 160 })).toEqual({
      x: 388,
      y: 160,
    });
  });

  it("stops short of a wall and slides along it", () => {
    expect(walkStep(testMap, { x: 20, y: 160 }, { x: 12, y: 160 })).toEqual({
      x: 20,
      y: 160,
    });
    expect(walkStep(testMap, { x: 20, y: 160 }, { x: 12, y: 168 })).toEqual({
      x: 20,
      y: 168,
    });
  });

  it("stops at a ledge too high, a shut door and a blocking line", () => {
    const raised = updateSector(testMap, "sector-2", { floor: 64 });
    expect(walkStep(raised, { x: 360, y: 160 }, { x: 372, y: 160 })).toEqual({
      x: 360,
      y: 160,
    });
    const shut = updateSector(testMap, "sector-4", { ceiling: -16 });
    expect(walkStep(shut, { x: 472, y: 160 }, { x: 484, y: 160 })).toEqual({
      x: 472,
      y: 160,
    });
    const fenced = updateLine(testMap, "v3|v4", { blocksAll: true });
    expect(walkStep(fenced, { x: 360, y: 160 }, { x: 372, y: 160 })).toEqual({
      x: 360,
      y: 160,
    });
  });

  it("walks through a door that stands open", () => {
    expect(walkStep(testMap, { x: 472, y: 160 }, { x: 484, y: 160 })).toEqual({
      x: 484,
      y: 160,
    });
  });

  it("climbs stairs narrower than a player", () => {
    const stairs = row([0, 128, 144, 160, 176, 320], [0, 16, 32, 48, 48]);
    let spot = { x: 64, y: 64 };
    for (let step = 0; step < 40; step += 1) {
      spot = walkStep(stairs, spot, { x: spot.x + 8, y: 64 });
    }
    expect(spot.x).toBeGreaterThan(200);
  });

  it("can't walk back up a ledge after dropping off it", () => {
    const ledge = row([0, 128, 320], [48, -16]);
    let spot = { x: 100, y: 64 };
    for (let step = 0; step < 10; step += 1) {
      spot = walkStep(ledge, spot, { x: spot.x + 8, y: 64 });
    }
    expect(spot.x).toBe(180);
    for (let step = 0; step < 10; step += 1) {
      spot = walkStep(ledge, spot, { x: spot.x - 8, y: 64 });
    }
    expect(spot.x).toBe(148);
  });

  it("can't climb a ledge from beside its foot", () => {
    const ledge = row([0, 128, 320], [0, 200]);
    let spot = { x: 120, y: 64 };
    for (let step = 0; step < 10; step += 1) {
      spot = walkStep(ledge, spot, { x: spot.x + 8, y: 64 });
    }
    expect(spot.x).toBe(120);
  });

  it("lets a camera caught in a wall walk out", () => {
    expect(walkStep(testMap, { x: 4, y: 160 }, { x: 12, y: 160 })).toEqual({
      x: 12,
      y: 160,
    });
    expect(walkStep(testMap, { x: 8, y: 160 }, { x: 4, y: 160 })).toEqual({
      x: 8,
      y: 160,
    });
  });
});

// Rooms side by side from west to east, split at `edges`, each 128 deep and
// with its floor from `floors` under a ceiling at 200.
function row(edges: number[], floors: number[]): GameMap {
  const vertices: GameMap["vertices"] = {};
  for (const [at, x] of edges.entries()) {
    vertices[`n${at}`] = { x, y: 0 };
    vertices[`s${at}`] = { x, y: 128 };
  }
  return {
    vertices,
    sectors: floors.map((floor, at) => ({
      ...testMap.sectors[0],
      id: `room-${at}`,
      vertices: [`n${at}`, `n${at + 1}`, `s${at + 1}`, `s${at}`],
      floor,
      ceiling: 200,
    })),
    things: [],
    switches: [],
  };
}
