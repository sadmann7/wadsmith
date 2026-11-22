import { describe, expect, it } from "vitest";

import type { LineAction } from "./types";

import { roomCenter, setLineTarget, updateLine } from "./edit";
import { wallKey } from "./geometry";
import { lineLinks, sectorLinks } from "./links";
import { testMap } from "./test-map";

const openWall = wallKey("v3", "v4");
const action = (kind: LineAction["kind"]): LineAction => ({
  kind,
  trigger: "walk",
  repeat: false,
  tag: 0,
});
const aimed = (kind: LineAction["kind"]) =>
  setLineTarget(
    updateLine(testMap, openWall, { action: action(kind) }),
    openWall,
    "sector-3",
  );

describe("links from a line to what it acts on", () => {
  it("joins a line to the middle of the room it moves, and back", () => {
    const map = aimed("floor-lower");
    const link = {
      from: { x: 384, y: 160 },
      to: roomCenter(map, map.sectors[2]),
    };
    expect(lineLinks(map, openWall)).toEqual([link]);
    expect(sectorLinks(map, "sector-3")).toEqual([link]);
    expect(sectorLinks(map, "sector-1")).toEqual([]);
    expect(lineLinks(testMap, openWall)).toEqual([]);
  });

  it("joins a teleporter to the spot it lands on", () => {
    const map = {
      ...aimed("teleport"),
      things: [
        ...testMap.things,
        {
          id: "teleport-destination-1",
          kind: "teleport-destination" as const,
          x: 896,
          y: 320,
          angle: 0,
        },
      ],
    };
    expect(lineLinks(map, openWall)[0].to).toEqual({ x: 896, y: 320 });
  });

  it("draws nothing for a door pressed open, which acts on what is behind it", () => {
    const map = updateLine(testMap, wallKey("v13", "v14"), {
      action: { kind: "door-raise", trigger: "door", repeat: true, tag: 0 },
    });
    expect(lineLinks(map, wallKey("v13", "v14"))).toEqual([]);
  });
});
