import { useMemo, type ReactNode } from "react";

import { wallOwners } from "../map/geometry";
import type { GameMap } from "../map/types";

function MapOutline({
  map,
  className,
  label,
  solidColor = "#6f685e",
  openColor = "#3a342d",
  children,
}: {
  map: GameMap;
  className?: string;
  label?: string;
  solidColor?: string;
  openColor?: string;
  children?: (size: number) => ReactNode;
}) {
  const { walls, box } = useMemo(() => {
    const points = Object.values(map.vertices);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const left = Math.min(0, ...xs);
    const top = Math.min(0, ...ys);
    const fromX = points.length > 0 ? Math.min(...xs) : left;
    const fromY = points.length > 0 ? Math.min(...ys) : top;
    const width = (points.length > 0 ? Math.max(...xs) - fromX : 0) || 1;
    const height = (points.length > 0 ? Math.max(...ys) - fromY : 0) || 1;
    const pad = Math.max(width, height) * 0.08;
    return {
      box: {
        x: fromX - pad,
        y: fromY - pad,
        width: width + pad * 2,
        height: height + pad * 2,
      },
      walls: [...wallOwners(map)].map(([key, owners]) => {
        const [from, to] = key.split("|").map((id) => map.vertices[id]);
        return { key, from, to, open: owners.length > 1 };
      }),
    };
  }, [map]);
  return (
    <svg
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
    >
      {walls.map(({ key, from, to, open }) => (
        <line
          key={key}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={open ? openColor : solidColor}
          strokeWidth={open ? 1 : 1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {children?.(Math.max(box.width, box.height))}
    </svg>
  );
}

export { MapOutline };
