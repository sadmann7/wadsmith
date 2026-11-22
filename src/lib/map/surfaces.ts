import type { GameMap, MapSwitch, Sector, Thing } from "./types";

import {
  ceilingTextures,
  doorTextures,
  floorTextures,
  switchTextures,
  thingCatalog,
  wallTextures,
} from "./catalog";
import {
  setDoorTexture,
  setRoomWalls,
  updateLineSide,
  updateSector,
  updateSwitch,
} from "./edit";
import { wallKey, wallOwners, wallPartTexture } from "./geometry";

export type WallPart = "middle" | "upper" | "lower";

export type Surface =
  | { kind: "floor" | "ceiling"; sector: string }
  | { kind: "wall"; sector: string; wall: string; part: WallPart }
  | { kind: "thing"; thing: string };

export interface SurfaceInfo {
  surface: Surface;
  label: string;
  sector: Sector | null;
  thing: Thing | null;
  height: number | null;
  texture: string | null;
  textures: readonly string[];
  paints: "floor" | "ceiling" | "wall" | "door" | "switch" | null;
  mapSwitch: MapSwitch | null;
}

const minimumOpening = 8;
const heightLimit = 2048;

export function surfaceKey(surface: Surface) {
  if (surface.kind === "thing") return `thing:${surface.thing}`;
  if (surface.kind === "wall") {
    return `wall:${surface.sector}:${surface.wall}:${surface.part}`;
  }
  return `${surface.kind}:${surface.sector}`;
}

export function parseSurface(key: string): Surface | null {
  const [kind, first, second, part] = key.split(":");
  if ((kind === "floor" || kind === "ceiling") && first) {
    return { kind, sector: first };
  }
  if (kind === "thing" && first) return { kind, thing: first };
  if (
    kind === "wall" &&
    first &&
    second &&
    (part === "middle" || part === "upper" || part === "lower")
  ) {
    return { kind, sector: first, wall: second, part };
  }
  return null;
}

export function describeSurface(
  map: GameMap,
  key: string | null,
): SurfaceInfo | null {
  const surface = key ? parseSurface(key) : null;
  if (!surface) return null;
  const empty = {
    surface,
    sector: null,
    thing: null,
    height: null,
    texture: null,
    textures: [],
    paints: null,
    mapSwitch: null,
  };

  if (surface.kind === "thing") {
    const thing = map.things.find((item) => item.id === surface.thing);
    if (!thing) return null;
    return { ...empty, thing, label: thingCatalog[thing.kind].label };
  }

  const sector = map.sectors.find((item) => item.id === surface.sector);
  if (!sector) return null;
  if (surface.kind === "floor") {
    return {
      ...empty,
      sector,
      label: `${sector.name} floor`,
      height: sector.floor,
      texture: sector.floorTexture,
      textures: floorTextures,
      paints: "floor",
    };
  }
  if (surface.kind === "ceiling") {
    return {
      ...empty,
      sector,
      label: `${sector.name} ceiling`,
      height: sector.door ? null : sector.ceiling,
      texture: sector.ceilingTexture,
      textures: ceilingTextures,
      paints: "ceiling",
    };
  }

  if (surface.kind !== "wall") return null;
  const owners = wallOwners(map).get(surface.wall) ?? [];
  if (!owners.includes(sector)) return null;
  const mapSwitch =
    map.switches.find((item) => wallKey(item.from, item.to) === surface.wall) ??
    null;
  if (mapSwitch) {
    return {
      ...empty,
      sector,
      mapSwitch,
      label: `Switch in ${sector.name}`,
      texture: mapSwitch.texture,
      textures: switchTextures,
      paints: "switch",
    };
  }
  const neighbor = owners.find((item) => item !== sector);
  if (neighbor?.door && surface.part === "upper") {
    return {
      ...empty,
      sector,
      label: neighbor.name,
      texture:
        map.lines?.[surface.wall]?.sides?.[sector.id]?.upper ??
        neighbor.door.texture,
      textures: doorTextures,
      paints: "door",
    };
  }
  if (sector.door) {
    return { ...empty, sector, label: `${sector.name} frame` };
  }
  // The middle of an open line is its see-through texture, which the line's
  // own settings choose, and not a part of the room's wall.
  if (owners.length > 1 && surface.part === "middle") {
    return {
      ...empty,
      sector,
      label: `Line in ${sector.name}`,
      texture: map.lines?.[surface.wall]?.sides?.[sector.id]?.middle ?? null,
    };
  }
  // Doom flips a switch texture on any part of the line when it is pressed.
  const pressed =
    surface.part !== "middle" &&
    neighbor &&
    map.lines?.[surface.wall]?.action?.trigger === "switch";
  return {
    ...empty,
    sector,
    label: `${sector.name} wall`,
    texture: wallPartTexture(map, sector, surface.wall, surface.part),
    textures: pressed ? [...switchTextures, ...wallTextures] : wallTextures,
    paints: "wall",
  };
}

export function paintSurface(
  map: GameMap,
  key: string,
  texture: string,
  wholeRoom = false,
): GameMap {
  const info = describeSurface(map, key);
  if (!info?.paints) return map;
  const { sector, surface } = info;
  if (info.paints === "switch" && info.mapSwitch) {
    return updateSwitch(map, info.mapSwitch.id, { texture });
  }
  if (!sector) return map;
  if (info.paints === "floor") {
    return updateSector(map, sector.id, { floorTexture: texture });
  }
  if (info.paints === "ceiling") {
    return updateSector(map, sector.id, { ceilingTexture: texture });
  }
  if (surface.kind !== "wall") return map;
  // One face of a door takes its own texture; the whole door takes it as its
  // texture and every face follows.
  if (info.paints === "door") {
    const door = wallOwners(map)
      .get(surface.wall)
      ?.find((item) => item !== sector);
    if (!door?.door) return map;
    return wholeRoom
      ? setDoorTexture(map, door.id, texture)
      : updateLineSide(map, surface.wall, sector.id, {
          upper: texture === door.door.texture ? undefined : texture,
        });
  }
  if (wholeRoom) {
    return (wallTextures as readonly string[]).includes(texture)
      ? setRoomWalls(map, sector.id, texture)
      : map;
  }
  if (surface.part !== "middle" && wallOwners(map).get(surface.wall)?.[1]) {
    return updateLineSide(map, surface.wall, sector.id, {
      [surface.part]: texture,
    });
  }
  return updateSector(map, sector.id, {
    wallOverrides: { ...sector.wallOverrides, [surface.wall]: texture },
  });
}

export function moveSurfaceHeight(
  map: GameMap,
  key: string,
  delta: number,
): GameMap {
  const info = describeSurface(map, key);
  if (!info?.sector || info.height === null) return map;
  const { sector, surface } = info;
  if (surface.kind === "floor") {
    const top = sector.door ? heightLimit : sector.ceiling - minimumOpening;
    const floor = Math.max(-heightLimit, Math.min(top, sector.floor + delta));
    return updateSector(map, sector.id, { floor });
  }
  if (surface.kind === "ceiling") {
    const ceiling = Math.min(
      heightLimit,
      Math.max(sector.floor + minimumOpening, sector.ceiling + delta),
    );
    return updateSector(map, sector.id, { ceiling });
  }
  return map;
}
