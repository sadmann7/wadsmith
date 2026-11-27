import type { Point } from "@/lib/map/types";

import type { Box } from "./fit-view";

const labelInset = 24;

interface LabelRoom {
  name: string;
  detail?: string;
  box: Box;
  at: Point & { isSmall?: boolean };
}

// Widths of 13px IBM Plex Sans Condensed, the name's font, by kind of letter.
const narrowLetters = /[ !'(),\-.1:;Iijlrt|]/;
const wideLetters = /[A-HJ-Zmw]/;

export function estimateLabelWidth(name: string, detail = "") {
  let nameWidth = 0;
  for (const letter of name) {
    if (narrowLetters.test(letter)) nameWidth += 3.6;
    else if (wideLetters.test(letter)) nameWidth += 8.6;
    else nameWidth += 6.6;
  }
  return Math.max(nameWidth, detail.length * 6.6) + 8;
}

// Callers pass the zoom step, which can run up to a fifth over the zoom, so
// screen sizes grow by this much to stay clear at any zoom in the step.
const stepSlack = 1.2;

// Screen distances from a thing's middle that a label keeps clear of: its
// icon's radius with a little air, plus half a two-line label's height.
const thingReach = 14 * stepSlack;
const labelHalfHeight = 16 * stepSlack;

// A name with no clear spot at full size is drawn this much smaller, as
// `.map-label[data-small]` does.
export const smallLabelScale = 0.75;

export interface LabelSpot extends Point {
  isSmall: boolean;
  isCovered: boolean;
}

// A label sits near the top of its room clear of pillars and things, lower
// down, or past the walls of a room narrower than the name. Failing that it
// tries again smaller, then stays small at the top, covered if an icon is
// drawn on it. Null means no part of the top band is in the room.
export function labelPoint(
  loops: Point[][],
  zoom: number,
  width: number,
  things: Point[] = [],
): LabelSpot | null {
  const [outline] = loops;
  if (!outline?.length) return null;
  const ys = outline.map((point) => point.y);
  const xs = outline.map((point) => point.x);
  const box = {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
  const top = box.top + labelInset / zoom;
  const bottom = box.bottom - labelInset / zoom;
  const middle = (box.top + box.bottom) / 2;
  const spill = ((width / 2) * stepSlack + thingReach) / zoom;
  const rise = (thingReach + labelHalfHeight) / zoom;
  const near = thingsIn(things, {
    left: box.left - spill,
    right: box.right + spill,
    top: box.top - rise,
    bottom: box.bottom + rise,
  });
  const step = (labelHalfHeight * 1.5) / zoom;
  const bands = (from: number, to: number) => {
    const levels = [from];
    if (near.length === 0) return levels;
    for (let y = from + step; y <= to; y += step) levels.push(y);
    return levels;
  };
  const inside = bands(top, bottom);
  const narrow = bands(Math.min(top, middle), Math.max(bottom, middle));
  for (const isSmall of near.length > 0 ? [false, true] : [false]) {
    const size = isSmall ? width * smallLabelScale : width;
    for (const y of inside) {
      const at = placeOnBand(loops, zoom, size, y, near, true);
      if (at) return { ...at, isSmall, isCovered: false };
    }
    for (const y of narrow) {
      const at = spillOnBand(loops, zoom, size, y, near);
      if (at) return { ...at, isSmall, isCovered: false };
    }
  }
  const at = placeOnBand(loops, zoom, width, top, [], false);
  if (!at) return null;
  return {
    ...at,
    isSmall: near.length > 0,
    isCovered: getIsUnderIcon(at, width * smallLabelScale, zoom, near),
  };
}

// Keeps the bigger room's label where two would overlap. The sizes are rough,
// from the text's length.
export function clearLabels<Room extends LabelRoom>(
  rooms: Room[],
  zoom: number,
) {
  const placed: Box[] = [];
  const kept = new Set(
    rooms
      .toSorted((a, b) => areaOf(b.box) - areaOf(a.box))
      .filter(({ name, detail, at }) => {
        const scale = (stepSlack / zoom) * (at.isSmall ? smallLabelScale : 1);
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
    width,
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

// A name wider than a room's span may hang past its walls, as long as no
// icon is under it. Not past a pillar's, which would cover the pillar.
function spillOnBand(
  loops: Point[][],
  zoom: number,
  width: number,
  y: number,
  things: Point[],
): Point | null {
  if (loops.length > 1) return null;
  const half = width / 2 / zoom;
  const reach = ((width / 2) * stepSlack + thingReach) / zoom;
  const rise = (thingReach + labelHalfHeight) / zoom;
  const blocking = things.filter((thing) => Math.abs(thing.y - y) < rise);
  let best: { x: number; off: number } | null = null;
  for (const [left, right] of spansAt(loops, y)) {
    if (right - left >= half * 2) continue;
    const home = (left + right) / 2;
    const clear = blocking.reduce(
      (current, thing) =>
        current.flatMap(([from, to]): [number, number][] =>
          [
            [from, Math.min(to, thing.x - reach)] as [number, number],
            [Math.max(from, thing.x + reach), to] as [number, number],
          ].filter(([start, end]) => start <= end),
        ),
      [[left, right]] as [number, number][],
    );
    for (const [from, to] of clear) {
      const x = Math.min(to, Math.max(from, home));
      const off = Math.abs(x - home);
      if (!best || off < best.off) best = { x, off };
    }
  }
  return best && { x: best.x, y };
}

function withoutThings(
  spans: [number, number][],
  things: Point[],
  y: number,
  zoom: number,
  width: number,
) {
  const reach = (thingReach + (width / 2) * (stepSlack - 1)) / zoom;
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

// Without the air and slack placement keeps, so a name is only hidden when
// an icon is drawn on it.
const iconRadius = 12;
const nameHalfHeight = 9;

function getIsUnderIcon(
  at: Point,
  width: number,
  zoom: number,
  things: Point[],
) {
  const across = (width / 2 + iconRadius) / zoom;
  const rise = (nameHalfHeight + iconRadius) / zoom;
  return things.some(
    (thing) =>
      Math.abs(thing.x - at.x) < across && Math.abs(thing.y - at.y) < rise,
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

// Things bucketed by a coarse grid, once per things list, so a room looks
// only at the things near it on a big map.
const thingBuckets = new WeakMap<Point[], Map<string, Point[]>>();

const thingCell = 256;

function thingsIn(things: Point[], box: Box) {
  let buckets = thingBuckets.get(things);
  if (!buckets) {
    buckets = new Map();
    for (const thing of things) {
      const key = `${Math.floor(thing.x / thingCell)},${Math.floor(thing.y / thingCell)}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(thing);
      else buckets.set(key, [thing]);
    }
    thingBuckets.set(things, buckets);
  }
  const found: Point[] = [];
  for (
    let column = Math.floor(box.left / thingCell);
    column <= Math.floor(box.right / thingCell);
    column += 1
  ) {
    for (
      let row = Math.floor(box.top / thingCell);
      row <= Math.floor(box.bottom / thingCell);
      row += 1
    ) {
      for (const thing of buckets.get(`${column},${row}`) ?? []) {
        if (
          thing.x >= box.left &&
          thing.x <= box.right &&
          thing.y >= box.top &&
          thing.y <= box.bottom
        ) {
          found.push(thing);
        }
      }
    }
  }
  return found;
}
