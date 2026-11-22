import { describe, expect, it } from "vitest";

import { defined } from "@/lib/defined";

import { shapeCorners } from "./shapes";

describe("shapes to draw a room with", () => {
  it("makes a rectangle from one corner to the opposite one", () => {
    expect(
      shapeCorners("rectangle", 4, { x: 0, y: 0 }, { x: 128, y: 64 }, 32),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 128, y: 0 },
      { x: 128, y: 64 },
      { x: 0, y: 64 },
    ]);
    expect(
      shapeCorners("rectangle", 4, { x: 0, y: 0 }, { x: 128, y: 0 }, 32),
    ).toBeNull();
  });

  it("makes a polygon around its middle with a corner at the pointer", () => {
    const square = defined(
      shapeCorners("polygon", 4, { x: 0, y: 0 }, { x: 64, y: 0 }, 32),
    );
    expect(square).toEqual([
      { x: 64, y: 0 },
      { x: 0, y: 64 },
      { x: -64, y: 0 },
      { x: 0, y: -64 },
    ]);
    const round = defined(
      shapeCorners("polygon", 8, { x: 256, y: 256 }, { x: 512, y: 256 }, 8),
    );
    expect(round).toHaveLength(8);
    for (const point of round) {
      expect([point.x % 8, point.y % 8]).toEqual([0, 0]);
      expect(
        Math.abs(Math.hypot(point.x - 256, point.y - 256) - 256),
      ).toBeLessThan(8);
    }
  });

  it("makes nothing while the corners fall on top of each other", () => {
    expect(
      shapeCorners("polygon", 12, { x: 0, y: 0 }, { x: 8, y: 0 }, 32),
    ).toBeNull();
    expect(
      shapeCorners("polygon", 6, { x: 0, y: 0 }, { x: 0, y: 0 }, 8),
    ).toBeNull();
  });
});
