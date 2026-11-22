import { describe, expect, it } from "vitest";

import { updateLine, updateSector } from "./edit";
import { similarRooms, similarThings, similarWalls } from "./similar";
import { testMap } from "./test-map";

describe("selecting similar", () => {
  it("finds rooms with the same floor, light or tag", () => {
    expect(similarRooms(testMap, "sector-2", "floor")).toEqual(["sector-2"]);
    const tagged = updateSector(
      updateSector(testMap, "sector-1", { tag: 3 }),
      "sector-3",
      { tag: 3 },
    );
    expect(similarRooms(tagged, "sector-1", "tag")).toEqual([
      "sector-1",
      "sector-3",
    ]);
    expect(similarRooms(testMap, "sector-1", "tag")).toEqual(["sector-1"]);
  });

  it("finds walls with the same texture or action", () => {
    const walls = similarWalls(testMap, "v1|v15", "sector-1", "texture");
    expect(walls).toContain("v5|v6");
    expect(walls).not.toContain("v9|v10");
    const exit = {
      kind: "exit",
      trigger: "switch",
      repeat: false,
      tag: 0,
    } as const;
    const marked = updateLine(
      updateLine(testMap, "v1|v15", { action: exit }),
      "v5|v6",
      { action: exit },
    );
    expect(
      similarWalls(marked, "v1|v15", "sector-1", "action").toSorted(),
    ).toEqual(["v1|v15", "v5|v6"]);
  });

  it("finds things of the same kinds", () => {
    expect(similarThings(testMap, ["imp-1"])).toEqual(["imp-1"]);
  });
});
