export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface FitView {
  x: number;
  y: number;
  zoom: number;
}

interface FitViewOptions {
  padding: number;
  minZoom: number;
  maxZoom: number;
}

export function boundsOf(points: { x: number; y: number }[]): Box {
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

type Side = "left" | "top" | "right" | "bottom" | null;

const clearance = 8;

export function fitView(
  rect: Box,
  surface: { width: number; height: number },
  options: FitViewOptions,
  overlays: Box[] = [],
  parts: Box[] = [rect],
): FitView {
  const whole = {
    left: 0,
    top: 0,
    right: surface.width,
    bottom: surface.height,
  };
  const covering = overlays.filter((overlay) =>
    getIsOverlapping(overlay, whole),
  );
  let best: FitView | null = null;
  for (const area of clearAreas(whole, covering, options.padding)) {
    if (!getHasRoom(area, options.padding)) continue;
    const view = fitInto(rect, area, options);
    const isCovered = parts.some((part) => {
      const shown = {
        left: view.x + part.left * view.zoom - clearance,
        top: view.y + part.top * view.zoom - clearance,
        right: view.x + part.right * view.zoom + clearance,
        bottom: view.y + part.bottom * view.zoom + clearance,
      };
      return covering.some((overlay) => getIsOverlapping(overlay, shown));
    });
    if (isCovered) continue;
    if (!best || view.zoom > best.zoom) best = view;
  }
  return best ?? fitInto(rect, whole, options);
}

const gap = 16;
const sides: Side[] = [null, "left", "top", "right", "bottom"];

function clearAreas(whole: Box, overlays: Box[], padding: number): Box[] {
  let areas: Box[] = [whole];
  for (const overlay of overlays) {
    areas = areas.flatMap((area) =>
      sides.map((side) => beside(area, overlay, side, padding - gap)),
    );
  }
  return areas;
}

function beside(area: Box, overlay: Box, side: Side, reach: number): Box {
  if (side === "left")
    return { ...area, left: Math.max(area.left, overlay.right - reach) };
  if (side === "top")
    return { ...area, top: Math.max(area.top, overlay.bottom - reach) };
  if (side === "right")
    return { ...area, right: Math.min(area.right, overlay.left + reach) };
  if (side === "bottom")
    return { ...area, bottom: Math.min(area.bottom, overlay.top + reach) };
  return area;
}

function fitInto(
  rect: Box,
  area: Box,
  { padding, minZoom, maxZoom }: FitViewOptions,
): FitView {
  const width = Math.max(rect.right - rect.left, 1);
  const height = Math.max(rect.bottom - rect.top, 1);
  const fill = Math.min(
    (area.right - area.left - padding * 2) / width,
    (area.bottom - area.top - padding * 2) / height,
  );
  const zoom = Math.max(Math.min(fill, maxZoom), minZoom);
  return {
    x: (area.left + area.right) / 2 - (rect.left + width / 2) * zoom,
    y: (area.top + area.bottom) / 2 - (rect.top + height / 2) * zoom,
    zoom,
  };
}

function getHasRoom(area: Box, padding: number) {
  return (
    area.right - area.left > padding * 2 && area.bottom - area.top > padding * 2
  );
}

function getIsOverlapping(a: Box, b: Box) {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}
