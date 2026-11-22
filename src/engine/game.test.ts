import { describe, expect, it } from "vitest";

import {
  engineSlot,
  games,
  lumpSlotIndex,
  slotCount,
  slotName,
  statusIndex,
  statusSlot,
  warpArgs,
} from "./game";

describe("game slots", () => {
  it("counts the slots each game has", () => {
    expect(slotCount(games.doom2)).toBe(32);
    expect(slotCount(games.doom)).toBe(36);
    expect(slotCount({ ...games.doom, episodes: 3 })).toBe(27);
  });

  it("plays a Doom 1 game's slots as episodes and maps", () => {
    expect(engineSlot("MAP01", games.doom2)).toBe("MAP01");
    expect(engineSlot("MAP01", games.doom)).toBe("E1M1");
    expect(engineSlot("MAP09", games.doom)).toBe("E1M9");
    expect(engineSlot("MAP10", games.doom)).toBe("E2M1");
    expect(engineSlot("MAP36", games.doom)).toBe("E4M9");
    expect(slotName(14, true)).toBe("E2M5");
    expect(slotName(14, false)).toBe("MAP14");
    expect(lumpSlotIndex("E2M5")).toBe(14);
    expect(lumpSlotIndex("MAP14")).toBe(14);
    expect(lumpSlotIndex("THINGS")).toBeNull();
  });

  it("warps and reads the engine's position the game's way", () => {
    expect(warpArgs(games.doom2, 14)).toEqual(["-warp", "14"]);
    expect(warpArgs(games.doom, 14)).toEqual(["-warp", "2", "5"]);
    expect(statusIndex(games.doom2, 0, 7)).toBe(7);
    expect(statusIndex(games.doom, 3, 2)).toBe(20);
    expect(statusSlot(games.doom2, 0, 7)).toBe("MAP07");
    expect(statusSlot(games.doom, 3, 2)).toBe("E3M2");
  });
});
