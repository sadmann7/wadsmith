import { describe, expect, it } from "vitest";

import { defined } from "@/lib/defined";
import { setLineTarget, updateLine, updateSector } from "@/lib/map/edit";
import { wallKey } from "@/lib/map/geometry";
import { testMap } from "@/lib/map/test-map";

import { moverAt, withMovers } from "./movers";

const doorWall = wallKey("v13", "v14");
const openWall = wallKey("v3", "v4");

describe("doors and lifts in the 3D view", () => {
  it("shuts every door, and opens one to just under the lowest ceiling beside it", () => {
    const door = (opened: string[]) =>
      defined(
        withMovers(testMap, opened).sectors.find(
          (sector) => sector.id === "sector-4",
        ),
      );
    expect(door([]).ceiling).toBe(door([]).floor);
    // The corridor's ceiling is at 96 and the arena's at 192.
    expect(door(["sector-4"]).ceiling).toBe(92);
    expect(withMovers(testMap, [])).toBe(withMovers(testMap, []));
  });

  it("lowers a lift to the lowest floor beside it", () => {
    const raised = updateSector(testMap, "sector-2", { floor: 64 });
    const wired = setLineTarget(
      updateLine(raised, openWall, {
        action: { kind: "lift", trigger: "switch", repeat: true, tag: 0 },
      }),
      openWall,
      "sector-2",
    );
    const corridor = (opened: string[]) =>
      defined(
        withMovers(wired, opened).sectors.find(
          (sector) => sector.id === "sector-2",
        ),
      ).floor;
    expect(corridor([])).toBe(64);
    // The start room's floor is at 0 and the door's at -16.
    expect(corridor(["sector-2"])).toBe(-16);
    expect(moverAt(wired, "floor:sector-2")).toBe("sector-2");
    expect(moverAt(wired, "floor:sector-1")).toBeNull();
    expect(moverAt(wired, `wall:sector-1:${openWall}:lower`)).toBe("sector-2");
  });

  it("leaves a room that is no door or lift where it is", () => {
    expect(withMovers(testMap, ["sector-1", "gone"]).sectors[0].floor).toBe(
      testMap.sectors[0].floor,
    );
    // The corridor is a lift here, and its wall into the door still stands
    // for the door.
    const wired = setLineTarget(
      updateLine(testMap, openWall, {
        action: { kind: "lift", trigger: "switch", repeat: true, tag: 0 },
      }),
      openWall,
      "sector-2",
    );
    expect(moverAt(wired, `wall:sector-2:${doorWall}:upper`)).toBe("sector-4");
  });

  it("finds the door behind a wall that wears its face", () => {
    expect(moverAt(testMap, `wall:sector-2:${doorWall}:upper`)).toBe(
      "sector-4",
    );
    expect(moverAt(testMap, "floor:sector-4")).toBe("sector-4");
    expect(moverAt(testMap, "thing:imp-1")).toBeNull();
    expect(moverAt(testMap, null)).toBeNull();
  });
});
