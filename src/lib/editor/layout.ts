export type ViewLayout = "map" | "split" | "scene";

export interface SavedLayout {
  view: ViewLayout;
  sizes: number[];
  dock: boolean;
  isDockCollapsed: boolean;
}

export const defaultLayout: SavedLayout = {
  view: "map",
  sizes: [50, 50],
  dock: true,
  isDockCollapsed: false,
};

const views: ViewLayout[] = ["map", "split", "scene"];

export function parseLayout(text: string | null): SavedLayout {
  let saved: Record<string, unknown> | null;
  try {
    saved = JSON.parse(text ?? "null");
  } catch {
    return defaultLayout;
  }
  if (typeof saved !== "object" || saved === null) return defaultLayout;
  const { view, sizes, dock, dockCollapsed } = saved;
  return {
    view: views.includes(view as ViewLayout)
      ? (view as ViewLayout)
      : defaultLayout.view,
    sizes:
      Array.isArray(sizes) && sizes.length === 2 && sizes.every(Number.isFinite)
        ? sizes
        : defaultLayout.sizes,
    dock: dock !== false,
    isDockCollapsed: dockCollapsed === true,
  };
}

export function serializeLayout(layout: SavedLayout) {
  const { view, sizes, dock, isDockCollapsed } = layout;
  return JSON.stringify({ view, sizes, dock, dockCollapsed: isDockCollapsed });
}
