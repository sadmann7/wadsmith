import { describe, expect, it } from "vitest";

import { defined } from "@/lib/defined";

import type { LineAction } from "./types";

import {
  addThing,
  landTeleport,
  roomCenter,
  setLineTarget,
  updateLine,
} from "./edit";
import { sectorAt, wallKey } from "./geometry";
import { lineLinks, sectorLinks } from "./links";
import { setWallsAction } from "./many-lines";
import { islandMap, testMap } from "./test-map";

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

  it("places a teleport destination in the room a teleporter aims at", () => {
    const map = aimed("teleport");
    const spots = map.things.filter(
      (thing) => thing.kind === "teleport-destination",
    );
    expect(spots).toEqual([
      expect.objectContaining(roomCenter(map, map.sectors[2])),
    ]);
    expect(setLineTarget(map, openWall, "sector-3").things).toEqual(map.things);
    expect(aimed("floor-lower").things).toEqual(testMap.things);
  });

  it("keeps the destination a room already has", () => {
    const placed = addThing(testMap, "teleport-destination", {
      x: 864,
      y: 32,
    }).map;
    const map = setLineTarget(
      updateLine(placed, openWall, { action: action("teleport-monsters") }),
      openWall,
      "sector-3",
    );
    expect(map.things).toEqual(placed.things);
  });

  it("lands a line that becomes a teleporter on a room it already aims at", () => {
    const lift = aimed("floor-lower");
    const map = landTeleport(
      updateLine(lift, openWall, {
        action: {
          ...defined(lift.lines?.[openWall]?.action),
          kind: "teleport",
        },
      }),
      openWall,
    );
    expect(
      map.things.filter((thing) => thing.kind === "teleport-destination"),
    ).toHaveLength(1);
  });

  it("lands beside a room drawn in the middle of the one aimed at", () => {
    const edge = wallKey("a", "b");
    const map = setLineTarget(
      updateLine(islandMap, edge, { action: action("teleport") }),
      edge,
      "yard",
    );
    const spot = defined(
      map.things.find((thing) => thing.kind === "teleport-destination"),
    );
    expect(sectorAt(map, spot)?.id).toBe("yard");
  });

  it("places nothing in a door, which is shut", () => {
    const map = setLineTarget(
      updateLine(testMap, openWall, { action: action("teleport") }),
      openWall,
      "sector-4",
    );
    expect(map.things).toEqual(testMap.things);
  });

  it("lands teleporters given an action together", () => {
    const map = setWallsAction(aimed("floor-lower"), [openWall], "teleport");
    expect(
      map.things.filter((thing) => thing.kind === "teleport-destination"),
    ).toHaveLength(1);
  });

  it("draws nothing for a door pressed open, which acts on what is behind it", () => {
    const map = updateLine(testMap, wallKey("v13", "v14"), {
      action: { kind: "door-raise", trigger: "door", repeat: true, tag: 0 },
    });
    expect(lineLinks(map, wallKey("v13", "v14"))).toEqual([]);
  });
});
