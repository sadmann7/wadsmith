import type { Point } from "./types";

import { snapPoint } from "./edit";
import { signedArea } from "./geometry";

export type DrawShape = "outline" | "rectangle" | "polygon";

export const polygonSides = [3, 5, 6, 8, 12, 16, 24] as const;

// The corners of the room a shape makes from its first point to its second,
// or null while the two are too close to make one. A rectangle runs corner to
// corner. A polygon has its middle at the first point and a corner at the
// second, and its corners land on the grid.
export function shapeCorners(
  shape: DrawShape,
  sides: number,
  from: Point,
  to: Point,
  grid: number,
): Point[] | null {
  const corners =
    shape === "rectangle"
      ? [from, { x: to.x, y: from.y }, to, { x: from.x, y: to.y }]
      : polygonCorners(from, to, sides, grid);
  const distinct = corners.filter(
    (point, index) =>
      !corners
        .slice(0, index)
        .some((other) => other.x === point.x && other.y === point.y),
  );
  return distinct.length >= 3 && signedArea(distinct) !== 0 ? distinct : null;
}

function polygonCorners(
  middle: Point,
  corner: Point,
  sides: number,
  grid: number,
) {
  const radius = Math.hypot(corner.x - middle.x, corner.y - middle.y);
  const start = Math.atan2(corner.y - middle.y, corner.x - middle.x);
  return Array.from({ length: sides }, (_, index) => {
    const turn = start + (index * 2 * Math.PI) / sides;
    const at = snapPoint(
      {
        x: middle.x + radius * Math.cos(turn),
        y: middle.y + radius * Math.sin(turn),
      },
      grid,
    );
    // Adding zero turns a negative zero into a plain one.
    return { x: at.x + 0, y: at.y + 0 };
  });
}
