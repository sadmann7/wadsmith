import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { thingCatalog, thingKinds } from "@/map/catalog";
import { freedoomFlats, freedoomWalls } from "@/map/freedoom-textures";
import { compileMap } from "./compile";
import { decompileMap } from "./decompile";
import { readMaps, type DoomMap } from "./read-map";

const freedoom = resolve(
  import.meta.dirname,
  "../../public/engine/freedoom2.wad",
);

const lineTwoSided = 0x0004;
const lineBlocksAll = 0x0001;
const lineLowerUnpegged = 0x0010;
// A door in the editor opens the same way from every side, with one texture,
// so the WAD's door lines take the door's special, tag and face.
const manualDoors = new Set([1, 26, 27, 28, 31, 32, 33, 34, 117, 118]);
const lineReserved = 0x0800;
const vanillaLineFlags = 0x01ff;
const thingAmbush = 0x0008;
const thingFriendly = 0x0080;
const doomTypes = new Set(
  thingKinds.map((kind) => thingCatalog[kind].doomType),
);
const enemyTypes = new Set(
  thingKinds
    .filter((kind) => thingCatalog[kind].category === "enemy")
    .map((kind) => thingCatalog[kind].doomType),
);
const walls = new Set<string>(freedoomWalls);
const flats = new Set<string>(freedoomFlats);

function thingKey(thing: DoomMap["things"][number]) {
  const enemy = enemyTypes.has(thing.type);
  const flags = enemy
    ? thing.flags
    : thing.flags & ~(thingAmbush | thingFriendly);
  const angle = ((thing.angle % 360) + 360) % 360;
  return `${thing.x},${thing.y} ${angle} ${thing.type} ${flags}`;
}

function endpoints(doom: DoomMap, line: DoomMap["lines"][number]) {
  const a = doom.vertices[line.start];
  const b = doom.vertices[line.end];
  const first = `${a.x},${a.y}`;
  const second = `${b.x},${b.y}`;
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function rebuild(doom: DoomMap) {
  const { map, report } = decompileMap(doom);
  const [again] = readMaps([
    { name: "again.wad", data: compileMap(map, doom.slot) },
  ]);
  const sourceIndex = (built: number) =>
    Number(/^s(\d+)/.exec(map.sectors[built].id)![1]);
  return { map, report, again, sourceIndex };
}

// What the editor keeps of a map must come back out of the WAD it builds.
// The exceptions are the choices it makes on purpose: textures it has no
// name for, doors it opens because it can't hold them shut, and the side of
// a line it calls the front.
describe.skipIf(!existsSync(freedoom))("Freedoom round trip", () => {
  let maps: DoomMap[] = [];

  beforeAll(() => {
    maps = readMaps([
      { name: "freedoom2.wad", data: new Uint8Array(readFileSync(freedoom)) },
    ]);
  });

  it("brings every thing back where it was", () => {
    for (const doom of maps) {
      const { report, again } = rebuild(doom);
      const known = doom.things.filter(
        (thing) =>
          doomTypes.has(thing.type) &&
          ((thing.flags & 7) !== 0 ||
            (thing.type >= 1 && thing.type <= 4) ||
            thing.type === 11),
      );
      const pool = new Map<string, number>();
      for (const thing of known) {
        const key = thingKey(thing);
        pool.set(key, (pool.get(key) ?? 0) + 1);
      }
      for (const thing of again.things) {
        const key = thingKey(thing);
        expect(pool.get(key) ?? 0, `${doom.slot} ${key}`).toBeGreaterThan(0);
        pool.set(key, pool.get(key)! - 1);
      }
      // The only things left out are the ones outside every room.
      expect(known.length - again.things.length, doom.slot).toBe(
        report.outsideThings,
      );
    }
  }, 120_000);

  it("brings every sector back with its heights, light, special and tag", () => {
    for (const doom of maps) {
      const { map, report, again, sourceIndex } = rebuild(doom);
      const replaced = new Set(report.replacedTextures);
      let opened = 0;
      map.sectors.forEach((_, at) => {
        const index = sourceIndex(at);
        const source = doom.sectors[index];
        const built = again.sectors[at];
        const label = `${doom.slot} sector ${index}`;
        expect(built.floor, label).toBe(source.floor);
        if (built.ceiling !== Math.max(source.ceiling, source.floor)) {
          opened += 1;
        }
        expect(built.light, label).toBe(
          Math.min(255, Math.max(0, source.light)),
        );
        expect(built.special, label).toBe(source.special);
        expect(built.tag, label).toBe(source.tag);
        if (!replaced.has(source.floorTexture)) {
          expect(built.floorTexture, label).toBe(source.floorTexture);
        }
        if (!replaced.has(source.ceilingTexture)) {
          expect(built.ceilingTexture, label).toBe(source.ceilingTexture);
        }
      });
      expect(opened, doom.slot).toBeLessThanOrEqual(report.plainDoors);
    }
  }, 120_000);

  it("brings every line back with its special, tag, flags and sides", () => {
    const misses: string[] = [];
    for (const doom of maps) {
      const { map, report, again, sourceIndex } = rebuild(doom);
      const sources = new Map<string, DoomMap["lines"][number][]>();
      for (const line of doom.lines) {
        const key = endpoints(doom, line);
        sources.set(key, [...(sources.get(key) ?? []), line]);
      }
      const replaced = new Set(report.replacedTextures);
      const doors = new Set(
        map.sectors.flatMap((sector, at) =>
          sector.door ? [sourceIndex(at)] : [],
        ),
      );
      // The editor pegs switch art to the floor.
      const switches = new Set(
        map.switches.map((item) => {
          const a = map.vertices[item.from];
          const b = map.vertices[item.to];
          const first = `${a.x},${-a.y}`;
          const second = `${b.x},${-b.y}`;
          return first < second ? `${first}|${second}` : `${second}|${first}`;
        }),
      );
      for (const line of again.lines) {
        const key = endpoints(again, line);
        const candidates = sources.get(key) ?? [];
        if (candidates.length !== 1) continue;
        const [source] = candidates;
        const sourceFlags =
          source.flags & lineReserved
            ? source.flags & vanillaLineFlags
            : source.flags;
        const twoSided = Boolean(line.flags & lineTwoSided);
        // Switch art and door tracks are pegged to the floor by the editor.
        const pegged =
          switches.has(key) ||
          (!twoSided &&
            line.front !== null &&
            doors.has(sourceIndex(again.sides[line.front].sector)));
        const mask =
          0xffff &
          ~(
            lineTwoSided |
            (twoSided ? 0 : lineBlocksAll) |
            (pegged ? lineLowerUnpegged : 0)
          );
        const note = (what: string) =>
          misses.push(`${doom.slot} ${key}: ${what}`);
        if ((line.flags & mask) !== (sourceFlags & mask)) {
          note(`flags ${line.flags} vs ${sourceFlags}`);
        }
        const doorLine = manualDoors.has(line.special);
        if (line.tag !== source.tag && line.special !== 0 && !doorLine) {
          note(`tag ${line.tag} vs ${source.tag}`);
        }
        if (
          line.special !== source.special &&
          !(
            doorLine &&
            (source.special === 0 || manualDoors.has(source.special))
          )
        ) {
          note(`special ${line.special} vs ${source.special}`);
        }
        // Sides pair up by the sector they face, since the editor picks a
        // line's front for itself. Upper and lower textures never show on a
        // one-sided line or between a sector and itself, the wall above a
        // door takes the door's own, and a door's track takes the editor's.
        const sourceSectors = [source.front, source.back].map((side) =>
          side === null ? null : doom.sides[side].sector,
        );
        const detail =
          sourceSectors[0] !== null && sourceSectors[0] === sourceSectors[1];
        for (const builtSide of [line.front, line.back]) {
          if (builtSide === null) continue;
          const built = again.sides[builtSide];
          const sector = sourceIndex(built.sector);
          const at = sourceSectors.indexOf(sector);
          const sourceSide = at < 0 ? null : [source.front, source.back][at];
          if (sourceSide === null) {
            note(`no side faces sector ${sector}`);
            continue;
          }
          const was = doom.sides[sourceSide];
          const other = sourceSectors[1 - at];
          const onDoor =
            doors.has(sector) || (other !== null && doors.has(other));
          if (built.offsetX !== was.offsetX || built.offsetY !== was.offsetY) {
            note(
              `offsets ${built.offsetX},${built.offsetY} vs ${was.offsetX},${was.offsetY}`,
            );
          }
          for (const part of ["upper", "lower", "middle"] as const) {
            const name = was[part];
            if (name === "-" || replaced.has(name)) continue;
            if (!walls.has(name) && !flats.has(name)) continue;
            if ((detail || !twoSided) && part !== "middle") continue;
            if (onDoor && part !== "lower") continue;
            if (built[part] !== name) note(`${part} ${built[part]} vs ${name}`);
          }
        }
      }
    }
    expect(misses.slice(0, 80)).toEqual([]);
  }, 120_000);
});
