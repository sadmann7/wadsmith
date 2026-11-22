import type { Point } from "./types";

import { snapPoint } from "./edit";
import { signedArea } from "./geometry";

export type DrawShape =
  | "outline"
  | "rectangle"
  | "polygon"
  | "ellipse"
  | "grid";

// A grid of rooms makes cells about this big, so a drag decides how many.
export const gridCell = 128;

export const polygonSides = [3, 5, 6, 8, 12, 16, 24] as const;

// The corners of the room a shape makes between its two points, or null
// while they are too close. A rectangle, an ellipse and a grid of rooms (by
// its outline) run corner to corner; a polygon runs from its middle to a
// corner. Corners land on the grid.
export function shapeCorners(
  shape: DrawShape,
  sides: number,
  from: Point,
  to: Point,
  grid: number,
): Point[] | null {
  const corners =
    shape === "rectangle" || shape === "grid"
      ? [from, { x: to.x, y: from.y }, to, { x: from.x, y: to.y }]
      : shape === "ellipse"
        ? ellipseCorners(from, to, grid)
        : polygonCorners(from, to, sides, grid);
  const distinct = corners.filter(
    (point, index) =>
      !corners
        .slice(0, index)
        .some((other) => other.x === point.x && other.y === point.y),
  );
  return distinct.length >= 3 && signedArea(distinct) !== 0 ? distinct : null;
}

// The cells a grid of rooms splits its rectangle into, about a cell's size
// each and on the grid, row by row.
export function gridCells(from: Point, to: Point, grid: number): Point[][] {
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y, to.y);
  const columns = Math.max(1, Math.round((right - left) / gridCell));
  const rows = Math.max(1, Math.round((bottom - top) / gridCell));
  const cut = (start: number, end: number, parts: number, index: number) =>
    index === parts
      ? end
      : snapPoint({ x: start + ((end - start) * index) / parts, y: 0 }, grid).x;
  const xs = Array.from({ length: columns + 1 }, (_, index) =>
    cut(left, right, columns, index),
  );
  const ys = Array.from({ length: rows + 1 }, (_, index) =>
    cut(top, bottom, rows, index),
  );
  const cells: Point[][] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const [x0, x1, y0, y1] = [
        xs[column],
        xs[column + 1],
        ys[row],
        ys[row + 1],
      ];
      if (x0 === x1 || y0 === y1) continue;
      cells.push([
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ]);
    }
  }
  return cells;
}

const ellipseSides = 16;

function ellipseCorners(from: Point, to: Point, grid: number) {
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const wide = Math.abs(to.x - from.x) / 2;
  const tall = Math.abs(to.y - from.y) / 2;
  return Array.from({ length: ellipseSides }, (_, index) => {
    const turn = (index * 2 * Math.PI) / ellipseSides;
    const at = snapPoint(
      {
        x: middle.x + wide * Math.cos(turn),
        y: middle.y + tall * Math.sin(turn),
      },
      grid,
    );
    return { x: at.x + 0, y: at.y + 0 };
  });
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
