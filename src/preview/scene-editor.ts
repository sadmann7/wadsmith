import {
  bindDrag,
  createChange,
  definePrimitive,
  dragThreshold,
  live,
  type ChangeDetails,
} from "@ui-sdk/core";
import { createParts } from "@ui-sdk/react/primitive";

import { gridSize } from "../map/edit";
import { sectorAt } from "../map/geometry";
import {
  describeSurface,
  moveSurfaceHeight,
  parseSurface,
} from "../map/surfaces";
import type { GameMap } from "../map/types";
import type { SceneAssets } from "../wad/assets";
import {
  createRenderTarget,
  renderScene,
  startCamera,
  type Camera,
  type RenderTarget,
} from "./render";

type SceneCamera = { position: Camera; walked: boolean };

type DraftSource = (listener: (map: GameMap | null) => void) => () => void;

type SceneChangeReason = "height-drag" | "height-key";

type SceneOptions = {
  map?: GameMap;
  assets?: SceneAssets;
  camera?: SceneCamera;
  draftSource?: DraftSource;
  selected?: string | null;
  renderWidth?: number;
  renderHeight?: number;
  onMapChange?: (
    map: GameMap,
    details: ChangeDetails<SceneChangeReason>,
  ) => void;
  onSelectedChange?: (
    selected: string | null,
    details: ChangeDetails<"press" | "key">,
  ) => void;
};

type SceneState = {
  map: GameMap | null;
  assets: SceneAssets | null;
  selected: string | null;
  hovered: string | null;
  draftMap: GameMap | null;
  frozenEye: number | null;
  width: number;
  height: number;
};

const moveSpeed = 260;
const turnSpeed = 120;
const walkKeys = /^(Arrow(Up|Down|Left|Right)|Key[WASD])$/;

const sceneEditor = definePrimitive({
  name: "scene-editor",
  options: {
    map: "value",
    assets: "value",
    camera: "value",
    draftSource: "value",
    selected: "value",
    renderWidth: "number",
    renderHeight: "number",
    onMapChange: "callback",
    onSelectedChange: "callback",
  },
  controlled: ["map", "selected"],
  state: (options: SceneOptions): SceneState => ({
    map: options.map ?? null,
    assets: options.assets ?? null,
    selected: options.selected ?? null,
    hovered: null,
    draftMap: null,
    frozenEye: null,
    width: options.renderWidth ?? 320,
    height: options.renderHeight ?? 200,
  }),
  sync: (options) => ({
    ...(options.map ? { map: options.map } : {}),
    ...(options.assets ? { assets: options.assets } : {}),
    ...(options.selected !== undefined ? { selected: options.selected } : {}),
  }),
  live: ["hovered"],
  api: (context) => {
    const { store } = context;
    const change = createChange(context);
    let canvas: HTMLCanvasElement | null = null;
    let target: RenderTarget | null = null;
    let image: ImageData | null = null;
    let drawFrame = 0;
    let walkFrame = 0;
    let stopDrag: (() => void) | undefined;
    const held = new Set<string>();

    const shownMap = () => {
      const { draftMap, map } = store.get();
      return draftMap ?? map;
    };

    const cameraState = () => context.options().camera;

    const draw = () => {
      drawFrame = 0;
      const map = shownMap();
      const { assets, hovered, selected, frozenEye } = store.get();
      const view = cameraState();
      const output = canvas?.getContext("2d");
      if (!map || !assets || !view || !target || !image || !output) return;
      if (!view.walked || !sectorAt(map, view.position)) {
        view.walked = false;
        view.position = startCamera(map);
      }
      renderScene(
        target,
        map,
        {
          ...view.position,
          eye: frozenEye ?? undefined,
        },
        { assets, hovered, selected },
      );
      output.putImageData(image, 0, 0);
    };

    const scheduleDraw = () => {
      drawFrame ||= requestAnimationFrame(draw);
    };

    const surfaceAt = (event: MouseEvent) => {
      if (!canvas || !target) return null;
      const box = canvas.getBoundingClientRect();
      const x = Math.floor(
        ((event.clientX - box.left) / box.width) * target.width,
      );
      const y = Math.floor(
        ((event.clientY - box.top) / box.height) * target.height,
      );
      if (x < 0 || y < 0 || x >= target.width || y >= target.height) {
        return null;
      }
      const index = y * target.width + x;
      return {
        key: target.surfaces[target.pick[index]] || null,
        distance: target.depth[index],
      };
    };

    const select = (key: string | null, reason: "press" | "key") => {
      change("selected", key, { reason });
    };

    const canMoveHeight = (key: string | null) => {
      const { map } = store.get();
      return !!map && describeSurface(map, key)?.height != null;
    };

    const nudge = (event: KeyboardEvent, direction: number) => {
      const { map, selected } = store.get();
      if (!map || !selected || !canMoveHeight(selected)) return;
      const step = gridSize * (event.shiftKey ? 3 : 1);
      change("map", moveSurfaceHeight(map, selected, direction * step), {
        reason: "height-key",
        event,
      });
    };

    const cycle = (direction: number) => {
      if (!target) return;
      const counts = new Map<number, number>();
      for (const id of target.pick) {
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      const { surfaces } = target;
      const keys = [...counts]
        .toSorted((a, b) => b[1] - a[1])
        .map(([id]) => surfaces[id]);
      if (keys.length === 0) return;
      const at = keys.indexOf(store.get().selected ?? "");
      const next = at < 0 ? 0 : (at + direction + keys.length) % keys.length;
      select(keys[next], "key");
    };

    const walk = (previous: number) => {
      walkFrame = requestAnimationFrame((now) => {
        walkFrame = 0;
        const view = cameraState();
        const map = shownMap();
        if (held.size === 0 || !view || !map) return;
        const seconds = Math.min(0.05, (now - previous) / 1000);
        const pressed = (...codes: string[]) =>
          codes.some((code) => held.has(code));
        const turn =
          Number(pressed("ArrowLeft")) - Number(pressed("ArrowRight"));
        const advance =
          Number(pressed("ArrowUp", "KeyW")) -
          Number(pressed("ArrowDown", "KeyS"));
        const strafe = Number(pressed("KeyD")) - Number(pressed("KeyA"));
        const angle = view.position.angle + turn * turnSpeed * seconds;
        const radians = (angle * Math.PI) / 180;
        const forward = { x: Math.cos(radians), y: -Math.sin(radians) };
        const distance = moveSpeed * seconds;
        const next = {
          x:
            view.position.x +
            (forward.x * advance - forward.y * strafe) * distance,
          y:
            view.position.y +
            (forward.y * advance + forward.x * strafe) * distance,
        };
        view.position = {
          ...(sectorAt(map, next) ? next : view.position),
          angle,
        };
        view.walked = true;
        scheduleDraw();
        walk(now);
      });
    };

    context.onDestroy(() => {
      stopDrag?.();
      cancelAnimationFrame(drawFrame);
      cancelAnimationFrame(walkFrame);
    });

    return {
      attach(element: HTMLElement) {
        const { width, height } = store.get();
        canvas = element as HTMLCanvasElement;
        target = createRenderTarget(width, height);
        image = new ImageData(target.pixels, width, height);
        const stopStore = store.subscribe(scheduleDraw);
        const stopDraft = context
          .options()
          .draftSource?.((draftMap) => store.set({ draftMap }));
        scheduleDraw();
        return () => {
          stopStore();
          stopDraft?.();
          canvas = null;
          target = null;
          image = null;
        };
      },
      pointermove(event: PointerEvent) {
        if (stopDrag) return;
        const hovered = surfaceAt(event)?.key ?? null;
        if (hovered !== store.get().hovered) store.set({ hovered });
      },
      pointerleave() {
        store.set({ hovered: null });
      },
      pointerdown(event: PointerEvent) {
        if (event.button !== 0 || !canvas || !target) return;
        canvas.focus({ preventScroll: true });
        const hit = surfaceAt(event);
        const key = hit?.key ?? null;
        select(key, "press");
        const { map } = store.get();
        const surface = key ? parseSurface(key) : null;
        if (
          !hit ||
          !key ||
          !map ||
          !canMoveHeight(key) ||
          surface?.kind === "thing"
        ) {
          return;
        }

        const view = cameraState();
        const owner = view ? sectorAt(map, view.position) : null;
        const startY = event.clientY;
        const { focal, height } = target;
        const rowsPerPixel = height / canvas.getBoundingClientRect().height;
        const unitsPerRow = hit.distance / focal;
        let moved = false;
        stopDrag = bindDrag(canvas, event, {
          threshold: dragThreshold,
          cancelOnEscape: true,
          onStart: () => {
            store.set({
              frozenEye: owner ? owner.floor + 41 : null,
            });
          },
          onMove: ({ y }) => {
            const units = (startY - y) * rowsPerPixel * unitsPerRow;
            const delta = Math.round(units / gridSize) * gridSize;
            moved = delta !== 0;
            store.set({ draftMap: moveSurfaceHeight(map, key, delta) });
          },
          onEnd: (end, canceled) => {
            const { draftMap } = store.get();
            stopDrag = undefined;
            store.set({ draftMap: null, frozenEye: null });
            if (!canceled && moved && draftMap) {
              change("map", draftMap, { reason: "height-drag", event: end });
            }
          },
        });
      },
      keydown(event: KeyboardEvent) {
        if (walkKeys.test(event.code)) {
          event.preventDefault();
          held.add(event.code);
          if (!walkFrame) walk(performance.now());
        } else if (event.code === "KeyN" || event.code === "KeyP") {
          event.preventDefault();
          cycle(event.code === "KeyN" ? 1 : -1);
        } else if (event.key === "PageUp" || event.key === "PageDown") {
          event.preventDefault();
          nudge(event, event.key === "PageUp" ? 1 : -1);
        } else if (event.key === "Escape") {
          select(null, "key");
        }
      },
      keyup(event: KeyboardEvent) {
        held.delete(event.code);
      },
      blur() {
        held.clear();
      },
    };
  },
  slots: (slot) => ({
    root: slot({
      attrs: (state) => ({
        width: String(state.width),
        height: String(state.height),
        tabindex: "0",
        "aria-roledescription": "3D map editor",
      }),
      live: live<SceneState, any, {}>((state) => {
        const surface = state.hovered ? parseSurface(state.hovered) : null;
        return {
          "data-hover":
            surface?.kind === "floor" || surface?.kind === "ceiling"
              ? "height"
              : surface
                ? "surface"
                : undefined,
        };
      }),
      bind: (el, { api }) => api.attach(el),
      on: {
        pointermove: (event, { api }) => api.pointermove(event),
        pointerleave: (_event, { api }) => api.pointerleave(),
        pointerdown: (event, { api }) => api.pointerdown(event),
        keydown: (event, { api }) => api.keydown(event),
        keyup: (event, { api }) => api.keyup(event),
        blur: (_event, { api }) => api.blur(),
      },
    }),
  }),
  agent: { shown: () => false },
});

const { Root: SceneCanvas } = createParts(sceneEditor, { root: "canvas" });

export { SceneCanvas, type DraftSource, type SceneCamera };
