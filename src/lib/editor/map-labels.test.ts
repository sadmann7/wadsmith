import { describe, expect, it } from "vitest";

import type { Point } from "@/lib/map/types";

import { defined } from "@/lib/defined";
import { zoomStep } from "@/lib/editor/zoom";
import { loopPolygon } from "@/lib/map/geometry";
import { starterMap } from "@/lib/map/starter-map";

import {
  clearLabels,
  estimateLabelWidth,
  labelPoint,
  smallLabelScale,
} from "./map-labels";

describe("labelPoint", () => {
  const hall = box(0, 0, 512, 512);

  it("sits near the top of a room, in the middle", () => {
    expect(labelPoint([hall], 1, 40)).toEqual({
      x: 256,
      y: 24,
      isSmall: false,
      isCovered: false,
    });
  });

  it("follows the zoom so it stays the same distance from the top on screen", () => {
    expect(labelPoint([hall], 0.5, 40)).toEqual({
      x: 256,
      y: 48,
      isSmall: false,
      isCovered: false,
    });
  });

  it("moves along the band past a pillar under the middle", () => {
    const pillar = box(192, 16, 320, 256);
    const at = labelPoint([hall, pillar], 1, 40);
    expect(at?.y).toBe(24);
    expect(at && (at.x <= 192 - 20 || at.x >= 320 + 20)).toBe(true);
  });

  it("slides aside just enough when a pillar clips one end of the name", () => {
    const pillar = box(270, 30, 400, 256);
    expect(labelPoint([hall, pillar], 1, 40)).toEqual({
      x: 250,
      y: 24,
      isSmall: false,
      isCovered: false,
    });
  });

  it("uses a walkway beside a pillar when the name fits there", () => {
    const pillar = box(64, 64, 448, 448);
    expect(labelPoint([hall, pillar], 0.25, 12)).toEqual({
      x: 32,
      y: 96,
      isSmall: false,
      isCovered: false,
    });
  });

  it("gives up when the name is wider than the walkways beside a pillar", () => {
    const pillar = box(64, 64, 448, 448);
    expect(labelPoint([hall, pillar], 0.25, 40)).toBeNull();
  });

  it("stays in the middle of a room too narrow for its name", () => {
    expect(labelPoint([box(0, 0, 32, 256)], 1, 40)).toEqual({
      x: 16,
      y: 24,
      isSmall: false,
      isCovered: false,
    });
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
      isSmall: false,
      isCovered: false,
    });
  });

  it("spills a long name past a narrow room's walls, clear of things beside it", () => {
    const passage = box(100, 0, 140, 256);
    const at = labelPoint([passage], 1, 80, [{ x: 160, y: 24 }]);
    expect(at).toMatchObject({ x: 120, isSmall: false, isCovered: false });
    expect(at?.y).toBeCloseTo(24 + 2 * 28.8);
  });

  it("shrinks the name when only a smaller one fits clear of a thing", () => {
    const ledge = box(0, 0, 120, 40);
    const at = labelPoint([ledge], 1, 64, [{ x: 70, y: 24 }]);
    expect(at).toMatchObject({ y: 24, isSmall: true, isCovered: false });
    expect(70 - defined(at).x).toBeGreaterThanOrEqual(
      14 + (64 * smallLabelScale) / 2,
    );
  });

  it("stays small at the top when things crowd every band", () => {
    const closet = box(0, 0, 32, 64);
    expect(labelPoint([closet], 1, 40, [{ x: 16, y: 32 }])).toEqual({
      x: 16,
      y: 24,
      isSmall: true,
      isCovered: true,
    });
  });

  it("gives up when a pillar covers the whole band", () => {
    const pillar = box(0, 8, 512, 256);
    expect(labelPoint([hall, pillar], 1, 40)).toBeNull();
  });

  it.each([0.57, 0.8, 1])(
    "keeps every full-size name on the starter map clear of icons at %s zoom",
    (zoom) => {
      const covered = starterMap.sectors
        .filter((sector) => !sector.door)
        .flatMap((sector) => {
          const width = estimateLabelWidth(sector.name);
          const at = labelPoint(
            [sector.vertices, ...(sector.holes ?? [])].map((loop) =>
              loopPolygon(starterMap, loop),
            ),
            zoomStep(zoom),
            width,
            starterMap.things,
          );
          if (!at || at.isSmall) return [];
          return starterMap.things
            .filter((thing) => {
              const dx = Math.abs(thing.x - at.x) * zoom - width / 2;
              const dy = Math.abs(thing.y - at.y) * zoom - 9;
              return Math.hypot(Math.max(0, dx), Math.max(0, dy)) < 12;
            })
            .map((thing) => `${sector.name} on ${thing.kind}`);
        });
      expect(covered).toEqual([]);
    },
  );
});

describe("estimateLabelWidth", () => {
  it.each([
    ["Landing light", 78.6],
    ["Control room", 79],
    ["Crate 1", 47.2],
    ["Storeroom", 65.3],
    ["Exit room", 60],
  ])("comes within a tenth of how wide %s is drawn", (name, drawn) => {
    expect(Math.abs(estimateLabelWidth(name) - drawn)).toBeLessThan(drawn / 10);
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

  it("lets two small names sit closer than two full-size ones", () => {
    const west = { ...room("Pump", 0, 64), at: { x: 32, y: 24 } };
    const east = { ...room("Pump", 64, 64), at: { x: 72, y: 24 } };
    expect(clearLabels([west, east], 1)).toHaveLength(1);
    const small = [west, east].map((item) => ({
      ...item,
      at: { ...item.at, isSmall: true },
    }));
    expect(clearLabels(small, 1)).toHaveLength(2);
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
