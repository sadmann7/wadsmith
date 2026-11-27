import type { CustomThings } from "@/lib/wad/custom-things";

import type { GameMap, Point, Thing, ThingKind } from "./types";

import { thingCatalog } from "./catalog";
import { getBlocksPlayer } from "./complevel";
import { vanillaThings } from "./doom-info";
import { wallOwners } from "./geometry";

const cellSize = 256;

const cellOf = (value: number) => Math.floor(value / cellSize);

interface Body {
  thing: Thing;
  radius: number;
  isPlayer: boolean;
  moves: boolean;
}

// Monsters and players whose box overlaps another solid thing's, or that a
// wall blocking them runs through. Doom moves a thing only to a spot clear of
// both, so it stays put. Scenery never moves, and things on different
// difficulties never meet.
export function findStuckThings(map: GameMap, custom: CustomThings) {
  const bodies = map.things.flatMap((thing) => bodyOf(thing, custom) ?? []);
  const cells = new Map<string, Body[]>();
  for (const body of bodies) {
    const key = `${cellOf(body.thing.x)},${cellOf(body.thing.y)}`;
    cells.set(key, [...(cells.get(key) ?? []), body]);
  }
  const overlaps: [Thing, Thing][] = [];
  const paired = new Set<Thing>();
  for (const body of bodies) {
    if (!body.moves || paired.has(body.thing)) continue;
    const cx = cellOf(body.thing.x);
    const cy = cellOf(body.thing.y);
    const other = [-1, 0, 1]
      .flatMap((dx) =>
        [-1, 0, 1].flatMap((dy) => cells.get(`${cx + dx},${cy + dy}`) ?? []),
      )
      .find(
        (near) =>
          near !== body &&
          !paired.has(near.thing) &&
          getOverlap(body, near) &&
          getShareSkill(body.thing, near.thing),
      );
    if (!other) continue;
    paired.add(body.thing);
    paired.add(other.thing);
    overlaps.push([body.thing, other.thing]);
  }
  const walls: { thing: Thing; wall: string }[] = [];
  const stuck = new Set<Thing>(paired);
  for (const [wall, owners] of wallOwners(map)) {
    const line = map.lines?.[wall];
    const oneSided = owners.length < 2;
    const blocksPlayers = oneSided || getBlocksPlayer(map, line);
    const blocksEnemies = blocksPlayers || Boolean(line?.blocksEnemies);
    if (!blocksEnemies) continue;
    const [a, b] = wall.split("|").map((id) => map.vertices[id]);
    if (!a || !b) continue;
    for (
      let x = cellOf(Math.min(a.x, b.x)) - 1;
      x <= cellOf(Math.max(a.x, b.x)) + 1;
      x += 1
    ) {
      for (
        let y = cellOf(Math.min(a.y, b.y)) - 1;
        y <= cellOf(Math.max(a.y, b.y)) + 1;
        y += 1
      ) {
        for (const body of cells.get(`${x},${y}`) ?? []) {
          if (!body.moves || stuck.has(body.thing)) continue;
          if (body.isPlayer ? !blocksPlayers : !blocksEnemies) continue;
          if (!getCrossesBox(a, b, body.thing, body.radius)) continue;
          stuck.add(body.thing);
          walls.push({ thing: body.thing, wall });
        }
      }
    }
  }
  return { overlaps, walls };
}

const radii = new Map(
  vanillaThings
    .filter(([type]) => type > 0)
    .map(([type, , radius]) => [type, radius]),
);

// The scenery Doom makes solid. Corpses, pools, candles and hanging bodies
// marked as passable are left out, since nothing bumps into them.
const solidScenery = new Set([
  25, 26, 27, 28, 29, 30, 31, 32, 33, 35, 36, 37, 41, 42, 43, 44, 45, 46, 47,
  48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 70, 72, 73, 74, 75, 76, 77, 78, 85,
  86, 2028, 2035,
]);

// Commander Keen hangs from the ceiling and the boss brain sits in its wall,
// so neither ever moves.
const stillEnemies = new Set([72, 88]);

const playerRadius = 16;

const starts = new Set<ThingKind>([
  "player",
  "player-2",
  "player-3",
  "player-4",
]);

function bodyOf(thing: Thing, custom: CustomThings): Body | null {
  const isPlayer = starts.has(thing.kind);
  if (thing.kind === "custom") {
    const patched = custom.get(thing.type ?? 0);
    return patched?.category === "enemy"
      ? { thing, radius: patched.radius, isPlayer, moves: true }
      : null;
  }
  const { doomType, category } = thingCatalog[thing.kind];
  if (!isPlayer && category !== "enemy" && !solidScenery.has(doomType)) {
    return null;
  }
  const radius = isPlayer
    ? playerRadius
    : (custom.get(doomType)?.radius ?? radii.get(doomType));
  return radius
    ? {
        thing,
        radius,
        isPlayer,
        moves:
          isPlayer || (category === "enemy" && !stillEnemies.has(doomType)),
      }
    : null;
}

const allSkills = ["easy", "medium", "hard"] as const;

function getShareSkill(a: Thing, b: Thing) {
  return allSkills.some(
    (skill) =>
      (!a.skills || a.skills.includes(skill)) &&
      (!b.skills || b.skills.includes(skill)),
  );
}

function getOverlap(a: Body, b: Body) {
  const reach = a.radius + b.radius;
  return (
    Math.abs(a.thing.x - b.thing.x) < reach &&
    Math.abs(a.thing.y - b.thing.y) < reach
  );
}

// Whether the wall passes through the inside of the square a thing takes up,
// not just along its edge.
function getCrossesBox(a: Point, b: Point, center: Point, radius: number) {
  let enter = 0;
  let leave = 1;
  for (const [start, delta, middle] of [
    [a.x, b.x - a.x, center.x],
    [a.y, b.y - a.y, center.y],
  ]) {
    const low = middle - radius;
    const high = middle + radius;
    if (delta === 0) {
      if (start <= low || start >= high) return false;
      continue;
    }
    const first = (low - start) / delta;
    const second = (high - start) / delta;
    enter = Math.max(enter, Math.min(first, second));
    leave = Math.min(leave, Math.max(first, second));
  }
  return enter < leave;
}
