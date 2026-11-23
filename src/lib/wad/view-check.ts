import type { CheckedIssue } from "@/lib/map/checks";
import type { GameMap } from "@/lib/map/types";

import { sectorAt } from "@/lib/map/geometry";

import type { Lump } from "./compile";

import {
  countView,
  drawsegLimit,
  readLevel,
  solidsegLimit,
  visplaneLimit,
} from "./vanilla-view";

const playerHeight = 56;
const minSpacing = 64;
const maxPoints = 5000;
const directions = 8;
const reported = 5;
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
] as const;

interface Spot {
  x: number;
  y: number;
  direction: number;
  sector: string;
  count: number;
}

// Looks from a grid of spots a player could stand on, in eight directions,
// and reports the rooms with the worst views past each of the renderer's
// fixed limits.
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
  const worst = new Map<string, Map<string, Spot>>(
    kinds.map((kind) => [kind.key, new Map()]),
  );
  for (let y = top + spacing / 2; y < bottom; y += spacing) {
    for (let x = left + spacing / 2; x < right; x += spacing) {
      const sector = sectorAt(map, { x, y });
      if (
        !sector ||
        sector.door ||
        sector.ceiling - sector.floor < playerHeight
      ) {
        continue;
      }
      for (let direction = 0; direction < directions; direction += 1) {
        const counts = countView(
          level,
          x,
          -y,
          sector.floor,
          (direction * 0x20000000) >>> 0,
        );
        for (const kind of kinds) {
          const count = counts[kind.key];
          const known = worst.get(kind.key)?.get(sector.id);
          if (count > kind.limit && count > (known?.count ?? 0)) {
            worst
              .get(kind.key)
              ?.set(sector.id, { x, y, direction, sector: sector.id, count });
          }
        }
      }
    }
  }
  const names = new Map(map.sectors.map((sector) => [sector.id, sector.name]));
  return kinds.flatMap((kind) =>
    [...(worst.get(kind.key)?.values() ?? [])]
      .toSorted((a, b) => b.count - a.count)
      .slice(0, reported)
      .map((spot) => ({
        id: `vanilla-${kind.key}:${spot.sector}`,
        severity: "warning" as const,
        message: kind.message,
        detail: `${names.get(spot.sector)}: ${spot.count} of ${kind.limit} facing ${facings[spot.direction]}. ${kind.outcome}`,
        target: spot.sector,
        view: { x: spot.x, y: spot.y, angle: spot.direction * 45 },
      })),
  );
}
