import type { Point } from "@/lib/map/types";

import type { Box } from "./fit-view";

const labelInset = 24;
const labelReach = 10;

interface LabelRoom {
  name: string;
  detail?: string;
  box: Box;
  at: Point;
}

export function estimateLabelWidth(name: string, detail = "") {
  return Math.max(name.length * 7.5, detail.length * 6.6) + 8;
}

// A label sits near the top of its room, on a part of that band the room
// covers and its pillars don't, so an L-shaped room doesn't label the room
// tucked into its corner. Null when no part of the band is clear.
export function labelPoint(
  loops: Point[][],
  zoom: number,
  width: number,
): Point | null {
  const [outline] = loops;
  if (!outline?.length) return null;
  const center = {
    x: outline.reduce((sum, point) => sum + point.x, 0) / outline.length,
  };
  const y = Math.min(...outline.map((point) => point.y)) + labelInset / zoom;
  const reach = labelReach / zoom;
  const spans = [y - reach, y, y + reach]
    .map((level) => spansAt(loops, level))
    .reduce(overlap);
  if (spans.length === 0) return null;
  const half = width / 2 / zoom;
  const fits = ([left, right]: [number, number]) => right - left >= half * 2;
  const home = spans.find(
    ([left, right]) => left <= center.x && center.x <= right,
  );
  if (home && fits(home)) {
    return {
      x: Math.min(home[1] - half, Math.max(home[0] + half, center.x)),
      y,
    };
  }
  const widest = spans.toSorted((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
  return home && !fits(widest)
    ? { x: center.x, y }
    : { x: (widest[0] + widest[1]) / 2, y };
}

// Keeps the bigger room's label where two would overlap. The sizes are rough,
// from the text's length, and the zoom step can run up to a fifth over the
// zoom, so they're scaled up to match.
export function clearLabels<Room extends LabelRoom>(
  rooms: Room[],
  zoom: number,
) {
  const scale = 1.2 / zoom;
  const placed: Box[] = [];
  const kept = new Set(
    rooms
      .toSorted((a, b) => areaOf(b.box) - areaOf(a.box))
      .filter(({ name, detail, at }) => {
        const halfWidth = (estimateLabelWidth(name, detail) / 2) * scale;
        const halfHeight = (detail ? 16 : 10) * scale;
        const label = {
          left: at.x - halfWidth,
          right: at.x + halfWidth,
          top: at.y - halfHeight,
          bottom: at.y + halfHeight,
        };
        if (
          placed.some(
            (other) =>
              label.left < other.right &&
              label.right > other.left &&
              label.top < other.bottom &&
              label.bottom > other.top,
          )
        ) {
          return false;
        }
        placed.push(label);
        return true;
      }),
  );
  return rooms.filter((room) => kept.has(room));
}

// The parts of a level line inside the outline and outside its holes, left
// to right.
function spansAt(loops: Point[][], y: number) {
  const crossings: number[] = [];
  for (const loop of loops) {
    loop.forEach((a, index) => {
      const b = loop[(index + 1) % loop.length];
      if (a.y <= y !== b.y <= y) {
        crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    });
  }
  crossings.sort((left, right) => left - right);
  const spans: [number, number][] = [];
  for (let index = 0; index + 1 < crossings.length; index += 2) {
    spans.push([crossings[index], crossings[index + 1]]);
  }
  return spans;
}

function overlap(a: [number, number][], b: [number, number][]) {
  return a.flatMap(([left, right]) =>
    b
      .map(([from, to]): [number, number] => [
        Math.max(left, from),
        Math.min(right, to),
      ])
      .filter(([from, to]) => from < to),
  );
}

function areaOf(box: Box) {
  return (box.right - box.left) * (box.bottom - box.top);
}
