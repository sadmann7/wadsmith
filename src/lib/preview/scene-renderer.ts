import type { GameMap } from "@/lib/map/types";

import {
  type Camera,
  createRenderTarget,
  renderScene,
  type RenderTarget,
  type SceneOptions,
  type Viewport,
} from "./render";
import { createWebglRenderer } from "./webgl-renderer";

export type SceneRendererKind = "columns" | "webgl";

export interface SceneRenderer extends Viewport {
  readonly kind: SceneRendererKind;
  // The picture's size for a canvas shown at that many CSS pixels, given the
  // rows the column renderer is asked for.
  sizeFor: (
    clientWidth: number,
    clientHeight: number,
    rows: number,
  ) => { width: number; height: number };
  resize: (width: number, height: number) => void;
  // Draws the frame, with a crosshair in that color when one is given.
  render: (
    map: GameMap,
    camera: Camera,
    options: SceneOptions,
    crosshair: string | null,
  ) => void;
  // The surface and its distance at a pixel of the last frame.
  surfaceAt: (x: number, y: number) => { key: string | null; distance: number };
  // How many pixels of the last frame each surface covers.
  surfaceCounts: () => Map<string, number>;
  destroy: () => void;
}

export function createSceneRenderer(
  canvas: HTMLCanvasElement,
  kind: SceneRendererKind,
  width: number,
  height: number,
  onRestored?: () => void,
): SceneRenderer | null {
  if (kind === "webgl") {
    const renderer = createWebglRenderer(canvas, width, height, onRestored);
    if (renderer) return renderer;
  }
  return createColumnRenderer(canvas, width, height);
}

const minColumns = 64;
const maxColumns = 1600;

function createColumnRenderer(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): SceneRenderer | null {
  const output = canvas.getContext("2d");
  if (!output) return null;
  let target: RenderTarget = createRenderTarget(width, height);
  let image = new ImageData(target.pixels, width, height);
  return {
    kind: "columns",
    get width() {
      return target.width;
    },
    get height() {
      return target.height;
    },
    get focal() {
      return target.focal;
    },
    sizeFor(clientWidth, clientHeight, rows) {
      const wide = clientWidth / (clientHeight || 1);
      return {
        width: Math.max(
          minColumns,
          Math.min(maxColumns, Math.round(rows * wide)),
        ),
        height: rows,
      };
    },
    resize(nextWidth, nextHeight) {
      if (nextWidth === target.width && nextHeight === target.height) return;
      target = createRenderTarget(nextWidth, nextHeight);
      image = new ImageData(target.pixels, nextWidth, nextHeight);
    },
    render(map, camera, options, crosshair) {
      // Setting a canvas's size clears it, so the size changes only here,
      // right before the frame that fills it.
      if (canvas.width !== target.width) canvas.width = target.width;
      if (canvas.height !== target.height) canvas.height = target.height;
      renderScene(target, map, camera, options);
      output.putImageData(image, 0, 0);
      if (crosshair) {
        const x = Math.floor(target.width / 2);
        const y = Math.floor(target.height / 2);
        output.fillStyle = crosshair;
        output.fillRect(x - 6, y, 13, 1);
        output.fillRect(x, y - 6, 1, 13);
      }
    },
    surfaceAt(x, y) {
      const index = y * target.width + x;
      return {
        key: target.surfaces[target.pick[index]] || null,
        distance: target.depth[index],
      };
    },
    surfaceCounts() {
      const counts = new Map<string, number>();
      for (const id of target.pick) {
        if (!id) continue;
        const key = target.surfaces[id];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return counts;
    },
    destroy() {},
  };
}
