import { describe, expect, it } from "vitest";

import type { Point } from "@/lib/map/types";

import { defined } from "@/lib/defined";

import { clearLabels, getIsLabelCovered, labelPoint } from "./map-labels";

describe("labelPoint", () => {
  const hall = box(0, 0, 512, 512);

  it("sits near the top of a room, in the middle", () => {
    expect(labelPoint([hall], 1, 40)).toEqual({ x: 256, y: 24 });
  });

  it("follows the zoom so it stays the same distance from the top on screen", () => {
    expect(labelPoint([hall], 0.5, 40)).toEqual({ x: 256, y: 48 });
  });

  it("moves along the band past a pillar under the middle", () => {
    const pillar = box(192, 16, 320, 256);
    const at = labelPoint([hall, pillar], 1, 40);
    expect(at?.y).toBe(24);
    expect(at && (at.x <= 192 - 20 || at.x >= 320 + 20)).toBe(true);
  });

  it("slides aside just enough when a pillar clips one end of the name", () => {
    const pillar = box(270, 30, 400, 256);
    expect(labelPoint([hall, pillar], 1, 40)).toEqual({ x: 250, y: 24 });
  });

  it("uses a walkway beside a pillar when the name fits there", () => {
    const pillar = box(64, 64, 448, 448);
    expect(labelPoint([hall, pillar], 0.25, 12)).toEqual({ x: 32, y: 96 });
  });

  it("gives up when the name is wider than the walkways beside a pillar", () => {
    const pillar = box(64, 64, 448, 448);
    expect(labelPoint([hall, pillar], 0.25, 40)).toBeNull();
  });

  it("stays in the middle of a room too narrow for its name", () => {
    expect(labelPoint([box(0, 0, 32, 256)], 1, 40)).toEqual({ x: 16, y: 24 });
  });

  it("slides along the band past a thing under the middle", () => {
    const at = labelPoint([hall], 1, 40, [{ x: 256, y: 32 }]);
    expect(at?.y).toBe(24);
    expect(at && Math.abs(at.x - 256)).toBeGreaterThanOrEqual(14 + 20);
  });

  it("drops below things that leave no room for the name on the top band", () => {
    const closet = box(0, 0, 96, 256);
    const things = [
      { x: 24, y: 24 },
      { x: 72, y: 24 },
    ];
    const at = labelPoint([closet], 1, 40, things);
    expect(at?.x).toBe(48);
    expect(defined(at).y - 24).toBeGreaterThanOrEqual(14 + 16);
  });

  it("sees a thing in a room across the map's origin", () => {
    const at = labelPoint([box(-256, -256, 256, 256)], 1, 40, [
      { x: 0, y: -224 },
    ]);
    expect(at?.y).toBe(-232);
    expect(at && Math.abs(at.x)).toBeGreaterThanOrEqual(14 + 20);
  });

  it("ignores things outside the room", () => {
    expect(labelPoint([hall], 1, 40, [{ x: 256, y: -200 }])).toEqual({
      x: 256,
      y: 24,
    });
  });

  it("keeps the name at the top of a room with no clear spot", () => {
    const ledge = box(0, 0, 120, 40);
    expect(labelPoint([ledge], 1, 64, [{ x: 70, y: 24 }])).toEqual({
      x: 60,
      y: 24,
    });
  });

  it("stays at the top when things crowd every band", () => {
    const closet = box(0, 0, 32, 64);
    expect(labelPoint([closet], 1, 40, [{ x: 16, y: 32 }])).toEqual({
      x: 16,
      y: 24,
    });
  });

  it("gives up when a pillar covers the whole band", () => {
    const pillar = box(0, 8, 512, 256);
    expect(labelPoint([hall, pillar], 1, 40)).toBeNull();
  });
});

describe("getIsLabelCovered", () => {
  it("tells a label an icon sits on from one beside it", () => {
    const at = { x: 100, y: 100 };
    expect(getIsLabelCovered(at, 40, 1, [{ x: 125, y: 100 }])).toBe(true);
    expect(getIsLabelCovered(at, 40, 1, [{ x: 150, y: 100 }])).toBe(false);
    expect(getIsLabelCovered(at, 40, 1, [{ x: 100, y: 140 }])).toBe(false);
  });
});

describe("clearLabels", () => {
  it("keeps the bigger room's label where two side by side would overlap", () => {
    const west = room("Lava West North", 0, 96, 256);
    const east = room("Lava East", 96, 96);
    expect(clearLabels([east, west], 1)).toEqual([west]);
  });

  it("keeps both labels once the rooms are far enough apart on screen", () => {
    const west = room("Lava West North", 0, 96, 256, 4);
    const east = room("Lava East", 96, 96, 128, 4);
    expect(clearLabels([west, east], 4)).toEqual([west, east]);
  });

  it("makes room for the detail line below a name", () => {
    const top = room("Hall", 0, 256, 32);
    const below = { ...top, at: { x: 128, y: 54 } };
    expect(clearLabels([top, below], 1)).toHaveLength(2);
    expect(
      clearLabels(
        [top, below].map((item) => ({ ...item, detail: "S01 0/128" })),
        1,
      ),
    ).toHaveLength(1);
  });

  it("judges overlap where the labels are drawn, not from the rooms' boxes", () => {
    const hall = room("Hall", 0, 512, 512);
    const nook = { ...room("Nook", 200, 112, 64), at: { x: 32, y: 96 } };
    expect(clearLabels([hall, nook], 1)).toEqual([hall, nook]);
  });
});

function room(
  name: string,
  left: number,
  width: number,
  height = 128,
  zoom = 1,
) {
  return {
    name,
    box: { left, top: 0, right: left + width, bottom: height },
    at: { x: left + width / 2, y: 24 / zoom },
  };
}

function box(left: number, top: number, right: number, bottom: number) {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ] satisfies Point[];
}
