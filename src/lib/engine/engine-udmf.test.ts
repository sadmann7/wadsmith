import { afterEach, describe, expect, it } from "vitest";

import { defined } from "@/lib/defined";
import { setRoomDoor } from "@/lib/map/edit";
import { testMap } from "@/lib/map/test-map";
import { inspectWads } from "@/lib/wad/inspect";
import { packUdmfTestWad } from "@/lib/wad/test-wad";

import {
  doorIndex,
  holdKey,
  launch,
  play,
  playerAt,
  ready,
  stopGames,
  waitForPlay,
} from "./test-engine";

afterEach(stopGames);

describe.skipIf(!ready)("UDMF maps in the engine", () => {
  for (const namespace of ["doom", "woof"]) {
    it(`opens a door in a ${namespace} map from Play a WAD`, async () => {
      const door = defined(testMap.sectors[doorIndex].door);
      const map = playerAt(
        setRoomDoor(testMap, "sector-4", { ...door, opensBy: "use" }),
        450,
        160,
        0,
      );
      const data = packUdmfTestWad({ ...map, switches: [] }, { namespace });
      const summary = inspectWads([{ name: "udmf.wad", data }]);
      const game = await launch({
        wads: summary.wads,
        dehacked: summary.dehacked,
        complevel: summary.complevel,
        warp: summary.maps[0],
      });
      await waitForPlay(game);
      expect(game.status().inLevel).toBe(true);
      await holdKey(game, "KeyE", 150);
      await play(game, 2000, () => game.sectorCeiling(doorIndex) === 92);
      expect(game.sectorCeiling(doorIndex)).toBe(92);
    }, 30_000);
  }
});
