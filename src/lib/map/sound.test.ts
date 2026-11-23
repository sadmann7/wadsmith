import { describe, expect, it } from "vitest";

import type { GameMap } from "./types";

import { wallOwners } from "./geometry";
import { soundReach } from "./sound";
import { testMap } from "./test-map";

describe("soundReach", () => {
  it("stops at a shut door", () => {
    const reach = soundReach(testMap, "sector-1");
    expect([...reach.rooms]).toEqual([
      ["sector-1", "heard"],
      ["sector-2", "heard"],
    ]);
    expect(reach.woken).toEqual([]);
  });

  it("wakes the monsters past an open door", () => {
    const reach = soundReach(testMap, "sector-1", { doorsOpen: true });
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
    const reach = soundReach(blocked, "sector-1", { doorsOpen: true });
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
    const reach = soundReach(deafMap, "sector-1", { doorsOpen: true });
    expect(reach.woken).toEqual(["zombieman-1"]);
    expect(reach.deaf).toEqual(["imp-1"]);
  });
});
