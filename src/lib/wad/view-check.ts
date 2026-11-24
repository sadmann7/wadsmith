import type { CheckedIssue } from "@/lib/map/checks";
import type { GameMap } from "@/lib/map/types";

import { sectorAt } from "@/lib/map/geometry";

import type { Lump } from "./compile";
import type { ViewCounts } from "./vanilla-view";

import {
  countView,
  drawsegLimit,
  openingLimit,
  readLevel,
  solidsegLimit,
  visplaneLimit,
  vispriteLimit,
} from "./vanilla-view";

const playerHeight = 56;
const minSpacing = 64;
const maxPoints = 5000;
const directions = 8;
const reported = 5;
const refined = 12;
const ang45 = 0x20000000;
const facings = [
  "east",
  "northeast",
  "north",
  "northwest",
  "west",
  "southwest",
  "south",
  "southeast",
];

const kinds = [
  {
    key: "visplanes",
    limit: visplaneLimit,
    message: "Too many visplanes for vanilla Doom",
    outcome: "Vanilla Doom quits when it draws this view.",
  },
  {
    key: "drawsegs",
    limit: drawsegLimit,
    message: "Too many wall pieces in view for vanilla Doom",
    outcome: "Walls and sprites past the limit go missing.",
  },
  {
    key: "solidsegs",
    limit: solidsegLimit,
    message: "Too many gaps between walls in view for vanilla Doom",
    outcome: "Vanilla Doom writes past its table and may crash.",
  },
  {
    key: "openings",
    limit: openingLimit,
    message: "Too many see-through walls and ledges in view for vanilla Doom",
    outcome:
      "Vanilla Doom writes past its openings table, which can crash it or corrupt the view.",
  },
  {
    key: "vissprites",
    limit: vispriteLimit,
    message: "Too many sprites in view for vanilla Doom",
    outcome: "Sprites past the limit vanish.",
  },
] as const;

type Kind = (typeof kinds)[number]["key"];

interface Spot {
  x: number;
  y: number;
  angle: number;
  sector: string;
  count: number;
}

// Looks from a grid of spots a player could stand on, in eight directions,
// then turns and steps around the views closest to each of the renderer's
// fixed limits, and reports the rooms with the worst views past them.
export function checkViews(map: GameMap, lumps: Lump[]): CheckedIssue[] {
  const level = readLevel(lumps);
  const points = Object.values(map.vertices);
  if (points.length === 0 || level.segs.length === 0) return [];
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));
  const spacing = Math.max(
    minSpacing,
    Math.ceil(
      Math.sqrt(((right - left) * (bottom - top)) / maxPoints) / minSpacing,
    ) * minSpacing,
  );
  const worst = new Map<Kind, Map<string, Spot>>(
    kinds.map((kind) => [kind.key, new Map()]),
  );
  const closest = new Map<Kind, Map<string, Spot>>(
    kinds.map((kind) => [kind.key, new Map()]),
  );

  const standAt = (x: number, y: number) => {
    const sector = sectorAt(map, { x, y });
    return !sector ||
      sector.door ||
      sector.ceiling - sector.floor < playerHeight
      ? null
      : sector;
  };
  const look = (
    x: number,
    y: number,
    angle: number,
    sector = standAt(x, y),
  ) => {
    if (!sector) return null;
    const counts = countView(level, x, -y, sector.floor, angle);
    for (const kind of kinds) {
      const count = counts[kind.key];
      const spot = { x, y, angle, sector: sector.id, count };
      keep(closest.get(kind.key), spot, kind.limit / 2);
      keep(worst.get(kind.key), spot, kind.limit);
    }
    return counts;
  };

  for (let y = top + spacing / 2; y < bottom; y += spacing) {
    for (let x = left + spacing / 2; x < right; x += spacing) {
      const sector = standAt(x, y);
      if (!sector) continue;
      for (let direction = 0; direction < directions; direction += 1) {
        look(x, y, (direction * ang45) >>> 0, sector);
      }
    }
  }

  for (const kind of kinds) {
    const starts = [...(closest.get(kind.key)?.values() ?? [])]
      .toSorted((a, b) => b.count - a.count)
      .slice(0, refined);
    for (const start of starts) refine(start, kind.key, spacing, look);
  }

  const names = new Map(map.sectors.map((sector) => [sector.id, sector.name]));
  return kinds.flatMap((kind) =>
    [...(worst.get(kind.key)?.values() ?? [])]
      .toSorted((a, b) => b.count - a.count)
      .slice(0, reported)
      .map((spot) => {
        const degrees = (spot.angle / 0x100000000) * 360;
        return {
          id: `vanilla-${kind.key}:${spot.sector}`,
          severity: "warning" as const,
          message: kind.message,
          detail: `${names.get(spot.sector)}: ${spot.count} of ${kind.limit} facing ${facings[Math.round(degrees / 45) % 8]}. ${kind.outcome}`,
          target: spot.sector,
          view: { x: spot.x, y: spot.y, angle: Math.round(degrees * 10) / 10 },
        };
      }),
  );
}

function keep(spots: Map<string, Spot> | undefined, spot: Spot, past: number) {
  const known = spots?.get(spot.sector);
  if (spot.count > past && spot.count > (known?.count ?? 0)) {
    spots?.set(spot.sector, spot);
  }
}

// After the angles halfway between the eight directions, each step turns the
// view or moves the spot from the best view found so far, and keeps whichever
// neighbour fills more.
const steps = [
  { turn: 0, move: 1 / 2 },
  { turn: ang45 / 4, move: 0 },
  { turn: 0, move: 1 / 4 },
  { turn: ang45 / 8, move: 0 },
  { turn: ang45 / 16, move: 0 },
];

function refine(
  start: Spot,
  kind: Kind,
  spacing: number,
  look: (x: number, y: number, angle: number) => ViewCounts | null,
) {
  let best = start;
  for (let direction = 0; direction < directions; direction += 1) {
    const angle = (start.angle + ang45 / 2 + direction * ang45) >>> 0;
    const count = look(start.x, start.y, angle)?.[kind];
    if (count !== undefined && count > best.count) {
      best = { ...start, angle, count };
    }
  }
  for (const { turn, move } of steps) {
    const offset = move * spacing;
    const tries = turn
      ? [
          { x: best.x, y: best.y, angle: (best.angle + turn) >>> 0 },
          { x: best.x, y: best.y, angle: (best.angle - turn) >>> 0 },
        ]
      : [
          { x: best.x + offset, y: best.y, angle: best.angle },
          { x: best.x - offset, y: best.y, angle: best.angle },
          { x: best.x, y: best.y + offset, angle: best.angle },
          { x: best.x, y: best.y - offset, angle: best.angle },
        ];
    let next = best;
    for (const view of tries) {
      const count = look(view.x, view.y, view.angle)?.[kind];
      if (count !== undefined && count > next.count) {
        next = { ...view, sector: best.sector, count };
      }
    }
    best = next;
  }
}
