import type { Point } from "@/lib/map/types";

import type { Box } from "./fit-view";

const labelInset = 24;

interface LabelRoom {
  name: string;
  detail?: string;
  box: Box;
  at: Point;
}

export function estimateLabelWidth(name: string, detail = "") {
  return Math.max(name.length * 7.5, detail.length * 6.6) + 8;
}

// Screen distances from a thing's middle that a label keeps clear of: its
// icon's radius with a little air, plus half a two-line label's height.
const thingReach = 14;
const labelHalfHeight = 16;

// A label sits near the top of its room, clear of pillars and things, or
// lower down when the top has no clear spot. A room with none keeps its name
// at the top, since moving it aside would crowd out a neighbour's. Null means
// no part of the top band is in the room.
export function labelPoint(
  loops: Point[][],
  zoom: number,
  width: number,
  things: Point[] = [],
): Point | null {
  const [outline] = loops;
  if (!outline?.length) return null;
  const ys = outline.map((point) => point.y);
  const xs = outline.map((point) => point.x);
  const top = Math.min(...ys) + labelInset / zoom;
  const bottom = Math.max(...ys) - labelInset / zoom;
  const near = things.filter(
    (thing) =>
      thing.x >= Math.min(...xs) &&
      thing.x <= Math.max(...xs) &&
      thing.y >= Math.min(...ys) &&
      thing.y <= Math.max(...ys),
  );
  const step = (labelHalfHeight * 1.5) / zoom;
  for (let y = top; y === top || (near.length > 0 && y <= bottom); y += step) {
    const at = placeOnBand(loops, zoom, width, y, near, true);
    if (at) return at;
  }
  return placeOnBand(loops, zoom, width, top, [], false);
}

// Whether a thing's icon would sit on a label placed there.
export function getIsLabelCovered(
  at: Point,
  width: number,
  zoom: number,
  things: Point[],
) {
  return coveredWidth(at, width, zoom, things) > 0;
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

const labelReach = 10;

function placeOnBand(
  loops: Point[][],
  zoom: number,
  width: number,
  y: number,
  things: Point[],
  isStrict: boolean,
): Point | null {
  const [outline] = loops;
  const center = {
    x: outline.reduce((sum, point) => sum + point.x, 0) / outline.length,
  };
  const reach = labelReach / zoom;
  const spans = withoutThings(
    [y - reach, y, y + reach]
      .map((level) => spansAt(loops, level))
      .reduce(overlap),
    things,
    y,
    zoom,
  );
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
  if (fits(widest)) return { x: (widest[0] + widest[1]) / 2, y };
  if (isStrict || loops.length > 1 || !home) return null;
  return { x: center.x, y };
}

function withoutThings(
  spans: [number, number][],
  things: Point[],
  y: number,
  zoom: number,
) {
  const reach = thingReach / zoom;
  const rise = (thingReach + labelHalfHeight) / zoom;
  return things
    .filter((thing) => Math.abs(thing.y - y) < rise)
    .reduce(
      (current, thing) =>
        current.flatMap(([left, right]): [number, number][] =>
          [
            [left, Math.min(right, thing.x - reach)] as [number, number],
            [Math.max(left, thing.x + reach), right] as [number, number],
          ].filter(([from, to]) => from < to),
        ),
      spans,
    );
}

function coveredWidth(at: Point, width: number, zoom: number, things: Point[]) {
  const half = width / 2 / zoom;
  const reach = thingReach / zoom;
  const rise = (thingReach + labelHalfHeight) / zoom;
  return things
    .filter((thing) => Math.abs(thing.y - at.y) < rise)
    .reduce(
      (sum, thing) =>
        sum +
        Math.max(
          0,
          Math.min(at.x + half, thing.x + reach) -
            Math.max(at.x - half, thing.x - reach),
        ),
      0,
    );
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
