import { describe, expect, it } from "vitest";

import { heightBeside } from "./surfaces";
import { testMap } from "./test-map";

describe("the next height beside a surface", () => {
  it("finds the nearest floor or ceiling of a room beside it", () => {
    expect(heightBeside(testMap, "floor:sector-1", 1)).toBe(96);
    expect(heightBeside(testMap, "floor:sector-1", -1)).toBe(-16);
    expect(heightBeside(testMap, "ceiling:sector-1", -1)).toBe(96);
    expect(heightBeside(testMap, "floor:sector-2", 1)).toBe(0);
  });

  it("finds nothing past the last height, or for a wall", () => {
    expect(heightBeside(testMap, "floor:sector-2", -1)).toBeNull();
    expect(heightBeside(testMap, "ceiling:sector-1", 1)).toBeNull();
    expect(heightBeside(testMap, "wall:sector-1:v1|v15:middle", 1)).toBeNull();
  });
});
