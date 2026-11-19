import { wallKey } from "../geometry";
import type {
  DoorSettings,
  GameMap,
  LineSettings,
  SectorEffect,
  ThingKind,
  ThingSkill,
} from "../types";

type Corner = [number, number];

type RoomSpec = {
  name: string;
  points: Corner[];
  floor: number;
  ceiling: number;
  light: number;
  floorTexture: string;
  ceilingTexture: string;
  wallTexture: string;
  effect?: SectorEffect;
  tag?: number;
  door?: DoorSettings;
};

type ThingSpec = {
  kind: ThingKind;
  at: Corner;
  angle?: number;
  skills?: ThingSkill[];
  ambush?: boolean;
};

type SwitchSpec = {
  room: string;
  wall: [Corner, Corner];
  texture: string;
  door?: string;
};

type LineSpec = { wall: [Corner, Corner]; settings: LineSettings };

type MapSpec = {
  name: string;
  scale?: number;
  rooms: RoomSpec[];
  things: ThingSpec[];
  switches?: SwitchSpec[];
  lines?: LineSpec[];
};

function rect(x: number, y: number, width: number, height: number): Corner[] {
  return [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ];
}

// Plans are drawn on a grid, so a map can list corners in grid units.
function scaled(spec: MapSpec): MapSpec {
  const by = spec.scale ?? 1;
  const corner = ([x, y]: Corner): Corner => [x * by, y * by];
  const wall = ([a, b]: [Corner, Corner]): [Corner, Corner] => [
    corner(a),
    corner(b),
  ];
  return {
    ...spec,
    rooms: spec.rooms.map((room) => ({
      ...room,
      points: room.points.map(corner),
    })),
    things: spec.things.map((thing) => ({ ...thing, at: corner(thing.at) })),
    switches: spec.switches?.map((item) => ({
      ...item,
      wall: wall(item.wall),
    })),
    lines: spec.lines?.map((line) => ({ ...line, wall: wall(line.wall) })),
  };
}

function cornerKey([x, y]: Corner) {
  return `${x},${y}`;
}

// Positions along the wall from a to b of every other corner lying on it.
function cornersOnWall(a: Corner, b: Corner, corners: Corner[]) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const length = dx * dx + dy * dy;
  return corners
    .filter(([x, y]) => (x - a[0]) * dy === (y - a[1]) * dx)
    .map((corner) => ({
      corner,
      along: ((corner[0] - a[0]) * dx + (corner[1] - a[1]) * dy) / length,
    }))
    .filter(({ along }) => along > 0 && along < 1)
    .toSorted((left, right) => left.along - right.along)
    .map(({ corner }) => corner);
}

// Builds a map from room outlines. Rooms that touch only need matching edges:
// shared corners merge, and a wall gains a corner wherever another room's
// corner lies on it, so every wall between two rooms is one shared line.
function buildMap(unscaled: MapSpec): GameMap {
  const spec = scaled(unscaled);
  const corners = [
    ...new Map(
      spec.rooms
        .flatMap((room) => room.points)
        .map((corner) => [cornerKey(corner), corner]),
    ).values(),
  ];
  const ids = new Map(
    corners.map((corner, index) => [cornerKey(corner), `v${index + 1}`]),
  );
  const id = (corner: Corner) => {
    const found = ids.get(cornerKey(corner));
    if (!found) throw new Error(`${spec.name}: no corner at ${corner}.`);
    return found;
  };
  const roomIds = new Map(
    spec.rooms.map((room, index) => [room.name, `sector-${index + 1}`]),
  );
  const roomId = (name: string) => {
    const found = roomIds.get(name);
    if (!found) throw new Error(`${spec.name}: no room named ${name}.`);
    return found;
  };
  const counts = new Map<string, number>();
  const nextThingId = (kind: string) => {
    const count = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, count);
    return `${kind}-${count}`;
  };
  const wall = ([a, b]: [Corner, Corner]) => wallKey(id(a), id(b));

  return {
    name: spec.name,
    vertices: Object.fromEntries(
      corners.map((corner) => [id(corner), { x: corner[0], y: corner[1] }]),
    ),
    sectors: spec.rooms.map(({ points, ...room }) => ({
      id: roomId(room.name),
      ...room,
      vertices: points.flatMap((corner, index) => [
        id(corner),
        ...cornersOnWall(
          corner,
          points[(index + 1) % points.length],
          corners,
        ).map(id),
      ]),
    })),
    things: spec.things.map(({ kind, at, angle = 0, ...thing }) => ({
      id: kind === "player" ? "player-1" : nextThingId(kind),
      kind,
      x: at[0],
      y: at[1],
      angle,
      ...thing,
    })),
    switches: (spec.switches ?? []).map((item, index) => ({
      id: `switch-${index + 1}`,
      sector: roomId(item.room),
      from: id(item.wall[0]),
      to: id(item.wall[1]),
      texture: item.texture,
      door: item.door ? roomId(item.door) : null,
    })),
    lines: Object.fromEntries(
      (spec.lines ?? []).map((line) => [wall(line.wall), line.settings]),
    ),
  };
}

export { buildMap, rect, type Corner, type MapSpec, type RoomSpec };
