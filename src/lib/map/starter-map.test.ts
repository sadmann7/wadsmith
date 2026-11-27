import { describe, expect, it } from "vitest";

import { defined } from "@/lib/defined";
import { compileLumps } from "@/lib/wad/compile";

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
      islands: [],
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

  it("lines the co-op starts up side by side, facing the first door", () => {
    const starts = starterMap.things.filter((thing) =>
      thing.kind.startsWith("player"),
    );
    expect(new Set(starts.map((thing) => thing.x)).size).toBe(1);
    expect(starts.every((thing) => thing.angle === 0)).toBe(true);
    const rows = starts.map((thing) => thing.y).sort((a, b) => a - b);
    for (let index = 1; index < rows.length; index += 1) {
      expect(rows[index] - rows[index - 1]).toBeGreaterThanOrEqual(48);
    }
  });

  it("marks the locked door's frame in its key's colour", () => {
    const sides = defined(
      compileLumps(starterMap).find((lump) => lump.name === "SIDEDEFS"),
    ).data;
    const names = new Set<string>();
    for (let at = 0; at < sides.length; at += 30) {
      const name = sides.subarray(at + 20, at + 28);
      names.add(new TextDecoder().decode(name).replace(/\0+$/, ""));
    }
    expect(names).toContain("DOORBLU");
  });

  it("opens every door from the door itself, with no remote switch", () => {
    const doors = starterMap.sectors.filter((sector) => sector.door);
    expect(doors.map((door) => door.door?.opensBy)).toEqual(
      doors.map(() => "use"),
    );
    expect(starterMap.switches.every((item) => item.door === null)).toBe(true);
  });
});
