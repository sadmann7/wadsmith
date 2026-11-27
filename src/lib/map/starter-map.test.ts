import { describe, expect, it } from "vitest";

import { mapBalance } from "./balance";
import { checkMap } from "./checks";
import { sectorAt } from "./geometry";
import { findUnreachable } from "./reach";
import { starterMap } from "./starter-map";

describe("starter map", () => {
  it("passes the map check with everything reachable", () => {
    expect(checkMap(starterMap)).toEqual([]);
    expect(findUnreachable(starterMap)).toEqual({
      rooms: [],
      things: [],
      exits: [],
    });
  });

  it.each(["easy", "medium", "hard"] as const)(
    "gives enough health and ammo on %s",
    (skill) => {
      expect(mapBalance(starterMap, skill)).toMatchObject({
        keysMissing: 0,
        healthShort: 0,
        ammoShort: 0,
      });
    },
  );

  it("adds monsters as the skill goes up", () => {
    const [easy, medium, hard] = (["easy", "medium", "hard"] as const).map(
      (skill) => mapBalance(starterMap, skill).enemies,
    );
    expect(easy).toBeLessThan(medium);
    expect(medium).toBeLessThan(hard);
  });

  it("starts four co-op players in the first room", () => {
    const start = starterMap.sectors[0];
    for (const kind of ["player", "player-2", "player-3", "player-4"]) {
      const thing = starterMap.things.find((item) => item.kind === kind);
      expect(thing && sectorAt(starterMap, thing)?.id).toBe(start.id);
    }
  });

  it("opens every door from the door itself, with no remote switch", () => {
    const doors = starterMap.sectors.filter((sector) => sector.door);
    expect(doors.map((door) => door.door?.opensBy)).toEqual(
      doors.map(() => "use"),
    );
    expect(starterMap.switches.every((item) => item.door === null)).toBe(true);
  });
});
