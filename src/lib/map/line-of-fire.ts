import type { Point, Thing } from "./types";

const fireReach = 1024;
const playerRadius = 16;

// Which way an angle faces on the map. Editor y runs down, so y flips.
export function facingOf(angle: number): Point {
  const radians = (angle * Math.PI) / 180;
  return { x: Math.cos(radians), y: -Math.sin(radians) };
}

// Whether a shot from a thing standing at `from` hits a player at `at`. A
// shot's spread widens with distance, so the lane does too.
export function getIsInLineOfFire(
  from: Pick<Thing, "x" | "y" | "angle">,
  at: Point,
) {
  const facing = facingOf(from.angle);
  const x = at.x - from.x;
  const y = at.y - from.y;
  const along = x * facing.x + y * facing.y;
  const across = Math.abs(x * facing.y - y * facing.x);
  return along > 0 && along <= fireReach && across < playerRadius + along / 8;
}
