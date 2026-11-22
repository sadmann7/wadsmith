import type { GameMap, Point, Sector } from "./types";

import { sectorAt, wallOwners } from "./geometry";

const passes = 8;

// The nearest spot to a point where a player has room to stand and walk off,
// or null when there is none close by. A player that starts with a wall
// through its box can't move.
export function standingSpot(map: GameMap, point: Point): Point | null {
  let spot = point;
  for (let pass = 0; pass < passes; pass += 1) {
    const room = sectorAt(map, spot);
    if (!room || room.door) return null;
    const pushed = pushOff(map, spot, room.floor);
    if (pushed === spot) {
      return { x: Math.round(spot.x), y: Math.round(spot.y) };
    }
    spot = pushed;
  }
  return null;
}

// A player is a box this far across from its middle, this tall, and climbs a
// step this high.
const playerRadius = 16;

// Kept between the box and a wall, so rounding the spot can't close the gap.
const margin = 1;

// The spot moved clear of every wall that would stop a player standing on
// the floor, or the same spot when none is in the way.
function pushOff(map: GameMap, spot: Point, floor: number) {
  let next = spot;
  for (const [key, owners] of wallOwners(map)) {
    if (!getIsBlocking(owners, floor)) continue;
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
    if (distance >= reach) continue;
    const scale = reach / distance;
    next = { x: near.x + dx * scale, y: near.y + dy * scale };
  }
  return next;
}

const playerHeight = 56;
const maxStep = 24;

// A wall with nothing behind it stops a player, and so does one onto a door
// or a room too high to step up to or too low to fit under.
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
