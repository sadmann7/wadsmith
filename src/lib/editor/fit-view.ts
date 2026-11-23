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

type Side = "left" | "top" | "right" | "bottom" | null;

const sides: Side[] = [null, "left", "top", "right", "bottom"];
const clearance = 8;

export function fitView(
  rect: Box,
  surface: { width: number; height: number },
  options: FitViewOptions,
  overlays: Box[] = [],
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
  for (const area of clearAreas(whole, covering)) {
    if (!getHasRoom(area, options.padding)) continue;
    const view = fitInto(rect, area, options);
    const shown = {
      left: view.x + rect.left * view.zoom - clearance,
      top: view.y + rect.top * view.zoom - clearance,
      right: view.x + rect.right * view.zoom + clearance,
      bottom: view.y + rect.bottom * view.zoom + clearance,
    };
    if (covering.some((overlay) => getIsOverlapping(overlay, shown))) continue;
    if (!best || view.zoom > best.zoom) best = view;
  }
  return best ?? fitInto(rect, whole, options);
}

function clearAreas(whole: Box, overlays: Box[]): Box[] {
  let areas: Box[] = [whole];
  for (const overlay of overlays) {
    areas = areas.flatMap((area) =>
      sides.map((side) => beside(area, overlay, side)),
    );
  }
  return areas;
}

function beside(area: Box, overlay: Box, side: Side): Box {
  if (side === "left")
    return { ...area, left: Math.max(area.left, overlay.right) };
  if (side === "top")
    return { ...area, top: Math.max(area.top, overlay.bottom) };
  if (side === "right")
    return { ...area, right: Math.min(area.right, overlay.left) };
  if (side === "bottom")
    return { ...area, bottom: Math.min(area.bottom, overlay.top) };
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
