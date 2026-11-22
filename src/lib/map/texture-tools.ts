import type { GameMap, LineSettings, Sector } from "./types";

import { updateLineSide, updateSector } from "./edit";
import {
  engineOrder,
  loopEdges,
  sectorContainers,
  sectorLoops,
  wallKey,
  wallOwners,
  wallPartTexture,
} from "./geometry";

export type TextureKind = "wall" | "flat";

// Powers of two up to this wrap cleanly here, which covers a texture whose
// width isn't known yet.
const unknownSpan = 1024;
const sideParts = ["upper", "lower", "middle"] as const;

// Runs a room's texture on unbroken from one wall: each wall beside it that
// shows the same texture starts where the last one ended, both ways round,
// until a wall shows something else. A switch and a door's face keep their
// art and the run carries on past them. Offsets wrap at `widthOf` a texture.
export function alignWalls(
  map: GameMap,
  sectorId: string,
  wall: string,
  widthOf: (texture: string) => number,
): GameMap {
  const sector = map.sectors.find((item) => item.id === sectorId);
  if (!sector || sector.door) return map;
  const owners = wallOwners(map);
  const switches = new Set(
    map.switches.map((item) => wallKey(item.from, item.to)),
  );
  // What this room's side of a wall shows, as the compiler writes it: null
  // for a wall that isn't this room's to paint, and no textures for one that
  // wears a switch's or a door's, or that the rooms' heights leave bare.
  const shown = (key: string) => {
    const sides = owners.get(key) ?? [];
    if (!sides.includes(sector)) return null;
    const other = sides.find((item) => item !== sector);
    if (switches.has(key) || other?.door) return [];
    if (!other) return [wallPartTexture(map, sector, key, "middle")];
    return [
      ...(other.ceiling < sector.ceiling
        ? [wallPartTexture(map, sector, key, "upper")]
        : []),
      ...(other.floor > sector.floor
        ? [wallPartTexture(map, sector, key, "lower")]
        : []),
    ];
  };
  // A bare open wall shows its parts once a floor or ceiling moves, as a
  // lift's shaft does, so one that would wear the run's texture joins it.
  const hidden = (key: string) => {
    const sides = owners.get(key) ?? [];
    const other = sides.find((item) => item !== sector);
    return other && !other.door && !switches.has(key)
      ? [
          wallPartTexture(map, sector, key, "upper"),
          wallPartTexture(map, sector, key, "lower"),
        ]
      : [];
  };
  const textures = shown(wall);
  if (!textures || textures.length === 0) return map;
  // A room drawn inside this one shows this room its walls from outside, the
  // way a pillar does.
  const containers = sectorContainers(map);
  const loops = [
    ...sectorLoops(sector).map((loop, at) => ({ loop, pillar: at > 0 })),
    ...map.sectors
      .filter((item) => containers.get(item.id) === sector)
      .map((item) => ({ loop: item.vertices, pillar: true })),
  ];
  for (const { loop, pillar } of loops) {
    const edges = loopEdges(engineOrder(map, loop, pillar)).map((edge) => ({
      key: wallKey(edge.from, edge.to),
      length: Math.round(
        Math.hypot(
          map.vertices[edge.to].x - map.vertices[edge.from].x,
          map.vertices[edge.to].y - map.vertices[edge.from].y,
        ),
      ),
    }));
    const start = edges.findIndex((edge) => edge.key === wall);
    if (start < 0) continue;
    const width = widthOf(textures[0]);
    const span = width > 1 ? width : unknownSpan;
    const carries = (key: string) => {
      const here = shown(key);
      return (
        here !== null &&
        (here.length === 0 ||
          here.some((texture) => textures.includes(texture)))
      );
    };
    const offsets = new Map([
      [wall, map.lines?.[wall]?.sides?.[sector.id]?.offsetX ?? 0],
    ]);
    const count = edges.length;
    let offset = offsets.get(wall) ?? 0;
    for (let step = 1; step < count; step += 1) {
      const edge = edges[(start + step) % count];
      if (!carries(edge.key)) break;
      offset += edges[(start + step - 1) % count].length;
      offsets.set(edge.key, offset);
    }
    offset = offsets.get(wall) ?? 0;
    for (let step = 1; step < count; step += 1) {
      const edge = edges[(start - step + count) % count];
      if (offsets.has(edge.key) || !carries(edge.key)) break;
      offset -= edge.length;
      offsets.set(edge.key, offset);
    }
    return [...offsets].reduce((next, [key, value]) => {
      const bare = shown(key)?.length === 0;
      if (bare && !hidden(key).some((item) => textures.includes(item))) {
        return next;
      }
      const wrapped = ((value % span) + span) % span;
      const current = next.lines?.[key]?.sides?.[sector.id]?.offsetX ?? 0;
      return wrapped === current
        ? next
        : updateLineSide(next, key, sector.id, {
            offsetX: wrapped || undefined,
          });
    }, map);
  }
  return map;
}

// How many places show a texture: room walls, single walls and the parts of
// line sides for a wall texture, floors and ceilings for a flat. A door's and
// a switch's own face stay as they are, since each takes a face of its kind.
export function countTexture(map: GameMap, name: string, kind: TextureKind) {
  if (kind === "flat") {
    return map.sectors.reduce(
      (count, sector) =>
        count +
        Number(sector.floorTexture === name) +
        Number(sector.ceilingTexture === name),
      0,
    );
  }
  const walls = map.sectors.reduce(
    (count, sector) =>
      count +
      Number(sector.wallTexture === name) +
      Object.values(sector.wallOverrides ?? {}).filter(
        (texture) => texture === name,
      ).length,
    0,
  );
  return Object.values(map.lines ?? {}).reduce(
    (count, line) =>
      count +
      Object.values(line.sides ?? {}).reduce(
        (total, side) =>
          total + sideParts.filter((part) => side[part] === name).length,
        0,
      ),
    walls,
  );
}

export function replaceTexture(
  map: GameMap,
  from: string,
  to: string,
  kind: TextureKind,
): { map: GameMap; count: number } {
  const count = countTexture(map, from, kind);
  if (count === 0 || from === to) return { map, count };
  const swap = (texture: string) => (texture === from ? to : texture);
  if (kind === "flat") {
    return {
      count,
      map: {
        ...map,
        sectors: map.sectors.map((sector) =>
          sector.floorTexture === from || sector.ceilingTexture === from
            ? {
                ...sector,
                floorTexture: swap(sector.floorTexture),
                ceilingTexture: swap(sector.ceilingTexture),
              }
            : sector,
        ),
      },
    };
  }
  const sectors = map.sectors.reduce((changed, sector) => {
    const patch = wallPatch(sector, swap);
    return patch ? updateSector(changed, sector.id, patch) : changed;
  }, map).sectors;
  const lines =
    map.lines &&
    Object.fromEntries(
      Object.entries(map.lines).map(([wall, line]) => [
        wall,
        swapSides(line, from, to),
      ]),
    );
  return { count, map: { ...map, sectors, ...(lines ? { lines } : {}) } };
}

function swapSides(line: LineSettings, from: string, to: string) {
  const sides = Object.entries(line.sides ?? {});
  if (
    !sides.some(([, side]) => sideParts.some((part) => side[part] === from))
  ) {
    return line;
  }
  return {
    ...line,
    sides: Object.fromEntries(
      sides.map(([sector, side]) => [
        sector,
        {
          ...side,
          ...Object.fromEntries(
            sideParts
              .filter((part) => side[part] === from)
              .map((part) => [part, to]),
          ),
        },
      ]),
    ),
  };
}

function wallPatch(sector: Sector, swap: (texture: string) => string) {
  const wallTexture = swap(sector.wallTexture);
  const overrides = sector.wallOverrides
    ? Object.fromEntries(
        Object.entries(sector.wallOverrides).map(([wall, texture]) => [
          wall,
          swap(texture),
        ]),
      )
    : undefined;
  const changed =
    wallTexture !== sector.wallTexture ||
    Object.entries(overrides ?? {}).some(
      ([wall, texture]) => texture !== sector.wallOverrides?.[wall],
    );
  return changed
    ? { wallTexture, ...(overrides ? { wallOverrides: overrides } : {}) }
    : null;
}
