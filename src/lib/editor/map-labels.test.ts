import { describe, expect, it } from "vitest";

import type { Point } from "@/lib/map/types";

import { clearLabels, labelPoint } from "./map-labels";

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

  it("keeps the band clear of a pillar zoomed out, using the walkway", () => {
    const pillar = box(64, 64, 448, 448);
    const at = labelPoint([hall, pillar], 0.25, 40);
    expect(at).toEqual({ x: 32, y: 96 });
  });

  it("gives up when a pillar covers the whole band", () => {
    const pillar = box(0, 8, 512, 256);
    expect(labelPoint([hall, pillar], 1, 40)).toBeNull();
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
