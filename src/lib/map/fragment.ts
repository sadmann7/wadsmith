import type { GameMap, LineSettings, Point, Sector } from "./types";

import { getIsPlayerStart } from "./catalog";
import {
  applyPositions,
  mergeCorners,
  nextId,
  nextIds,
  positionsOf,
  removeSector,
  removeThing,
  roomKeyPrefix,
  snap,
  snapPoint,
  thingKeyPrefix,
} from "./edit";
import {
  boxOf,
  cross,
  sectorAt,
  sectorContainers,
  sectorEdges,
  sectorLoops,
  sectorVertices,
  wallKey,
  wallOwners,
} from "./geometry";
import { MapFileError, maxFileBytes, parseMap } from "./storage";
import {
  type CheckContext,
  inspectMap,
  issuesSince,
  type MapIssue,
} from "./validate";

// What a selection stands for: whole rooms and things.
export interface SelectedParts {
  sectors: string[];
  things: string[];
}

export type Transform =
  | { kind: "rotate"; degrees: number }
  | { kind: "mirror"; axis: "horizontal" | "vertical" }
  | { kind: "scale"; factor: number };

export type DoorMove = "straight" | "bent";

// How far a resize carries joined doors: with the far wall each meets kept
// straight, alone, not at all, or only the doors named, each as it says.
export type DoorCarry =
  | "walls"
  | "doors"
  | "none"
  | ReadonlyMap<string, DoorMove>;

// A piece read back from text, and the map it says it was copied from.
export interface CopiedPiece {
  fragment: GameMap;
  origin: string | null;
}

interface Pasted {
  map: GameMap;
  // The pasted corners and things, as selection keys.
  keys: string[];
  sectors: string[];
}

const fragmentFormat = "wadsmith-fragment";
const fragmentVersion = 1;
const mostSteps = 4096;

// A room counts as selected when it is the active one or every corner of its
// outline is selected. The rooms drawn inside it and the things standing in
// any of them go where it goes.
export function selectedParts(
  map: GameMap,
  selection: string[],
  activeSector: string | null,
): SelectedParts {
  const rooms = new Set(pickedRooms(map, selection, activeSector));
  const containers = sectorContainers(map);
  for (let grew = rooms.size > 0; grew;) {
    grew = false;
    for (const sector of map.sectors) {
      const container = containers.get(sector.id);
      if (container && rooms.has(container.id) && !rooms.has(sector.id)) {
        rooms.add(sector.id);
        grew = true;
      }
    }
  }
  const picked = new Set(selection);
  return {
    sectors: map.sectors
      .filter((sector) => rooms.has(sector.id))
      .map((sector) => sector.id),
    things: map.things
      .filter((thing) => {
        if (picked.has(`${thingKeyPrefix}${thing.id}`)) return true;
        const room = rooms.size > 0 ? sectorAt(map, thing) : undefined;
        return room !== undefined && rooms.has(room.id);
      })
      .map((thing) => thing.id),
  };
}

// The rooms picked themselves: the active one, and each with every corner of
// its outline selected. The rooms drawn inside them aren't counted.
export function pickedRooms(
  map: GameMap,
  selection: string[],
  activeSector: string | null,
) {
  const corners = new Set(selection.filter((key) => map.vertices[key]));
  const picked = new Set(selection);
  return map.sectors
    .filter(
      (sector) =>
        sector.id === activeSector ||
        picked.has(`${roomKeyPrefix}${sector.id}`) ||
        (corners.size > 0 && sector.vertices.every((id) => corners.has(id))),
    )
    .map((sector) => sector.id);
}

// The selection keys of everything the parts cover, for moving them together.
export function partKeys(map: GameMap, parts: SelectedParts) {
  const rooms = new Set(parts.sectors);
  return [
    ...new Set(
      map.sectors
        .filter((sector) => rooms.has(sector.id))
        .flatMap(sectorVertices),
    ),
    ...parts.things.map((id) => `${thingKeyPrefix}${id}`),
  ];
}

// The parts as a small map of their own. A player start stays behind, since a
// map holds one of each, and a wall that led to a room left behind keeps only
// its look, because it comes out solid.
export function copyParts(map: GameMap, parts: SelectedParts): GameMap | null {
  const rooms = new Set(parts.sectors);
  const picked = new Set(parts.things);
  const sectors = map.sectors.filter((sector) => rooms.has(sector.id));
  const things = map.things.filter(
    (thing) => picked.has(thing.id) && !getIsPlayerStart(thing.kind),
  );
  if (sectors.length === 0 && things.length === 0) return null;
  const used = new Set(sectors.flatMap(sectorVertices));
  const owners = wallOwners(map);
  const lines: Record<string, LineSettings> = {};
  for (const sector of sectors) {
    for (const { from, to } of sectorEdges(sector)) {
      const wall = wallKey(from, to);
      const line = map.lines?.[wall];
      if (!line || lines[wall]) continue;
      const sides = Object.fromEntries(
        Object.entries(line.sides ?? {}).filter(([id]) => rooms.has(id)),
      );
      const whole = (owners.get(wall) ?? []).every((owner) =>
        rooms.has(owner.id),
      );
      const kept: LineSettings = {
        ...(whole ? line : {}),
        front:
          whole && line.front && rooms.has(line.front) ? line.front : undefined,
        sides: Object.keys(sides).length > 0 ? sides : undefined,
      };
      if (kept.front === undefined) delete kept.front;
      if (kept.sides === undefined) delete kept.sides;
      if (Object.keys(kept).length > 0) lines[wall] = kept;
    }
  }
  return {
    vertices: Object.fromEntries(
      Object.entries(map.vertices).filter(([id]) => used.has(id)),
    ),
    sectors,
    things,
    switches: map.switches
      .filter((item) => rooms.has(item.sector))
      .map((item) =>
        item.door && !rooms.has(item.door) ? { ...item, door: null } : item,
      ),
    ...(Object.keys(lines).length > 0 ? { lines } : {}),
  };
}

export function removeParts(map: GameMap, parts: SelectedParts): GameMap {
  return parts.sectors.reduce(
    removeSector,
    parts.things.reduce(removeThing, map),
  );
}

// Puts a piece into a map under new ids, its middle at a point. A corner that
// lands on one already there joins it. A piece that would cover rooms exactly
// moves aside, and a copy made in place moves until it touches nothing. `own`
// says the piece came from this map, so its tags still mean what they meant.
export function pasteParts(
  map: GameMap,
  fragment: GameMap,
  at: Point | null,
  grid: number,
  own = false,
): Pasted | null {
  const points = [...Object.values(fragment.vertices), ...fragment.things];
  if (points.length === 0) return null;
  const box = boxOf(points);
  const middle = {
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2,
  };
  const shift = at
    ? snapPoint({ x: at.x - middle.x, y: at.y - middle.y }, grid)
    : { x: 0, y: 0 };
  const taken = new Set(
    Object.values(map.vertices).map((point) => `${point.x},${point.y}`),
  );
  const corners = Object.values(fragment.vertices);
  const lands = (point: Point) =>
    taken.has(`${point.x + shift.x},${point.y + shift.y}`);
  const aside = Math.max(grid * 2, 32);
  for (
    let tries = 0;
    tries < mostSteps &&
    corners.length > 0 &&
    (at ? corners.every(lands) : corners.some(lands));
    tries += 1
  ) {
    shift.x += aside;
    shift.y += aside;
  }

  const vertices = { ...map.vertices };
  const vertexIds = new Map<string, string>();
  const copied = Object.entries(fragment.vertices);
  const fresh = nextIds("v", Object.keys(vertices), copied.length);
  copied.forEach(([id, point], index) => {
    vertices[fresh[index]] = { x: point.x + shift.x, y: point.y + shift.y };
    vertexIds.set(id, fresh[index]);
  });
  // A piece names only its own corners and rooms. Anything else in it is left
  // out, so text from the clipboard can't reach what the map already holds.
  const wall = (key: string) => {
    const [from, to] = key.split("|").map((id) => vertexIds.get(id));
    return from && to ? wallKey(from, to) : null;
  };

  const sectorIds = new Map<string, string>();
  const names = new Set(map.sectors.map((sector) => sector.name));
  const tags = pastedTags(map, fragment, own);
  const sectors: Sector[] = [];
  for (const sector of fragment.sectors) {
    const loops = [
      sector.vertices,
      ...(sector.holes ?? []),
      ...(sector.details ?? []),
    ];
    if (loops.some((loop) => loop.some((id) => !vertexIds.has(id)))) continue;
    const corner = (id: string) => vertexIds.get(id) ?? id;
    const id = nextId("sector-", [
      ...map.sectors.map((item) => item.id),
      ...sectorIds.values(),
    ]);
    sectorIds.set(sector.id, id);
    const name = freeName(sector.name, names);
    names.add(name);
    const { tag, ...rest } = sector;
    const kept = tag === undefined ? 0 : (tags.get(tag) ?? tag);
    sectors.push({
      ...rest,
      id,
      name,
      vertices: sector.vertices.map(corner),
      ...(sector.holes
        ? { holes: sector.holes.map((hole) => hole.map(corner)) }
        : {}),
      ...(sector.details
        ? { details: sector.details.map((chain) => chain.map(corner)) }
        : {}),
      ...(sector.wallOverrides
        ? {
            wallOverrides: Object.fromEntries(
              Object.entries(sector.wallOverrides).flatMap(([key, texture]) => {
                const renamed = wall(key);
                return renamed ? [[renamed, texture]] : [];
              }),
            ),
          }
        : {}),
      ...(kept ? { tag: kept } : {}),
    });
  }

  const lines = { ...map.lines };
  for (const [key, line] of Object.entries(fragment.lines ?? {})) {
    const renamed = wall(key);
    if (!renamed) continue;
    const { sides, front, action, raw, ...rest } = line;
    // A raw special whose tag was dropped would act on every room with no
    // tag, so it goes with its tag.
    const special = raw && tags.get(raw.tag) === 0 ? undefined : raw;
    const face = front ? sectorIds.get(front) : undefined;
    const faces = Object.entries(sides ?? {}).flatMap(([id, side]) => {
      const owner = sectorIds.get(id);
      return owner ? [[owner, side] as const] : [];
    });
    lines[renamed] = {
      ...rest,
      ...(action
        ? { action: { ...action, tag: tags.get(action.tag) ?? action.tag } }
        : {}),
      ...(special
        ? { raw: { ...special, tag: tags.get(special.tag) ?? special.tag } }
        : {}),
      ...(face ? { front: face } : {}),
      ...(faces.length > 0 ? { sides: Object.fromEntries(faces) } : {}),
    };
  }

  const things = [...map.things];
  const thingKeys: string[] = [];
  for (const thing of fragment.things) {
    if (getIsPlayerStart(thing.kind)) continue;
    const id = nextId(
      `${thing.kind}-`,
      things.map((item) => item.id),
    );
    things.push({ ...thing, id, x: thing.x + shift.x, y: thing.y + shift.y });
    thingKeys.push(`${thingKeyPrefix}${id}`);
  }

  const switches = [...map.switches];
  for (const item of fragment.switches) {
    const sector = sectorIds.get(item.sector);
    const from = vertexIds.get(item.from);
    const to = vertexIds.get(item.to);
    if (!sector || !from || !to) continue;
    switches.push({
      ...item,
      id: nextId(
        "switch-",
        switches.map((entry) => entry.id),
      ),
      sector,
      from,
      to,
      door: (item.door && sectorIds.get(item.door)) || null,
    });
  }

  const pasted = mergeCorners(
    {
      ...map,
      vertices,
      sectors: [...map.sectors, ...sectors],
      things,
      switches,
      ...(Object.keys(lines).length > 0 ? { lines } : {}),
    },
    [...vertexIds.values()],
  );
  // A corner that joined one already there is selected under that one's id,
  // so every pasted room is still selected whole.
  const rooms = new Set(sectorIds.values());
  const loose = [...vertexIds.values()].filter((id) => pasted.vertices[id]);
  return {
    map: pasted,
    keys: [
      ...new Set([
        ...pasted.sectors
          .filter((sector) => rooms.has(sector.id))
          .flatMap(sectorVertices),
        ...loose,
      ]),
      ...thingKeys,
    ],
    sectors: [...rooms],
  };
}

// Turns, flips or resizes the corners and things behind the keys about their
// middle. A flip and a quarter turn keep every point on the grid, and other
// turns and resizes land on it. A resize carries joined doors along as `carry`
// says, and gives nothing when they can't all go.
export function transformParts(
  map: GameMap,
  keys: string[],
  transform: Transform,
  grid: number,
  carry: DoorCarry = "walls",
): GameMap | null {
  const positions = positionsOf(map);
  const moved = keys.filter((key) => positions[key]);
  if (moved.length === 0) return null;
  const box = boxOf(moved.map((key) => positions[key]));
  const middle = {
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2,
  };
  const quarters =
    transform.kind === "rotate" && transform.degrees % 90 === 0
      ? (((transform.degrees / 90) % 4) + 4) % 4
      : null;
  const pivot =
    quarters === null
      ? middle
      : turnPivot(
          moved.map((key) => positions[key]),
          grid,
        );
  // Adding zero turns a negative zero into a plain one.
  const land = (value: number) => snap(value, grid) + 0;
  const radians =
    transform.kind === "rotate" ? (transform.degrees * Math.PI) / 180 : 0;
  const place = ({ x, y }: Point): Point => {
    if (transform.kind === "mirror") {
      return transform.axis === "horizontal"
        ? { x: box.left + box.right - x, y }
        : { x, y: box.top + box.bottom - y };
    }
    let dx = x - pivot.x;
    let dy = y - pivot.y;
    if (transform.kind === "scale") {
      return {
        x: land(pivot.x + dx * transform.factor),
        y: land(pivot.y + dy * transform.factor),
      };
    }
    if (quarters === null) {
      return {
        x: land(pivot.x + dx * Math.cos(radians) - dy * Math.sin(radians)),
        y: land(pivot.y + dx * Math.sin(radians) + dy * Math.cos(radians)),
      };
    }
    for (let turn = 0; turn < quarters; turn += 1) [dx, dy] = [-dy, dx];
    return { x: pivot.x + dx + 0, y: pivot.y + dy + 0 };
  };
  const landed = Object.fromEntries(
    moved.map((key) => [key, place(positions[key])]),
  );
  const carried =
    transform.kind === "scale" && carry !== "none"
      ? carryDoors(map, landed, (id) =>
          carry === "walls"
            ? "straight"
            : carry === "doors"
              ? "bent"
              : carry.get(id),
        )
      : {};
  if (!carried) return null;
  const placed = applyPositions(map, { ...positions, ...landed, ...carried });
  const turned = new Set(moved);
  const corners = [...moved, ...Object.keys(carried)].filter(
    (key) => map.vertices[key],
  );
  const next: GameMap = {
    ...placed,
    things: placed.things.map((thing) => {
      if (!turned.has(`${thingKeyPrefix}${thing.id}`)) return thing;
      const angle = faceAfter(thing.angle, transform);
      return angle === thing.angle ? thing : { ...thing, angle };
    }),
    // A line drawn inside a room faces the right of the way it runs, so a
    // flipped one runs the other way to keep its face.
    sectors:
      transform.kind === "mirror"
        ? placed.sectors.map((sector) =>
            sector.details?.some((chain) => chain.every((id) => turned.has(id)))
              ? {
                  ...sector,
                  details: sector.details.map((chain) =>
                    chain.every((id) => turned.has(id))
                      ? chain.toReversed()
                      : chain,
                  ),
                }
              : sector,
          )
        : placed.sectors,
  };
  // A room squeezed until two of its corners meet has lost a wall.
  const flat = next.sectors.some((sector) => {
    const spots = sectorVertices(sector).map((id) => {
      const point = next.vertices[id];
      return `${point.x},${point.y}`;
    });
    return (
      sectorVertices(sector).some((id) => turned.has(id) || id in carried) &&
      new Set(spots).size !== new Set(sectorVertices(sector)).size
    );
  });
  if (flat) return null;
  const after = positionsOf(next);
  const changed =
    next.sectors !== placed.sectors ||
    next.things.some((thing, index) => thing !== placed.things[index]) ||
    moved.some(
      (key) =>
        positions[key].x !== after[key].x || positions[key].y !== after[key].y,
    );
  return changed ? mergeCorners(next, corners) : null;
}

// Each door in turn is carried with the far wall it meets kept straight, bent,
// or left behind to stretch, whichever adds the fewest new errors, then new
// warnings, even ones the map check hides while an error stands. `stranded`
// names the doors left behind, and `warnings` only the new ones it lists.
export function transformKeepingDoors(
  map: GameMap,
  keys: string[],
  steps: Transform[],
  grid: number,
  context?: CheckContext,
): {
  map: GameMap | null;
  problems: MapIssue[];
  warnings: MapIssue[];
  stranded: string[];
} {
  const newIssues = issuesSince(map, context);
  const run = (carry: DoorCarry) => {
    let next: GameMap | null = map;
    for (const step of steps) {
      next = next && transformParts(next, keys, step, grid, carry);
    }
    if (!next) return null;
    const { errors, warnings } = newIssues(next);
    return { map: next, problems: errors, warnings };
  };
  const rank = (result: ReturnType<typeof run>) =>
    result
      ? [result.problems.length, result.warnings.length]
      : [Infinity, Infinity];
  const better = (
    result: ReturnType<typeof run>,
    than: ReturnType<typeof run>,
  ) => {
    const [errors, warnings] = rank(result);
    const [fewestErrors, fewestWarnings] = rank(than);
    return (
      errors < fewestErrors ||
      (errors === fewestErrors && warnings < fewestWarnings)
    );
  };
  const carried = run("walls");
  const moved = Object.fromEntries(keys.map((key) => [key, map.vertices[key]]));
  const doors = steps.some((step) => step.kind === "scale")
    ? map.sectors
        .filter((sector) => sector.door && farFace(sector.vertices, moved))
        .map((sector) => sector.id)
    : [];
  const listed = (result: ReturnType<typeof run>) => {
    if (!result) return { map: null, problems: [], warnings: [] };
    const shown = new Set(
      inspectMap(result.map, context).warnings.map((issue) => issue.id),
    );
    return {
      ...result,
      warnings: result.warnings.filter((issue) => shown.has(issue.id)),
    };
  };
  if (
    doors.length === 0 ||
    (carried?.problems.length === 0 && carried.warnings.length === 0)
  ) {
    return { ...listed(carried), stranded: [] };
  }
  let plan = new Map<string, DoorMove>(doors.map((door) => [door, "straight"]));
  let best = carried;
  for (const door of doors) {
    for (const move of ["bent", "stays"] as const) {
      const next = new Map(plan);
      if (move === "bent") next.set(door, move);
      else next.delete(door);
      const tried = run(next);
      if (!better(tried, best)) continue;
      plan = next;
      best = tried;
    }
  }
  for (const fallback of [
    new Map(doors.map((door) => [door, "bent" as const])),
    new Map<string, DoorMove>(),
  ]) {
    if (best) break;
    best = run(fallback);
    plan = fallback;
  }
  return {
    ...listed(best),
    stranded: best ? doors.filter((door) => !plan.has(door)) : [],
  };
}

// `origin` names the map a piece was copied from, so a paste can tell its own
// map from another.
export function serializeFragment(fragment: GameMap, origin?: string) {
  return JSON.stringify({
    format: fragmentFormat,
    version: fragmentVersion,
    ...(origin ? { origin } : {}),
    map: fragment,
  });
}

// Text from the clipboard may be anything, so a piece is checked like a map
// file is.
export function parseFragment(text: string): CopiedPiece | null {
  if (text.length > maxFileBytes || !text.includes(fragmentFormat)) return null;
  try {
    const value = JSON.parse(text) as {
      format?: unknown;
      version?: unknown;
      origin?: unknown;
      map?: unknown;
    };
    if (value.format !== fragmentFormat || value.version !== fragmentVersion) {
      return null;
    }
    return {
      fragment: parseMap(value.map),
      origin: typeof value.origin === "string" ? value.origin : null,
    };
  } catch (error) {
    if (error instanceof MapFileError || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

// A door's far face keeps its offset from the corners the resize moved, so
// the door keeps its depth. The far room's wall in line with that face moves
// straight across with it and stays straight. A corner pulled two ways gives
// no result.
function carryDoors(
  map: GameMap,
  landed: Record<string, Point>,
  move: (door: string) => DoorMove | undefined,
): Record<string, Point> | null {
  const carried: Record<string, Point> = {};
  const doorCorners = new Set(
    map.sectors.flatMap((sector) => (sector.door ? sector.vertices : [])),
  );
  const put = (id: string, at: Point) => {
    const held = carried[id];
    if (held && (held.x !== at.x || held.y !== at.y)) return false;
    carried[id] = at;
    return true;
  };
  const corner = (id: string) => map.vertices[id];
  for (const door of map.sectors) {
    const how = door.door && move(door.id);
    if (!how) continue;
    const face = farFace(door.vertices, landed);
    if (!face) continue;
    const { chain, before, after } = face;
    const a = corner(chain[0]);
    const b = corner(chain[chain.length - 1]);
    const span = far(a, b);
    if (span === 0) continue;
    const follow = (id: string, near: string) => ({
      x: corner(id).x + landed[near].x - corner(near).x,
      y: corner(id).y + landed[near].y - corner(near).y,
    });
    const newA = follow(chain[0], before);
    const newB = follow(chain[chain.length - 1], after);
    for (const id of chain) {
      const point = corner(id);
      const t =
        ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / span;
      const at = {
        x: Math.round(newA.x + t * (newB.x - newA.x)),
        y: Math.round(newA.y + t * (newB.y - newA.y)),
      };
      if (!put(id, at)) return null;
    }
    const moveX = newA.x - a.x;
    const moveY = newA.y - a.y;
    const along = (moveX * (b.x - a.x) + moveY * (b.y - a.y)) / span;
    const across = {
      x: Math.round(moveX - along * (b.x - a.x)),
      y: Math.round(moveY - along * (b.y - a.y)),
    };
    if (how === "bent") continue;
    for (const end of [chain[0], chain[chain.length - 1]]) {
      for (const room of map.sectors) {
        if (room.door) continue;
        for (const loop of sectorLoops(room)) {
          const index = loop.indexOf(end);
          if (index < 0) continue;
          for (const step of [1, loop.length - 1]) {
            for (
              let at = (index + step) % loop.length, left = loop.length;
              left > 0 && !doorCorners.has(loop[at]) && !landed[loop[at]];
              at = (at + step) % loop.length, left -= 1
            ) {
              const point = corner(loop[at]);
              if (cross(a, b, point) !== 0) break;
              const shifted = { x: point.x + across.x, y: point.y + across.y };
              if (!put(loop[at], shifted)) return null;
            }
          }
        }
      }
    }
  }
  return carried;
}

// The door's corners the resize left behind, when they run in one unbroken
// chain between two it moved.
function farFace(outline: string[], landed: Record<string, Point>) {
  const count = outline.length;
  const starts = outline
    .map((_, index) => index)
    .filter(
      (index) =>
        !landed[outline[index]] && landed[outline[(index + count - 1) % count]],
    );
  if (starts.length !== 1) return null;
  const [start] = starts;
  const chain: string[] = [];
  for (let at = start; !landed[outline[at % count]]; at += 1) {
    chain.push(outline[at % count]);
  }
  if (chain.length < 2) return null;
  return {
    chain,
    before: outline[(start + count - 1) % count],
    after: outline[(start + chain.length) % count],
  };
}

// A quarter turn about a point of the half grid whose two steps add up to a
// whole one sends every grid point to a grid point. The pivot is the nearest
// such point to the middle, and of several as near, the one nearest the first
// thing moved, which turns with the rest and so picks the same pivot again.
function turnPivot(points: Point[], grid: number): Point {
  const box = boxOf(points);
  const middle = {
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2,
  };
  // A square turns onto itself about its own middle, on the grid or off it.
  // That is the pivot as long as it takes nothing off the grid.
  if (box.right - box.left === box.bottom - box.top) {
    const turned = points.map(({ x, y }) => ({
      x: middle.x + middle.y - y,
      y: middle.y - middle.x + x,
    }));
    if (gridCount(turned, grid) >= gridCount(points, grid)) return middle;
  }
  const half = grid / 2;
  const across = Math.floor(middle.x / half);
  const down = Math.floor(middle.y / half);
  const spots: { spot: Point; near: number; held: number }[] = [];
  for (let a = across - 1; a <= across + 2; a += 1) {
    for (let b = down - 1; b <= down + 2; b += 1) {
      if ((a + b) % 2 !== 0) continue;
      const spot = { x: a * half, y: b * half };
      spots.push({ spot, near: far(spot, middle), held: far(spot, points[0]) });
    }
  }
  spots.sort((one, other) => one.near - other.near || one.held - other.held);
  return spots[0].spot;
}

function gridCount(points: Point[], grid: number) {
  return points.filter(({ x, y }) => x % grid === 0 && y % grid === 0).length;
}

function far(from: Point, to: Point) {
  return (from.x - to.x) ** 2 + (from.y - to.y) ** 2;
}

const faceStep = 45;

// A thing faces one of eight ways, counted from east and turning left, so a
// turn to the right on the map takes its angle down.
function faceAfter(angle: number, transform: Transform) {
  if (transform.kind === "scale") return angle;
  const turned =
    transform.kind === "rotate"
      ? angle - transform.degrees
      : transform.axis === "horizontal"
        ? 180 - angle
        : -angle;
  const faced = Math.round(turned / faceStep) * faceStep;
  return ((faced % 360) + 360) % 360;
}

// A tag a copied line and room share is theirs alone, so in a map that uses
// it already the pair gets a new one. A tag with one of the two left behind
// still points there in its own map. In another map it would point at a
// stranger, so there it is dropped.
function pastedTags(map: GameMap, fragment: GameMap, own: boolean) {
  const used = new Set([...roomTags(map), ...lineTags(map)]);
  const rooms = new Set(roomTags(fragment));
  const wired = new Set(lineTags(fragment));
  const reserved = new Set([...used, ...rooms, ...wired]);
  const tags = new Map<number, number>();
  for (const tag of [...rooms, ...wired]) {
    if (!tag || tags.has(tag)) continue;
    if (!rooms.has(tag) || !wired.has(tag)) {
      if (!own) tags.set(tag, 0);
      continue;
    }
    if (!used.has(tag)) continue;
    let next = 1;
    while (reserved.has(next)) next += 1;
    reserved.add(next);
    tags.set(tag, next);
  }
  return tags;
}

function roomTags(map: GameMap) {
  return map.sectors.map((sector) => sector.tag);
}

function lineTags(map: GameMap) {
  return Object.values(map.lines ?? {}).map(
    (line) => line.action?.tag ?? line.raw?.tag,
  );
}

function freeName(name: string, taken: Set<string>) {
  if (!taken.has(name)) return name;
  const base = `${name} copy`;
  let next = base;
  for (let count = 2; taken.has(next); count += 1) next = `${base} ${count}`;
  return next;
}
