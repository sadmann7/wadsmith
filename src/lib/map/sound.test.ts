import { describe, expect, it } from "vitest";

import { createFlatAssets } from "@/lib/wad/assets";

import type { GameMap, LineActionKind } from "./types";

import { setLineTarget, updateLine, updateSector } from "./edit";
import { wallKey, wallOwners } from "./geometry";
import { soundReach } from "./sound";
import { testMap } from "./test-map";

const assets = createFlatAssets();

describe("soundReach", () => {
  it("stops at a shut door", () => {
    const reach = soundReach(testMap, "sector-1", assets);
    expect([...reach.rooms]).toEqual([
      ["sector-1", "heard"],
      ["sector-2", "heard"],
    ]);
    expect(reach.woken).toEqual([]);
  });

  it("wakes the monsters past an open door", () => {
    const reach = soundReach(testMap, "sector-1", assets, { doorsOpen: true });
    expect(reach.rooms.get("sector-3")).toBe("heard");
    expect(reach.woken).toEqual(["zombieman-1", "imp-1"]);
  });

  it("carries past one sound-blocking line, and no further", () => {
    const [wall] = [...wallOwners(testMap)].find(
      ([, owners]) =>
        owners
          .map((room) => room.id)
          .toSorted()
          .join() === "sector-1,sector-2",
    ) ?? [""];
    const blocked: GameMap = {
      ...testMap,
      lines: { ...testMap.lines, [wall]: { soundBlock: true } },
    };
    const reach = soundReach(blocked, "sector-1", assets, { doorsOpen: true });
    expect(reach.rooms.get("sector-1")).toBe("heard");
    expect(reach.rooms.get("sector-2")).toBe("muffled");
    expect(reach.rooms.get("sector-3")).toBe("muffled");
  });

  it("leaves deaf monsters for sight to wake", () => {
    const deafMap: GameMap = {
      ...testMap,
      things: testMap.things.map((thing) =>
        thing.id === "imp-1" ? { ...thing, ambush: true } : thing,
      ),
    };
    const reach = soundReach(deafMap, "sector-1", assets, { doorsOpen: true });
    expect(reach.woken).toEqual(["zombieman-1"]);
    expect(reach.deaf).toEqual(["imp-1"]);
  });

  it("passes a lift once it has lowered", () => {
    const lift = corridorMover(
      updateSector(testMap, "sector-2", { floor: 96 }),
      "lift",
    );
    expect([...soundReach(lift, "sector-1", assets).rooms.keys()]).toEqual([
      "sector-1",
    ]);
    const lowered = soundReach(lift, "sector-1", assets, { floorsMoved: true });
    expect(lowered.rooms.get("sector-2")).toBe("heard");
  });

  it("stops at a floor once it has raised to the ceiling", () => {
    // The door, made a plain room here, would otherwise stay shut at -16.
    const raising = corridorMover(
      updateSector(testMap, "sector-4", { door: undefined }),
      "floor-raise",
    );
    expect(soundReach(raising, "sector-1", assets).rooms.get("sector-2")).toBe(
      "heard",
    );
    const raised = soundReach(raising, "sector-1", assets, {
      floorsMoved: true,
    });
    expect([...raised.rooms.keys()]).toEqual(["sector-1"]);
    expect(raised.woken).toEqual([]);
  });

  it("raises a floor by its shortest lower texture, as the 3D view does", () => {
    const raising = corridorMover(
      updateSector(testMap, "sector-4", { door: undefined }),
      "floor-raise-texture",
    );
    const tall = {
      ...assets,
      texture: (name: string) => ({ ...assets.texture(name), height: 128 }),
    };
    const raised = soundReach(raising, "sector-1", tall, { floorsMoved: true });
    expect([...raised.rooms.keys()]).toEqual(["sector-1"]);
    const still = soundReach(raising, "sector-1", assets, {
      floorsMoved: true,
    });
    expect(still.rooms.get("sector-2")).toBe("heard");
  });
});

// The corridor, sector-2, worked by a switch on its wall to the start room.
function corridorMover(map: GameMap, kind: LineActionKind) {
  const wall = wallKey("v3", "v4");
  return setLineTarget(
    updateLine(map, wall, {
      action: { kind, trigger: "switch", repeat: true, tag: 0 },
    }),
    wall,
    "sector-2",
  );
}
