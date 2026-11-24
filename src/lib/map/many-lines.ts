import { defined } from "@/lib/defined";

import type {
  GameMap,
  LineActionKind,
  LineSettings,
  LineSide,
  Sector,
} from "./types";

import { landTeleport, updateLine, updateLineSide } from "./edit";
import { wallOwners } from "./geometry";
import {
  describeLine,
  fitLineAction,
  getIsTeleport,
  lineUsesTag,
  newLineAction,
  triggersFor,
  usedFromFront,
} from "./lines";
import { describeSurface, paintSurface, surfaceKey } from "./surfaces";

const skyFlat = "F_SKY1";

export type LineFlag =
  | "blocksAll"
  | "blocksEnemies"
  | "soundBlock"
  | "upperFixed"
  | "lowerFixed"
  | "hidden"
  | "secret"
  | "mapped"
  | "passUse";

export interface WallsLook {
  // Null where the walls differ, or where none shows a wall texture.
  texture: string | null;
  showing: boolean;
  offsetX: number | null;
  offsetY: number | null;
  // An action kind, "none", "raw" for a special set by number, or null where
  // the walls differ.
  action: LineActionKind | "none" | "raw" | null;
  // The tag the walls' actions share, or null where they differ or none use
  // one.
  tag: number | null;
  tagged: boolean;
  // The two rooms every wall lies between, where all of them act only from
  // their front and none borders a door.
  sides: [Sector, Sector] | null;
  // The room the walls act from, or null where they differ.
  front: string | null;
  twoSided: boolean;
  flags: Record<LineFlag, boolean>;
}

const lineFlags: LineFlag[] = [
  "blocksAll",
  "blocksEnemies",
  "soundBlock",
  "upperFixed",
  "lowerFixed",
  "hidden",
  "secret",
  "mapped",
  "passUse",
];

// The parts of every side of a wall that show a room's wall texture: the
// middle of a wall with nothing behind it, and the upper and lower parts of
// one between two rooms where the heights leave them showing. A door's or a
// switch's own face isn't one.
export function wallSurfaces(map: GameMap, wall: string): string[] {
  const owners = wallOwners(map).get(wall) ?? [];
  return [...new Set(owners)].flatMap((room) => {
    const line = describeLine(map, wall, room.id);
    if (line.back !== null && line.back === line.front) return [];
    const beyond = line.front === room ? line.back : line.front;
    // Between two rooms only a step up or a lower ceiling shows a wall, and
    // the engine draws no upper part between two skies.
    const skies =
      beyond?.ceilingTexture === skyFlat && room.ceilingTexture === skyFlat;
    const parts = beyond
      ? [
          ...(beyond.ceiling < room.ceiling && !skies
            ? (["upper"] as const)
            : []),
          ...(beyond.floor > room.floor ? (["lower"] as const) : []),
        ]
      : (["middle"] as const);
    return parts.flatMap((part) => {
      const key = surfaceKey({ kind: "wall", sector: room.id, wall, part });
      return describeSurface(map, key)?.paints === "wall" ? [key] : [];
    });
  });
}

export function describeWalls(map: GameMap, walls: string[]): WallsLook {
  const textures = walls.flatMap((wall) =>
    wallSurfaces(map, wall).map(
      (key) => describeSurface(map, key)?.texture ?? "",
    ),
  );
  const sides = walls.flatMap((wall) =>
    [...new Set(wallOwners(map).get(wall) ?? [])].map(
      (room) => map.lines?.[wall]?.sides?.[room.id] ?? {},
    ),
  );
  const lines = walls.map((wall) => map.lines?.[wall] ?? {});
  const tags = lines.flatMap((line) =>
    line.action && lineUsesTag(line.action) ? [line.action.tag] : [],
  );
  return {
    texture: agreed(textures),
    showing: textures.length > 0,
    offsetX: agreed(sides.map((side) => side.offsetX ?? 0)),
    offsetY: agreed(sides.map((side) => side.offsetY ?? 0)),
    action: agreed(
      lines.map(
        (line) => line.action?.kind ?? (line.raw ? ("raw" as const) : "none"),
      ),
    ),
    tag: agreed(tags),
    tagged: tags.length > 0,
    ...sharedSides(map, walls),
    twoSided: walls.some(
      (wall) => (wallOwners(map).get(wall)?.length ?? 0) > 1,
    ),
    flags: Object.fromEntries(
      lineFlags.map((flag) => [
        flag,
        lines.length > 0 && lines.every((line) => Boolean(line[flag])),
      ]),
    ) as Record<LineFlag, boolean>,
  };
}

export function paintWalls(map: GameMap, walls: string[], texture: string) {
  return walls.reduce(
    (next, wall) =>
      wallSurfaces(next, wall).reduce(
        (painted, key) => paintSurface(painted, key, texture),
        next,
      ),
    map,
  );
}

// Changes every side of each wall, whichever room it faces.
export function updateWallSides(
  map: GameMap,
  walls: string[],
  patch: (side: LineSide) => LineSide,
) {
  return walls.reduce(
    (next, wall) =>
      [...new Set(wallOwners(next).get(wall) ?? [])].reduce(
        (changed, room) =>
          updateLineSide(
            changed,
            wall,
            room.id,
            patch(changed.lines?.[wall]?.sides?.[room.id] ?? {}),
          ),
        next,
      ),
    map,
  );
}

export function updateWalls(
  map: GameMap,
  walls: string[],
  patch: Partial<Omit<LineSettings, "sides">>,
) {
  return walls.reduce((next, wall) => updateLine(next, wall, patch), map);
}

// Gives each wall the action, where it can take it, or takes every wall's
// action away.
export function setWallsAction(
  map: GameMap,
  walls: string[],
  kind: LineActionKind | null,
) {
  return walls.reduce((next, wall) => {
    if (!kind) {
      return updateLine(next, wall, { action: undefined, raw: undefined });
    }
    const owner = wallOwners(next).get(wall)?.[0];
    if (!owner) return next;
    const line = describeLine(next, wall, owner.id);
    if (line.wiredSwitch || triggersFor(kind, line).length === 0) return next;
    // A wall that already acts keeps its trigger, key, repeat and tag where
    // the new action allows them.
    const current = next.lines?.[wall]?.action;
    const action = current
      ? fitLineAction(
          { ...current, kind },
          line,
          kind === current.kind ? current.trigger : undefined,
        )
      : newLineAction(line, kind);
    const acted = updateLine(next, wall, {
      action,
      scrolls: undefined,
      shut: undefined,
      raw: undefined,
    });
    return getIsTeleport(current?.kind) ? acted : landTeleport(acted, wall);
  }, map);
}

export function setWallsTag(map: GameMap, walls: string[], tag: number) {
  return walls.reduce((next, wall) => {
    const action = next.lines?.[wall]?.action;
    return action && lineUsesTag(action)
      ? updateLine(next, wall, { action: { ...action, tag } })
      : next;
  }, map);
}

function sharedSides(map: GameMap, walls: string[]) {
  const described = walls.map((wall) => {
    const line = describeLine(map, wall, "");
    const { action } = line.settings;
    return action &&
      usedFromFront(action) &&
      line.back &&
      line.back !== line.front &&
      !line.front.door &&
      !line.back.door
      ? { front: line.front, back: line.back }
      : null;
  });
  const first = described[0];
  const shared =
    first &&
    described.every(
      (line) =>
        line &&
        [line.front, line.back].includes(first.front) &&
        [line.front, line.back].includes(first.back),
    );
  return shared
    ? {
        sides: [first.front, first.back] as [Sector, Sector],
        front: agreed(described.map((line) => defined(line).front.id)),
      }
    : { sides: null, front: null };
}

function agreed<T>(values: T[]) {
  return values.length > 0 && values.every((value) => value === values[0])
    ? values[0]
    : null;
}
