import * as React from "react";

import {
  loopsPath,
  paintOrder,
  sectorAt,
  sectorHoles,
  sectorPolygon,
  wallOwners,
} from "@/lib/map/geometry";
import { endsLevel, lineUsesTag, movesSector } from "@/lib/map/lines";
import type { GameMap, Sector } from "@/lib/map/types";

type SectorKind =
  | "floor"
  | "raised"
  | "lift"
  | "door"
  | "lava"
  | "acid"
  | "exit"
  | "secret";

const kindColors: Record<SectorKind, string> = {
  floor: "var(--color-map-sector)",
  raised: "var(--color-map-sector-raised)",
  lift: "var(--color-map-sector-lift)",
  door: "var(--color-map-sector-door)",
  lava: "var(--color-map-sector-lava)",
  acid: "var(--color-map-sector-acid)",
  exit: "var(--color-map-sector-exit)",
  secret: "var(--color-map-sector-secret)",
};

export function sectorKinds(map: GameMap) {
  const lines = Object.entries(map.lines ?? {});
  const moved = new Set(
    lines.flatMap(([, line]) =>
      line.action && movesSector(line.action.kind) && lineUsesTag(line.action)
        ? [line.action.tag]
        : [],
    ),
  );
  const owners = wallOwners(map);
  const exits = new Set(
    lines.flatMap(([wall, line]) =>
      line.action && endsLevel(line.action.kind)
        ? (owners.get(wall) ?? []).map((sector) => sector.id)
        : [],
    ),
  );
  const start = map.things.find((thing) => thing.kind === "player");
  const base = (start && sectorAt(map, start)?.floor) ?? 0;
  const kindOf = (sector: Sector): SectorKind => {
    if (sector.door) return "door";
    if (exits.has(sector.id)) return "exit";
    if (sector.effect === "secret") return "secret";
    if (sector.effect?.startsWith("damage")) {
      return /^(LAVA|BLOOD|RROCK0[5-8])/.test(sector.floorTexture)
        ? "lava"
        : "acid";
    }
    if (sector.tag && moved.has(sector.tag)) return "lift";
    return sector.floor > base ? "raised" : "floor";
  };
  return new Map(map.sectors.map((sector) => [sector.id, kindOf(sector)]));
}

interface MapPlanProps {
  map: GameMap;
  className?: string;
  label?: string;
}

// A filled plan of a map, coloured by what each room does, for map pickers.
export function MapPlan({ map, className, label }: MapPlanProps) {
  const { viewBox, rooms, walls } = React.useMemo(() => {
    const points = Object.values(map.vertices);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const width = Math.max(...xs) - left || 1;
    const height = Math.max(...ys) - top || 1;
    const pad = Math.max(width, height) * 0.06;
    const kinds = sectorKinds(map);
    return {
      viewBox: `${left - pad} ${top - pad} ${width + pad * 2} ${height + pad * 2}`,
      rooms: paintOrder(map).map((sector) => ({
        id: sector.id,
        path: loopsPath([
          sectorPolygon(map, sector),
          ...sectorHoles(map, sector),
        ]),
        color: kindColors[kinds.get(sector.id) ?? "floor"],
      })),
      walls: [...wallOwners(map)]
        .filter(([, owners]) => owners.length === 1)
        .map(([key]) => {
          const [from, to] = key.split("|").map((id) => map.vertices[id]);
          return { key, from, to };
        }),
    };
  }, [map]);
  return (
    <svg
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      viewBox={viewBox}
    >
      {rooms.map((room) => (
        <path
          key={room.id}
          d={room.path}
          fillRule="evenodd"
          fill={room.color}
        />
      ))}
      {walls.map(({ key, from, to }) => (
        <line
          key={key}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="var(--color-map-portal)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
