import {
  bindDrag,
  type ChangeDetails,
  createChange,
  definePrimitive,
  dragThreshold,
  live,
} from "@ui-sdk/core";
import { createParts } from "@ui-sdk/react/primitive";

import type { GameMap, Point, ThingKind } from "@/lib/map/types";
import type { SceneCamera } from "@/lib/preview/scene-camera";
import type { SceneAssets } from "@/lib/wad/assets";

import {
  getIsDragging,
  getIsKeyboardMenu,
  getIsSecondaryPress,
  openMenuFromKey,
} from "@/lib/editor/map-target";
import { thingCatalog } from "@/lib/map/catalog";
import {
  addThing,
  gridSize,
  removeThing,
  snapPoint,
  updateThing,
} from "@/lib/map/edit";
import { sectorAt } from "@/lib/map/geometry";
import {
  describeSurface,
  moveSurfaceHeight,
  parseSurface,
} from "@/lib/map/surfaces";
import { getIsMover, moverAt, withMovers } from "@/lib/preview/movers";
import {
  cameraBasis,
  createRenderTarget,
  pointOnPlane,
  projectPoint,
  renderScene,
  type RenderTarget,
} from "@/lib/preview/render";

export type DraftSource = (
  listener: (map: GameMap | null) => void,
) => () => void;

type SceneChangeReason =
  | "height-drag"
  | "height-key"
  | "place"
  | "thing-drag"
  | "thing-key"
  | "delete";

interface SceneOptions {
  map?: GameMap;
  assets?: SceneAssets;
  camera?: SceneCamera;
  draftSource?: DraftSource;
  selected?: string | null;
  linked?: string | null;
  onContextSurface?: (
    surface: string | null,
    point: Point | null,
    keyboard: boolean,
  ) => void;
  contextMenuOpen?: boolean;
  placing?: ThingKind | null;
  sky?: string | null;
  renderWidth?: number;
  renderHeight?: number;
  grid?: number;
  onMapChange?: (
    map: GameMap,
    details: ChangeDetails<SceneChangeReason>,
  ) => void;
  onSelectedChange?: (
    selected: string | null,
    details: ChangeDetails<"press" | "key">,
  ) => void;
}

interface SceneState {
  map: GameMap | null;
  assets: SceneAssets | null;
  selected: string | null;
  linked: string | null;
  hovered: string | null;
  draftMap: GameMap | null;
  frozenEye: number | null;
  placing: ThingKind | null;
  ghost: Point | null;
  sky: string | null;
  // The doors and lifts shown open, to check what they leave room for.
  opened: string[];
  width: number;
  height: number;
}

const touchSlop = 4;
const moveSpeed = 260;
const turnSpeed = 120;
const placeDistances = [128, 96, 64, 32];
const walkKeys = /^(Arrow(Up|Down|Left|Right)|Key[WASD])$/;

const sceneEditor = definePrimitive({
  name: "scene-editor",
  options: {
    map: "value",
    assets: "value",
    camera: "value",
    draftSource: "value",
    selected: "value",
    linked: "value",
    onContextSurface: "callback",
    contextMenuOpen: "boolean",
    placing: "value",
    sky: "value",
    renderWidth: "number",
    renderHeight: "number",
    grid: "number",
    onMapChange: "callback",
    onSelectedChange: "callback",
  },
  controlled: ["map", "selected"],
  state: (options: SceneOptions): SceneState => ({
    map: options.map ?? null,
    assets: options.assets ?? null,
    selected: options.selected ?? null,
    linked: options.linked ?? null,
    hovered: null,
    draftMap: null,
    frozenEye: null,
    placing: options.placing ?? null,
    ghost: null,
    sky: options.sky ?? null,
    opened: [],
    width: options.renderWidth ?? 320,
    height: options.renderHeight ?? 200,
  }),
  sync: (options) => ({
    ...(options.map ? { map: options.map } : {}),
    ...(options.assets ? { assets: options.assets } : {}),
    ...(options.selected !== undefined ? { selected: options.selected } : {}),
    linked: options.linked ?? null,
    placing: options.placing ?? null,
    sky: options.sky ?? null,
    ...(options.placing ? {} : { ghost: null }),
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
    let dragging = false;
    let touchPress: Point | null = null;
    const held = new Set<string>();

    const shownMap = () => {
      const { draftMap, map } = store.get();
      return draftMap ?? map;
    };

    // The map as the frame shows it, with the opened doors and lifts where
    // they stand. What a press means is read from this one, and edits go to
    // the map itself.
    const viewMap = () => {
      const map = shownMap();
      return map ? withMovers(map, store.get().opened) : null;
    };

    // A door or lift that is gone, or no longer one, stops being shown open.
    context.onOptions(({ map }) => {
      const { opened } = store.get();
      if (!map || opened.length === 0) return;
      const still = opened.filter((id) => getIsMover(map, id));
      if (still.length < opened.length) store.set({ opened: still });
    });

    const cameraState = () => context.options().camera;
    const grid = () => context.options().grid ?? gridSize;

    const draw = () => {
      drawFrame = 0;
      const map = shownMap();
      const {
        assets,
        draftMap,
        hovered,
        selected,
        linked,
        frozenEye,
        placing,
        ghost,
        sky,
        opened,
      } = store.get();
      const view = cameraState();
      const output = canvas?.getContext("2d");
      if (!map || !assets || !view || !target || !image || !output) return;
      view.sync(map, draftMap !== null);
      renderScene(
        target,
        map,
        {
          ...view.position,
          eye: frozenEye ?? undefined,
        },
        {
          assets,
          hovered: placing ? null : hovered,
          selected: selected ?? linked,
          ghost: placing && ghost ? { ...ghost, kind: placing } : null,
          sky,
          opened,
        },
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

    const targetPoint = (event: MouseEvent) => {
      if (!canvas || !target) return null;
      const box = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - box.left) / box.width) * target.width,
        y: ((event.clientY - box.top) / box.height) * target.height,
      };
    };

    const floorPointAt = (event: MouseEvent) => {
      const map = viewMap();
      const view = cameraState();
      const key = surfaceAt(event)?.key;
      const surface = key ? parseSurface(key) : null;
      const at = targetPoint(event);
      if (!map || !view || !target || !at || surface?.kind !== "floor") {
        return null;
      }
      const floor = map.sectors.find((item) => item.id === surface.sector);
      if (!floor) return null;
      const point = pointOnPlane(
        target,
        map,
        view.position,
        at.x,
        at.y,
        floor.floor,
      );
      if (!point) return null;
      const snapped = snapPoint(point, grid());
      return standable(map, snapped) ? snapped : null;
    };

    const place = (point: Point, reason: "press" | "key", event: Event) => {
      const { map, placing } = store.get();
      const view = cameraState();
      if (!map || !placing || !view) return;
      const angle =
        thingCatalog[placing].category === "start"
          ? view.position.angle
          : view.position.angle + 180;
      const facing = (((Math.round(angle / 45) * 45) % 360) + 360) % 360;
      const added = addThing(map, placing, point, facing, 1);
      // A new player start must not pull the camera away from the person placing it.
      view.walked = true;
      change("map", added.map, { reason: "place", event });
      change("selected", `thing:${added.id}`, { reason });
    };

    const placeAhead = (event: KeyboardEvent) => {
      const { map } = store.get();
      const view = cameraState();
      if (!map || !view) return;
      const { forward } = cameraBasis(view.position);
      for (const distance of placeDistances) {
        const point = snapPoint(
          {
            x: view.position.x + forward.x * distance,
            y: view.position.y + forward.y * distance,
          },
          grid(),
        );
        if (standable(map, point)) {
          place(point, "key", event);
          return;
        }
      }
    };

    const selectedThing = () => {
      const { map, selected } = store.get();
      const surface = selected ? parseSurface(selected) : null;
      if (!map || surface?.kind !== "thing") return null;
      return map.things.find((item) => item.id === surface.thing) ?? null;
    };

    const nudgeThing = (event: KeyboardEvent) => {
      const { map } = store.get();
      const thing = selectedThing();
      const view = cameraState();
      if (!map || !thing || !view) return false;
      const { forward, right } = cameraBasis(view.position);
      const direction = {
        ArrowUp: forward,
        ArrowDown: { x: -forward.x, y: -forward.y },
        ArrowRight: right,
        ArrowLeft: { x: -right.x, y: -right.y },
      }[event.key];
      if (!direction) return false;
      event.preventDefault();
      const horizontal = Math.abs(direction.x) >= Math.abs(direction.y);
      const point = {
        x: thing.x + (horizontal ? Math.sign(direction.x) * grid() : 0),
        y: thing.y + (horizontal ? 0 : Math.sign(direction.y) * grid()),
      };
      if (standable(map, point)) {
        view.walked = true;
        change("map", updateThing(map, thing.id, point), {
          reason: "thing-key",
          event,
        });
      }
      return true;
    };

    const dragThing = (event: PointerEvent, thingId: string) => {
      const { map } = store.get();
      const shown = viewMap();
      const view = cameraState();
      const thing = map?.things.find((item) => item.id === thingId);
      const pressed = targetPoint(event);
      if (!canvas || !target || !map || !shown || !view || !thing || !pressed) {
        return;
      }
      const plane = sectorAt(shown, thing)?.floor ?? 0;
      const feet = projectPoint(target, shown, view.position, thing, plane);
      if (!feet) return;
      const element = canvas;
      const output = target;
      const offset = { x: pressed.x - feet.x, y: pressed.y - feet.y };
      let moved = false;
      stopDrag = bindDrag(element, event, {
        threshold: dragThreshold,
        cancelOnEscape: true,
        onStart: () => {
          dragging = true;
          view.walked = true;
        },
        onMove: ({ x, y }) => {
          const box = element.getBoundingClientRect();
          const point = pointOnPlane(
            output,
            shown,
            view.position,
            ((x - box.left) / box.width) * output.width - offset.x,
            ((y - box.top) / box.height) * output.height - offset.y,
            plane,
          );
          if (!point) return;
          const snapped = snapPoint(point, grid());
          if (!standable(map, snapped)) return;
          moved = snapped.x !== thing.x || snapped.y !== thing.y;
          store.set({ draftMap: updateThing(map, thing.id, snapped) });
        },
        onEnd: (end, canceled) => {
          const { draftMap } = store.get();
          stopDrag = undefined;
          dragging = false;
          store.set({ draftMap: null });
          if (!canceled && moved && draftMap) {
            change("map", draftMap, { reason: "thing-drag", event: end });
          }
        },
      });
    };

    const reportContext = (event: MouseEvent) => {
      const { onContextSurface } = context.options();
      if (dragging || getIsDragging(event)) {
        onContextSurface?.(null, null, false);
      } else if (getIsKeyboardMenu(event)) {
        const { selected, linked } = store.get();
        onContextSurface?.(selected ?? linked, null, true);
      } else {
        onContextSurface?.(
          surfaceAt(event)?.key ?? null,
          floorPointAt(event),
          false,
        );
      }
    };

    context.onOptions(({ contextMenuOpen }) => {
      if (!contextMenuOpen || dragging) return;
      touchPress = null;
      stopDrag?.();
      stopDrag = undefined;
    });

    const select = (key: string | null, reason: "press" | "key") => {
      change("selected", key, { reason });
    };

    // A door or lift shown open isn't at the height the map holds for it, so
    // its height waits until it is shut again.
    const getCanMoveHeight = (key: string | null) => {
      const { map, opened } = store.get();
      const info = map ? describeSurface(map, key) : null;
      return (
        info?.height != null &&
        !(info.sector && opened.includes(info.sector.id))
      );
    };

    const nudge = (event: KeyboardEvent, direction: number) => {
      const { map, selected } = store.get();
      if (!map || !selected || !getCanMoveHeight(selected)) return;
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
        const stopCamera = context.options().camera?.subscribe(scheduleDraw);
        const stopDraft = context
          .options()
          .draftSource?.((draftMap) => store.set({ draftMap }));
        scheduleDraw();
        return () => {
          stopStore();
          stopCamera?.();
          stopDraft?.();
          canvas = null;
          target = null;
          image = null;
        };
      },
      pointermove(event: PointerEvent) {
        if (
          touchPress &&
          Math.abs(event.clientX - touchPress.x) +
            Math.abs(event.clientY - touchPress.y) >
            touchSlop
        ) {
          touchPress = null;
          context.options().onContextSurface?.(null, null, false);
        }
        if (stopDrag) return;
        const hovered = surfaceAt(event)?.key ?? null;
        const ghost = store.get().placing ? floorPointAt(event) : null;
        const current = store.get();
        if (
          hovered !== current.hovered ||
          ghost?.x !== current.ghost?.x ||
          ghost?.y !== current.ghost?.y
        ) {
          store.set({ hovered, ghost });
        }
      },
      pointerleave() {
        store.set({ hovered: null, ghost: null });
      },
      contextmenu(event: MouseEvent) {
        reportContext(event);
      },
      pointerdown(event: PointerEvent) {
        touchPress = null;
        if (event.pointerType === "touch") {
          touchPress = { x: event.clientX, y: event.clientY };
          reportContext(event);
        }
        if (event.button !== 0 || getIsSecondaryPress(event)) return;
        if (!canvas || !target) return;
        canvas.focus({ preventScroll: true });
        const hit = surfaceAt(event);
        const key = hit?.key ?? null;
        const surface = key ? parseSurface(key) : null;
        if (store.get().placing && surface?.kind !== "thing") {
          const point = floorPointAt(event);
          if (point) place(point, "press", event);
          return;
        }
        select(key, "press");
        const { map } = store.get();
        if (surface?.kind === "thing") {
          if (!store.get().placing) dragThing(event, surface.thing);
          return;
        }
        if (!hit || !key || !map || !getCanMoveHeight(key)) return;

        const view = cameraState();
        const shown = viewMap();
        const owner = view && shown ? sectorAt(shown, view.position) : null;
        const startY = event.clientY;
        const { focal, height } = target;
        const rowsPerPixel = height / canvas.getBoundingClientRect().height;
        const unitsPerRow = hit.distance / focal;
        let moved = false;
        stopDrag = bindDrag(canvas, event, {
          threshold: dragThreshold,
          cancelOnEscape: true,
          onStart: () => {
            dragging = true;
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
            dragging = false;
            store.set({ draftMap: null, frozenEye: null });
            if (!canceled && moved && draftMap) {
              change("map", draftMap, { reason: "height-drag", event: end });
            }
          },
        });
      },
      keydown(event: KeyboardEvent) {
        if (stopDrag || openMenuFromKey(event)) return;
        const { map, placing } = store.get();
        const thing = selectedThing();
        if (event.altKey && nudgeThing(event)) return;
        if (event.key === "Enter" && placing) {
          event.preventDefault();
          placeAhead(event);
        } else if (
          thing &&
          map &&
          (event.key === "Delete" || event.key === "Backspace")
        ) {
          event.preventDefault();
          change("map", removeThing(map, thing.id), {
            reason: "delete",
            event,
          });
          select(null, "key");
        } else if (walkKeys.test(event.code)) {
          event.preventDefault();
          held.add(event.code);
          if (!walkFrame) walk(performance.now());
        } else if (event.code === "KeyO" && map && !event.repeat) {
          // The door or lift under the pointer, or else the selected one,
          // stands open until the key is pressed on it again.
          const { hovered, selected, opened } = store.get();
          const mover = moverAt(map, hovered) ?? moverAt(map, selected);
          if (!mover) return;
          event.preventDefault();
          store.set({
            opened: opened.includes(mover)
              ? opened.filter((id) => id !== mover)
              : [...opened, mover],
          });
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
      live: live<SceneState, unknown, {}>((state) => {
        const surface = state.hovered ? parseSurface(state.hovered) : null;
        let hover: string | undefined;
        if (state.ghost) hover = "place";
        else if (surface?.kind === "thing") hover = "thing";
        else if (state.placing) hover = undefined;
        else if (surface?.kind === "floor" || surface?.kind === "ceiling") {
          hover = "height";
        } else if (surface) hover = "surface";
        return { "data-hover": hover };
      }),
      bind: (el, { api }) => api.attach(el),
      on: {
        pointermove: (event, { api }) => api.pointermove(event),
        pointerleave: (_event, { api }) => api.pointerleave(),
        pointerdown: (event, { api }) => api.pointerdown(event),
        contextmenu: (event, { api }) => api.contextmenu(event),
        keydown: (event, { api }) => api.keydown(event),
        keyup: (event, { api }) => api.keyup(event),
        blur: (_event, { api }) => api.blur(),
      },
    }),
  }),
  agent: { shown: () => false },
});

function standable(map: GameMap, point: Point) {
  const sector = sectorAt(map, point);
  return !!sector && !sector.door;
}

export const { Root: SceneCanvas } = createParts(sceneEditor, {
  root: "canvas",
});
