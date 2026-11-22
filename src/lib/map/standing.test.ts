import { describe, expect, it } from "vitest";

import { updateSector } from "./edit";
import { standingSpot } from "./standing";
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
