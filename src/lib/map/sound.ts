import { type TextureHeight, withMovers } from "@/lib/preview/movers";
import { type CustomThings, thingCategory } from "@/lib/wad/custom-things";

import type { GameMap, Sector } from "./types";

import { sectorAt, wallOwners } from "./geometry";

// How a room hears a noise: straight through open lines, or past one line
// that blocks sound, which is as far as Doom lets it go.
export type Hearing = "heard" | "muffled";

export interface SoundReach {
  rooms: Map<string, Hearing>;
  woken: string[];
  deaf: string[];
}

// Where a noise made in one room carries, the way P_RecursiveSound floods it
// in Doom: through every two-sided line with a gap between the rooms' floors
// and ceilings, and past a sound-blocking line only once. Doors start shut,
// and lifts and moving floors and ceilings where the map holds them.
export function soundReach(
  source: GameMap,
  from: string,
  {
    doorsOpen = false,
    floorsMoved = false,
    custom = new Map(),
    textureHeight,
  }: {
    doorsOpen?: boolean;
    floorsMoved?: boolean;
    custom?: CustomThings;
    textureHeight?: TextureHeight;
  } = {},
): SoundReach {
  const map = withMovers(
    source,
    source.sectors
      .filter((sector) => (sector.door ? doorsOpen : floorsMoved))
      .map((sector) => sector.id),
    textureHeight,
  );
  const rooms = new Map<string, Hearing>();
  const neighbours = new Map<string, { room: Sector; blocks: boolean }[]>();
  for (const [wall, owners] of wallOwners(map)) {
    const [a, b] = owners;
    if (!a || !b || a === b || !hasGap(a, b)) continue;
    const blocks = !!map.lines?.[wall]?.soundBlock;
    neighbours.set(a.id, [
      ...(neighbours.get(a.id) ?? []),
      { room: b, blocks },
    ]);
    neighbours.set(b.id, [
      ...(neighbours.get(b.id) ?? []),
      { room: a, blocks },
    ]);
  }
  const start = map.sectors.find((sector) => sector.id === from);
  if (start) {
    const flood = (seeds: string[], hearing: Hearing, past: string[]) => {
      const queue = [...seeds];
      for (const id of queue) {
        if (rooms.has(id)) continue;
        rooms.set(id, hearing);
        for (const { room, blocks } of neighbours.get(id) ?? []) {
          if (blocks) past.push(room.id);
          else queue.push(room.id);
        }
      }
    };
    const blocked: string[] = [];
    flood([start.id], "heard", blocked);
    flood(blocked, "muffled", []);
  }
  const woken: string[] = [];
  const deaf: string[] = [];
  for (const thing of map.things) {
    if (thingCategory(thing, custom) !== "enemy") continue;
    const room = sectorAt(map, thing);
    if (!room || !rooms.has(room.id)) continue;
    (thing.ambush ? deaf : woken).push(thing.id);
  }
  return { rooms, woken, deaf };
}

function hasGap(a: Sector, b: Sector) {
  return Math.min(a.ceiling, b.ceiling) > Math.max(a.floor, b.floor);
}
