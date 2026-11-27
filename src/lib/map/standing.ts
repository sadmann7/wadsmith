import type { GameMap, Point, Sector } from "./types";

import { getBlocksPlayer } from "./complevel";
import { sectorAt, wallOwners } from "./geometry";

// In a sharp corner each wall pushes the spot back toward the other, so the
// two close in on a clear spot over many passes.
const passes = 96;

// The nearest spot to a point where a player has room to stand and walk off,
// or null when there is none close by. A player that starts with a wall
// through its box can't move.
export function standingSpot(map: GameMap, point: Point): Point | null {
  let spot = point;
  for (let pass = 0; pass < passes; pass += 1) {
    const room = sectorAt(map, spot);
    if (!room || room.door) return null;
    if (room.ceiling - room.floor < playerHeight) return null;
    const pushed = pushOff(map, spot, room.floor);
    if (pushed === spot) {
      return { x: Math.round(spot.x), y: Math.round(spot.y) };
    }
    spot = pushed;
  }
  return null;
}

// Where a player walking from one spot toward another ends up: there, or as
// far along one axis as the walls let it slide, or where it stood. A player
// caught in a wall, by flying or a door shutting on it, only moves to free
// itself.
export function walkStep(map: GameMap, from: Point, to: Point): Point {
  const room = sectorAt(map, from);
  if (!room) return sectorAt(map, to) ? to : from;
  const floor = standingFloor(map, from, room.floor);
  const caught = overlap(map, from, floor);
  for (const next of [to, { x: to.x, y: from.y }, { x: from.x, y: to.y }]) {
    if (next.x === from.x && next.y === from.y) continue;
    if (!sectorAt(map, next)) continue;
    const reach = overlap(map, next, floor);
    if (reach === 0 || reach < caught) return next;
  }
  return from;
}

// A player is a box this far across from its middle, this tall, and climbs a
// step this high.
const playerRadius = 16;

// Kept between the box and a wall, so rounding the spot can't close the gap.
const margin = 1;
// A push lands a hair short of its mark in floating point, which is close
// enough and no reason to push again.
const settled = 1e-6;

// The spot moved clear of every wall that would stop a player standing on
// the floor, or the same spot when none is in the way.
function pushOff(map: GameMap, spot: Point, floor: number) {
  let next = spot;
  for (const [key, owners] of wallOwners(map)) {
    if (
      !getBlocksPlayer(map, map.lines?.[key]) &&
      !getIsBlocking(owners, floor)
    ) {
      continue;
    }
    const [a, b] = key.split("|").map((id) => map.vertices[id]);
    if (!a || !b) continue;
    const near = nearestOn(a, b, next);
    const dx = next.x - near.x;
    const dy = next.y - near.y;
    const distance = Math.hypot(dx, dy);
    // A point right on a wall has no side to leave by.
    if (distance === 0) return { x: Number.NaN, y: Number.NaN };
    // How far the box reaches toward the wall, which is further at an angle.
    const reach =
      (playerRadius * (Math.abs(dx) + Math.abs(dy))) / distance + margin;
    if (distance + settled >= reach) continue;
    const scale = reach / distance;
    next = { x: near.x + dx * scale, y: near.y + dy * scale };
  }
  return next;
}

// A player stands on the highest floor its box is over that it could have
// stepped up to, so it climbs stairs narrower than itself and stays up at a
// ledge's edge, but a camera set down at a ledge's foot stays at the foot.
function standingFloor(map: GameMap, spot: Point, floor: number) {
  const floors = [...touching(map, spot)].flatMap(({ key, owners }) =>
    owners.length < 2 || getBlocksPlayer(map, map.lines?.[key])
      ? []
      : owners.map((owner) => owner.floor),
  );
  let highest = floor;
  for (const level of floors.toSorted((a, b) => a - b)) {
    if (level > highest && level - highest <= maxStep) highest = level;
  }
  return highest;
}

// How deep the walls that stop a player standing on `floor` reach into its
// box at a spot, all told, which is 0 where it fits.
function overlap(map: GameMap, spot: Point, floor: number) {
  let depth = 0;
  for (const wall of touching(map, spot)) {
    if (getIsWalkBlocking(map, wall.key, wall.owners, floor)) {
      depth += wall.depth;
    }
  }
  return depth;
}

// The walls whose line reaches into a player's box at a spot, with how far.
function* touching(map: GameMap, spot: Point) {
  const { cells, wide } = wallIndex(map);
  const cell = `${Math.floor(spot.x / cellSize)},${Math.floor(spot.y / cellSize)}`;
  for (const { key, owners, a, b } of inMapOrder(cells.get(cell) ?? [], wide)) {
    const near = nearestOn(a, b, spot);
    const reach = Math.max(
      Math.abs(spot.x - near.x),
      Math.abs(spot.y - near.y),
    );
    if (reach < playerRadius) {
      yield { key, owners, depth: playerRadius - reach };
    }
  }
}

interface IndexedWall {
  order: number;
  key: string;
  owners: Sector[];
  a: Point;
  b: Point;
}

interface WallIndex {
  cells: Map<string, IndexedWall[]>;
  wide: IndexedWall[];
}

const cellSize = 128;
const maxCells = 1024;
const wallIndexes = new WeakMap<GameMap, WallIndex>();

// Each wall is filed under every cell its box, grown by a player's reach,
// covers, so a spot only looks at the walls of its own cell. A long diagonal
// wall would fill too many cells, so it is looked at from every spot instead.
function wallIndex(map: GameMap) {
  const cached = wallIndexes.get(map);
  if (cached) return cached;
  const index: WallIndex = { cells: new Map(), wide: [] };
  let order = 0;
  for (const [key, owners] of wallOwners(map)) {
    const [a, b] = key.split("|").map((id) => map.vertices[id]);
    if (!a || !b) continue;
    const wall = { order: order++, key, owners, a, b };
    const left = Math.floor((Math.min(a.x, b.x) - playerRadius) / cellSize);
    const right = Math.floor((Math.max(a.x, b.x) + playerRadius) / cellSize);
    const top = Math.floor((Math.min(a.y, b.y) - playerRadius) / cellSize);
    const bottom = Math.floor((Math.max(a.y, b.y) + playerRadius) / cellSize);
    if (!((right - left + 1) * (bottom - top + 1) <= maxCells)) {
      index.wide.push(wall);
      continue;
    }
    for (let x = left; x <= right; x += 1) {
      for (let y = top; y <= bottom; y += 1) {
        const cell = `${x},${y}`;
        const walls = index.cells.get(cell);
        if (walls) walls.push(wall);
        else index.cells.set(cell, [wall]);
      }
    }
  }
  wallIndexes.set(map, index);
  return index;
}

// Depths add up in map order, as they did when every wall was looked at, so
// the sums come out the same to the last bit.
function* inMapOrder(near: IndexedWall[], wide: IndexedWall[]) {
  let i = 0;
  let j = 0;
  while (i < near.length || j < wide.length) {
    if (
      j >= wide.length ||
      (i < near.length && near[i].order < wide[j].order)
    ) {
      yield near[i++];
    } else {
      yield wide[j++];
    }
  }
}

// Walking goes where the game would let a player: a door counts by how far it
// stands open, not as a wall.
function getIsWalkBlocking(
  map: GameMap,
  key: string,
  owners: Sector[],
  floor: number,
) {
  if (getBlocksPlayer(map, map.lines?.[key])) return true;
  const [front, back] = owners;
  if (!back) return true;
  if (front === back) return false;
  const top = Math.max(front.floor, back.floor);
  const headroom = Math.min(front.ceiling, back.ceiling) - top;
  return top - floor > maxStep || headroom < playerHeight;
}

const playerHeight = 56;
const maxStep = 24;

// A wall with nothing behind it stops a player, and so does one onto a door
// or a room too high to step up to or too low to fit under. A line set to
// block everything does too, whatever is behind it.
function getIsBlocking(owners: Sector[], floor: number) {
  const [front, back] = owners;
  if (!back) return true;
  if (front === back) return false;
  if (front.door || back.door) return true;
  const top = Math.max(front.floor, back.floor);
  const headroom = Math.min(front.ceiling, back.ceiling) - top;
  return top - floor > maxStep || headroom < playerHeight;
}

function nearestOn(a: Point, b: Point, point: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const along =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length),
        );
  return { x: a.x + dx * along, y: a.y + dy * along };
}
