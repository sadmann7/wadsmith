import {
  bindDrag,
  type ChangeDetails,
  createChange,
  definePrimitive,
  dragThreshold,
  live,
  matchesShortcut,
} from "@ui-sdk/core";
import { createParts } from "@ui-sdk/react/primitive";

import type { EditorShortcut } from "@/lib/editor/shortcuts";
import type { GameMap, Point, ThingKind } from "@/lib/map/types";
import type { Camera } from "@/lib/preview/render";
import type { SceneCamera } from "@/lib/preview/scene-camera";

import { currentKeys } from "@/lib/editor/keymap";
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
  updateLine,
  updateLineSide,
  updateSector,
  updateThing,
} from "@/lib/map/edit";
import { sectorAt, wallKey, wallOwners } from "@/lib/map/geometry";
import {
  applyLook,
  floodWalls,
  lookOf,
  type SurfaceLook,
} from "@/lib/map/look";
import { walkStep } from "@/lib/map/standing";
import {
  describeSurface,
  heightBeside,
  moveSurfaceHeight,
  parseSurface,
} from "@/lib/map/surfaces";
import { alignWalls } from "@/lib/map/texture-tools";
import {
  getIsMover,
  movedRooms,
  moverAt,
  withMovers,
} from "@/lib/preview/movers";
import {
  cameraBasis,
  createRenderTarget,
  pointOnPlane,
  projectPoint,
  renderScene,
  type RenderTarget,
} from "@/lib/preview/render";
import { countNotches } from "@/lib/preview/wheel";
import { type SceneAssets, textureHeightOf } from "@/lib/wad/assets";

export type DraftSource = (
  listener: (map: GameMap | null) => void,
) => () => void;

type SceneChangeReason =
  | "height-drag"
  | "height-key"
  | "offset-drag"
  | "offset-key"
  | "peg-key"
  | "paint"
  | "wheel"
  | "place"
  | "thing-drag"
  | "thing-key"
  | "delete";

// How the view moves and draws: walking into walls and up steps as a player
// would, or flying through them, at full light or not, with things or not.
export interface SceneView {
  flying: boolean;
  fullbright: boolean;
  things: boolean;
}

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
  // The editor number a custom thing is placed with.
  placingType?: number;
  // The sprite frame each custom thing's editor number shows.
  customSprites?: ReadonlyMap<number, string | null>;
  sky?: string | null;
  // The look last copied from a surface, to paste, paint and flood with.
  look?: SurfaceLook | null;
  // False once something else was copied after the look, which the paste key
  // then leaves to the page.
  pasteLook?: boolean;
  onLookChange?: (look: SurfaceLook) => void;
  // The surfaces picked together with Shift, in the order they were picked.
  picked?: string[];
  onPickedChange?: (picked: string[]) => void;
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
  // How the view moves and draws, kept by the page so it outlasts the view.
  view?: SceneView;
  onViewChange?: (view: SceneView) => void;
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
  picked: string[];
  // The doors and lifts shown open, to check what they leave room for.
  opened: string[];
  width: number;
  height: number;
  // The pointer is locked to the view, which looks where the mouse goes and
  // acts on what the crosshair is over.
  looking: boolean;
  view: SceneView;
}

const touchSlop = 4;
const noSurfaces: string[] = [];
const lightStep = 16;

const moveSpeed = 260;
const turnSpeed = 120;
const riseSpeed = 160;
// Degrees of turn, and shares of the view's height of tilt, for each pixel
// the mouse moves while it looks.
const lookTurn = 0.15;
const lookTilt = 0.002;
const mostTilt = 0.5;
// Windows asks for the menu once the right button comes up after a drag.
const menuAfterDragMs = 300;
const thingTurn = 45;
const placeDistances = [128, 96, 64, 32];
const walkKeys = /^(Arrow(Up|Down|Left|Right)|Key[WASDC]|Space)$/;
export const startView: SceneView = {
  flying: false,
  fullbright: false,
  things: true,
};

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
    placingType: "value",
    customSprites: "value",
    sky: "value",
    look: "value",
    pasteLook: "boolean",
    onLookChange: "callback",
    picked: "value",
    onPickedChange: "callback",
    renderWidth: "number",
    renderHeight: "number",
    grid: "number",
    onMapChange: "callback",
    onSelectedChange: "callback",
    view: "value",
    onViewChange: "callback",
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
    picked: options.picked ?? noSurfaces,
    opened: [],
    width: options.renderWidth ?? 320,
    height: options.renderHeight ?? 200,
    looking: false,
    view: options.view ?? startView,
  }),
  sync: (options) => ({
    ...(options.map ? { map: options.map } : {}),
    ...(options.assets ? { assets: options.assets } : {}),
    ...(options.selected !== undefined ? { selected: options.selected } : {}),
    linked: options.linked ?? null,
    placing: options.placing ?? null,
    sky: options.sky ?? null,
    picked: options.picked ?? noSurfaces,
    ...(options.view ? { view: options.view } : {}),
    ...(options.placing ? {} : { ghost: null }),
  }),
  live: ["hovered", "looking"],
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
    // A press of the right button, and where the menu it asked for opens.
    let rightPress: { dragged: boolean; menu: Point | null } | null = null;
    let quietMenuUntil = 0;
    const held = new Set<string>();
    let shiftHeld = false;
    let wheeled = { surface: "", sum: 0, at: 0 };

    const shownMap = () => {
      const { draftMap, map } = store.get();
      return draftMap ?? map;
    };

    // The map as the frame shows it, with the opened doors and lifts where
    // they stand. What a press means is read from this one, and edits go to
    // the map itself.
    const viewMap = () => {
      const map = shownMap();
      const { assets, opened } = store.get();
      return map ? withMovers(map, opened, heightsOf(assets)) : null;
    };

    // A door or lift that is gone, or no longer one, stops being shown open.
    context.onOptions(({ map }) => {
      const { opened } = store.get();
      if (!map || opened.length === 0) return;
      const still = opened.filter((id) => getIsMover(map, id));
      if (still.length < opened.length) store.set({ opened: still });
    });

    const cameraState = () => context.options().camera;

    // The camera as the frame sees it: a flight height kept inside the room
    // the camera now stands in, wherever it was flown to before.
    const eyeCamera = (map: GameMap) => {
      const view = cameraState();
      if (!view) return null;
      const { position } = view;
      return { ...position, lift: liftOf(map, position) };
    };

    // Walking keeps the eye at standing height, and flying keeps it where it
    // was flown to, inside the room it is in.
    const liftOf = (map: GameMap, position: Camera) =>
      store.get().view.flying
        ? liftWithin(map, position, position.lift ?? 0)
        : 0;

    const changeView = (next: Partial<SceneView>) => {
      const view = { ...store.get().view, ...next };
      store.set({ view });
      context.options().onViewChange?.(view);
    };
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
        picked,
        opened,
        view: shown,
      } = store.get();
      const view = cameraState();
      const output = canvas?.getContext("2d");
      if (!map || !assets || !view || !target || !image || !output) return;
      // Setting a canvas's size clears it, so the size changes only here,
      // right before the frame that fills it.
      if (output.canvas.width !== target.width) {
        output.canvas.width = target.width;
      }
      if (output.canvas.height !== target.height) {
        output.canvas.height = target.height;
      }
      view.sync(map, draftMap !== null);
      renderScene(
        target,
        map,
        {
          ...(eyeCamera(viewMap() ?? map) ?? view.position),
          eye: frozenEye ?? undefined,
        },
        {
          assets,
          hovered: placing ? null : hovered,
          selected: selected ?? linked,
          ghost:
            placing && ghost
              ? { ...ghost, kind: placing, type: context.options().placingType }
              : null,
          sky,
          picked,
          opened,
          fullbright: shown.fullbright,
          things: shown.things,
          customSprites: context.options().customSprites,
        },
      );
      output.putImageData(image, 0, 0);
      // The crosshair takes the page's text color.
      if (store.get().looking && canvas) {
        drawCrosshair(output, target, getComputedStyle(canvas).color);
        // What the crosshair is over changes as the camera turns or walks,
        // so it is read again from each frame.
        const middle =
          Math.floor(target.height / 2) * target.width +
          Math.floor(target.width / 2);
        const aimed = target.surfaces[target.pick[middle]] || null;
        if (aimed !== store.get().hovered || store.get().ghost) {
          store.set({ hovered: aimed, ghost: null });
        }
      }
    };

    const turnView = (dx: number, dy: number) => {
      const view = cameraState();
      if (!view) return;
      view.position = {
        ...view.position,
        angle: view.position.angle - dx * lookTurn,
        pitch: Math.max(
          -mostTilt,
          Math.min(mostTilt, (view.position.pitch ?? 0) - dy * lookTilt),
        ),
      };
      view.walked = true;
    };

    const scheduleDraw = () => {
      drawFrame ||= requestAnimationFrame(draw);
    };

    // Where the pointer is, or the middle of the view while the mouse looks.
    const aimAt = (event: MouseEvent) => {
      if (!canvas) return { x: 0, y: 0 };
      const box = canvas.getBoundingClientRect();
      return store.get().looking
        ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
        : { x: event.clientX, y: event.clientY };
    };

    const surfaceAt = (event: MouseEvent) => {
      if (!canvas || !target) return null;
      const box = canvas.getBoundingClientRect();
      const aim = aimAt(event);
      const x = Math.floor(((aim.x - box.left) / box.width) * target.width);
      const y = Math.floor(((aim.y - box.top) / box.height) * target.height);
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
      const aim = aimAt(event);
      return {
        x: ((aim.x - box.left) / box.width) * target.width,
        y: ((aim.y - box.top) / box.height) * target.height,
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
        eyeCamera(map) ?? view.position,
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
      const added = addThing(
        map,
        placing,
        point,
        facing,
        1,
        context.options().placingType,
      );
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
      const eye = eyeCamera(shown) ?? view.position;
      const feet = projectPoint(target, shown, eye, thing, plane);
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
            eye,
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
      if (store.get().picked.length > 0) context.options().onPickedChange?.([]);
    };

    // Shift adds a surface to the ones picked, or takes it out again. The
    // selected surface starts the list, so the first two picked are a pair.
    const pick = (key: string) => {
      const { picked, selected } = store.get();
      const list =
        picked.length === 0 && selected && selected !== key
          ? [selected]
          : picked;
      context
        .options()
        .onPickedChange?.(
          list.includes(key)
            ? list.filter((item) => item !== key)
            : [...list, key],
        );
    };

    const aimed = () => {
      const { hovered, selected } = store.get();
      return hovered ?? selected;
    };

    // A press on a picked surface acts on every one picked, and a press
    // anywhere else on that surface alone.
    const pressTargets = (key: string) => {
      const { picked } = store.get();
      return picked.includes(key) ? picked : [key];
    };

    // A key acts on the surfaces picked, or else on the one given.
    const keyTargets = (key: string | null) => {
      const { picked } = store.get();
      if (picked.length > 0) return picked;
      return key ? [key] : [];
    };

    const paste = (keys: string[], event: Event) => {
      const { map } = store.get();
      const { look } = context.options();
      if (!map || !look) return;
      const painted = keys.reduce(
        (next, key) => applyLook(next, key, look),
        map,
      );
      if (painted !== map) change("map", painted, { reason: "paint", event });
    };

    const flood = (key: string | null, event: Event) => {
      const { map } = store.get();
      const { look } = context.options();
      if (!map || look?.kind !== "wall") return false;
      const flooded = floodWalls(map, key, look.texture);
      if (flooded === map) return false;
      change("map", flooded, { reason: "paint", event });
      return true;
    };

    // Arrows move a texture the way they point: a step, 8 with Shift and the
    // grid with Ctrl or ⌘.
    const moveTextures = (event: KeyboardEvent) => {
      const { map, picked, selected } = store.get();
      const direction = {
        ArrowLeft: { x: 1, y: 0 },
        ArrowRight: { x: -1, y: 0 },
        ArrowUp: { x: 0, y: 1 },
        ArrowDown: { x: 0, y: -1 },
      }[event.key];
      if (!map || !direction || event.altKey) return false;
      const sides = wallSides(
        map,
        picked.length > 0 ? picked : selected ? [selected] : [],
      );
      if (sides.length === 0) return false;
      event.preventDefault();
      const step =
        event.metaKey || event.ctrlKey ? grid() : event.shiftKey ? 8 : 1;
      const moved = sides.reduce((next, { wall, sector }) => {
        const side = next.lines?.[wall]?.sides?.[sector];
        const offsetX = clampOffset((side?.offsetX ?? 0) + direction.x * step);
        const offsetY = clampOffset((side?.offsetY ?? 0) + direction.y * step);
        if (
          offsetX === (side?.offsetX ?? 0) &&
          offsetY === (side?.offsetY ?? 0)
        ) {
          return next;
        }
        return updateLineSide(next, wall, sector, {
          offsetX: offsetX || undefined,
          offsetY: offsetY || undefined,
        });
      }, map);
      if (moved !== map) change("map", moved, { reason: "offset-key", event });
      return true;
    };

    // U and L turn upper and lower pegging on for the walls, or off when
    // every one has it already.
    const togglePegging = (
      event: KeyboardEvent,
      flag: "upperFixed" | "lowerFixed",
    ) => {
      const { map } = store.get();
      if (!map) return;
      const walls = [
        ...new Set(wallSides(map, keyTargets(aimed())).map((s) => s.wall)),
      ];
      if (walls.length === 0) return;
      event.preventDefault();
      // Door tracks and switches are pegged to the floor unless a line says
      // otherwise, so their flag is left unset while it matches that.
      const byDefault = (wall: string) =>
        flag === "lowerFixed" && getIsPeggedByDefault(map, wall);
      const isPegged = (wall: string) =>
        map.lines?.[wall]?.[flag] ?? byDefault(wall);
      const value = !walls.every(isPegged);
      const pegged = walls.reduce((next, wall) => {
        if (isPegged(wall) === value) return next;
        const flagValue = value === byDefault(wall) ? undefined : value;
        return updateLine(next, wall, { [flag]: flagValue });
      }, map);
      if (pegged !== map) change("map", pegged, { reason: "peg-key", event });
    };

    const resetOffsets = (event: KeyboardEvent) => {
      const { map } = store.get();
      if (!map) return;
      const sides = wallSides(map, keyTargets(aimed()));
      if (sides.length === 0) return;
      event.preventDefault();
      const reset = sides.reduce((next, { wall, sector }) => {
        const side = next.lines?.[wall]?.sides?.[sector];
        return side?.offsetX || side?.offsetY
          ? updateLineSide(next, wall, sector, {
              offsetX: undefined,
              offsetY: undefined,
            })
          : next;
      }, map);
      if (reset !== map) change("map", reset, { reason: "offset-key", event });
    };

    const alignAimed = (event: KeyboardEvent, axis: "x" | "y") => {
      const { map, assets } = store.get();
      if (!map) return;
      event.preventDefault();
      const info = describeSurface(map, aimed());
      if (info?.surface.kind !== "wall" || !info.sector) return;
      const aligned = alignWalls(
        map,
        info.sector.id,
        info.surface.wall,
        (name) => {
          const picture = assets?.texture(name);
          return (axis === "x" ? picture?.width : picture?.height) ?? 1;
        },
        axis,
      );
      if (aligned !== map) change("map", aligned, { reason: "paint", event });
    };

    // A wall's texture follows the pointer: a drag to the right or down moves
    // the picture that way, which takes its offsets down.
    const dragOffsets = (
      event: PointerEvent,
      key: string,
      distance: number,
      onTap?: () => void,
    ) => {
      const { map } = store.get();
      const info = map ? describeSurface(map, key) : null;
      if (!canvas || !target || !map || !info?.sector) return false;
      if (info.paints !== "wall" || info.surface.kind !== "wall") return false;
      const { wall } = info.surface;
      const sector = info.sector.id;
      const side = map.lines?.[wall]?.sides?.[sector];
      const unitsPerPixel =
        ((distance / target.focal) * target.width) /
        canvas.getBoundingClientRect().width;
      const start = { x: event.clientX, y: event.clientY };
      let moved = false;
      let started = false;
      stopDrag = bindDrag(canvas, event, {
        threshold: dragThreshold,
        cancelOnEscape: true,
        onStart: () => {
          dragging = true;
          started = true;
        },
        onMove: ({ x, y, event: move }) => {
          shiftHeld = move.shiftKey;
          const offsetX = clampOffset(
            (side?.offsetX ?? 0) - (x - start.x) * unitsPerPixel,
          );
          const offsetY = clampOffset(
            (side?.offsetY ?? 0) - (y - start.y) * unitsPerPixel,
          );
          moved =
            offsetX !== (side?.offsetX ?? 0) ||
            offsetY !== (side?.offsetY ?? 0);
          const shifted = updateLineSide(map, wall, sector, {
            offsetX: offsetX || undefined,
            offsetY: offsetY || undefined,
          });
          // With Shift held the walls beside this one follow, so the texture
          // stays unbroken along the room as it moves.
          store.set({
            draftMap: shiftHeld
              ? alignWalls(
                  shifted,
                  sector,
                  wall,
                  (name) => store.get().assets?.texture(name).width ?? 1,
                )
              : shifted,
          });
        },
        onEnd: (end, canceled) => {
          const { draftMap } = store.get();
          stopDrag = undefined;
          dragging = false;
          store.set({ draftMap: null });
          if (!canceled && moved && draftMap) {
            change("map", draftMap, { reason: "offset-drag", event: end });
          }
          if (!canceled && !started) onTap?.();
        },
      });
      return true;
    };

    // A door or lift shown open isn't at the height the map holds for it, so
    // its height waits until it is shut again.
    const getCanMoveHeight = (key: string | null) => {
      const { map, opened, assets } = store.get();
      const info = map ? describeSurface(map, key) : null;
      return (
        info?.height != null &&
        !(
          map &&
          info.sector &&
          movedRooms(map, opened, heightsOf(assets)).has(info.sector.id)
        )
      );
    };

    // Page Up and Page Down move the selected floors and ceilings a grid
    // step, or with Shift to the next height of a room beside each, and with
    // Alt change their rooms' light, as in the map.
    const nudge = (event: KeyboardEvent, direction: 1 | -1) => {
      const { map, selected } = store.get();
      const keys = keyTargets(selected);
      if (!map || keys.length === 0) return;
      if (event.altKey) {
        const sectors = new Set(
          keys.flatMap((key) => describeSurface(map, key)?.sector?.id ?? []),
        );
        const lit = [...sectors].reduce((next, id) => {
          const sector = next.sectors.find((item) => item.id === id);
          if (!sector) return next;
          const light = lightOf(sector.light + direction * lightStep);
          return light === sector.light
            ? next
            : updateSector(next, id, { light });
        }, map);
        if (lit !== map) change("map", lit, { reason: "height-key", event });
        return;
      }
      const moved = keys.reduce((next, key) => {
        if (!getCanMoveHeight(key)) return next;
        if (!event.shiftKey) {
          return moveSurfaceHeight(next, key, direction * grid());
        }
        const level = heightBeside(next, key, direction);
        const height = describeSurface(next, key)?.height;
        return level === null || height == null
          ? next
          : moveSurfaceHeight(next, key, level - height);
      }, map);
      if (moved !== map) change("map", moved, { reason: "height-key", event });
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
        const map = viewMap();
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
        const rise = Number(pressed("Space")) - Number(pressed("KeyC"));
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
        // Flying up or down leaves the floor behind.
        if (rise !== 0 && !store.get().view.flying) {
          changeView({ flying: true });
        }
        const { flying } = store.get().view;
        const from = { x: view.position.x, y: view.position.y };
        const spot = flying
          ? sectorAt(map, next)
            ? next
            : from
          : walkStep(map, from, next);
        view.position = {
          ...view.position,
          ...spot,
          angle,
          // The height flown to is kept as it is while flying on, so a low
          // room on the way doesn't bring the eye down for good.
          lift:
            !flying || rise === 0
              ? view.position.lift
              : liftWithin(
                  map,
                  spot,
                  liftWithin(map, spot, view.position.lift ?? 0) +
                    rise * riseSpeed * seconds,
                ),
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
        const onLock = () => {
          const locked = document.pointerLockElement === element;
          // A lock asked for before the view lost focus lands too late.
          if (locked && document.activeElement !== element) {
            document.exitPointerLock();
            return;
          }
          store.set({ looking: locked });
        };
        document.addEventListener("pointerlockchange", onLock);
        // The picture takes the shape of the panel, as many rows as asked for
        // and as many columns as that shape needs, so nothing is letterboxed.
        const resized = new ResizeObserver(() => {
          const rows = store.get().height;
          const wide = element.clientWidth / (element.clientHeight || 1);
          if (!element.clientWidth || !element.clientHeight) return;
          const columns = Math.max(
            minColumns,
            Math.min(maxColumns, Math.round(rows * wide)),
          );
          if (columns === store.get().width) return;
          store.set({ width: columns });
          target = createRenderTarget(columns, rows);
          image = new ImageData(target.pixels, columns, rows);
          scheduleDraw();
        });
        resized.observe(element);
        scheduleDraw();
        return () => {
          stopStore();
          stopCamera?.();
          stopDraft?.();
          document.removeEventListener("pointerlockchange", onLock);
          resized.disconnect();
          if (document.pointerLockElement === element) {
            document.exitPointerLock();
          }
          canvas = null;
          target = null;
          image = null;
        };
      },
      pointermove(event: PointerEvent) {
        const view = cameraState();
        if (store.get().looking && view) {
          turnView(event.movementX, event.movementY);
          const hovered = surfaceAt(event)?.key ?? null;
          if (hovered !== store.get().hovered) store.set({ hovered });
          return;
        }
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
        // Some systems ask for the menu as the right button goes down, so it
        // waits to see whether the press drags to look instead, and others
        // ask once it comes up, after a drag that already looked.
        if (rightPress || performance.now() < quietMenuUntil) {
          event.preventDefault();
          event.stopPropagation();
          if (rightPress)
            rightPress.menu = { x: event.clientX, y: event.clientY };
          quietMenuUntil = 0;
          return;
        }
        // A menu needs the pointer back.
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        reportContext(event);
      },
      pointerdown(event: PointerEvent) {
        touchPress = null;
        if (event.pointerType === "touch") {
          touchPress = { x: event.clientX, y: event.clientY };
          reportContext(event);
        }
        // The middle button pastes the copied look, and with Shift floods it
        // along joined walls.
        if (event.button === 1 && canvas) {
          event.preventDefault();
          canvas.focus({ preventScroll: true });
          const key = surfaceAt(event)?.key ?? null;
          if (!key) return;
          if (event.shiftKey) flood(key, event);
          else paste(pressTargets(key), event);
          return;
        }
        // Dragging with the right button turns and tilts the view, and a
        // click of it still opens the menu.
        if (event.button === 2 && event.pointerType === "mouse" && canvas) {
          const element = canvas;
          element.focus({ preventScroll: true });
          const press = { dragged: false, menu: null as Point | null };
          rightPress = press;
          let last = { x: event.clientX, y: event.clientY };
          stopDrag = bindDrag(element, event, {
            threshold: dragThreshold,
            onStart: () => {
              press.dragged = true;
            },
            onMove: ({ x, y }) => {
              turnView(x - last.x, y - last.y);
              last = { x, y };
            },
            onEnd: () => {
              stopDrag = undefined;
              rightPress = null;
              if (press.dragged) {
                quietMenuUntil = performance.now() + menuAfterDragMs;
                // The button may come up over another part of the page.
                const swallow = (menu: Event) => {
                  if (performance.now() < quietMenuUntil) {
                    menu.preventDefault();
                    menu.stopPropagation();
                  }
                };
                document.addEventListener("contextmenu", swallow, {
                  capture: true,
                  once: true,
                });
                setTimeout(
                  () =>
                    document.removeEventListener("contextmenu", swallow, {
                      capture: true,
                    }),
                  menuAfterDragMs,
                );
              } else if (press.menu) {
                element.dispatchEvent(
                  new MouseEvent("contextmenu", {
                    bubbles: true,
                    cancelable: true,
                    button: 2,
                    clientX: press.menu.x,
                    clientY: press.menu.y,
                  }),
                );
              }
            },
          });
          return;
        }
        if (event.button !== 0 || getIsSecondaryPress(event)) return;
        if (!canvas || !target) return;
        canvas.focus({ preventScroll: true });
        const hit = surfaceAt(event);
        const key = hit?.key ?? null;
        const surface = key ? parseSurface(key) : null;
        // While the mouse looks, a click acts on the crosshair's surface and
        // drags nothing.
        if (store.get().looking) {
          if (store.get().placing && surface?.kind !== "thing") {
            const point = floorPointAt(event);
            if (point) place(point, "press", event);
          } else if (key && event.altKey) paste(pressTargets(key), event);
          else if (key && event.shiftKey) pick(key);
          else select(key, "press");
          return;
        }
        if (store.get().placing && surface?.kind !== "thing") {
          const point = floorPointAt(event);
          if (point) place(point, "press", event);
          return;
        }
        if (key && surface?.kind !== "thing") {
          // Alt paints the copied look on. Shift picks several surfaces with
          // a click, and aligns the walls beside one with a drag.
          if (event.altKey) {
            paste(pressTargets(key), event);
            return;
          }
          if (event.shiftKey) {
            shiftHeld = true;
            const onTap = () => pick(key);
            if (!hit || !dragOffsets(event, key, hit.distance, onTap)) onTap();
            return;
          }
        }
        select(key, "press");
        const { map } = store.get();
        if (surface?.kind === "thing") {
          if (!store.get().placing) dragThing(event, surface.thing);
          return;
        }
        if (hit && key && surface?.kind === "wall") {
          dragOffsets(event, key, hit.distance);
          return;
        }
        if (!hit || !key || !map || !getCanMoveHeight(key)) return;

        const view = cameraState();
        const shown = viewMap();
        const owner = view && shown ? sectorAt(shown, view.position) : null;
        const flown = shown && view ? liftOf(shown, view.position) : 0;
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
              frozenEye: owner ? owner.floor + standingEye + flown : null,
            });
          },
          onMove: ({ y }) => {
            const units = (startY - y) * rowsPerPixel * unitsPerRow;
            const delta = Math.round(units / gridSize) * gridSize;
            const draftMap = moveSurfaceHeight(map, key, delta);
            moved = draftMap !== map;
            store.set({ draftMap });
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
      wheel(event: WheelEvent) {
        const { map, hovered } = store.get();
        // Only a view that was clicked into takes the wheel, so scrolling the
        // page over it changes nothing.
        if (!map || !hovered || stopDrag || document.activeElement !== canvas) {
          return;
        }
        const info = describeSurface(map, hovered);
        if (!info?.sector) return;
        event.preventDefault();
        // With Shift held, most browsers report a mouse wheel's turn sideways.
        const delta = event.shiftKey
          ? event.deltaY || event.deltaX
          : event.deltaY;
        const { notches, ...turns } = countNotches(
          wheeled.surface === hovered ? wheeled : { sum: 0, at: 0 },
          delta,
          event.deltaMode,
          event.timeStamp,
        );
        wheeled = { ...turns, surface: hovered };
        if (notches === 0) return;
        // The wheel moves a floor or ceiling a grid step a notch, or one
        // unit with Shift, and with Alt it makes the surface's room a step
        // brighter or darker. Over a picked surface it moves every one picked.
        const keys = pressTargets(hovered);
        let next = map;
        if (event.altKey) {
          const sectors = new Set(
            keys.flatMap((key) => describeSurface(map, key)?.sector?.id ?? []),
          );
          for (const id of sectors) {
            const sector = next.sectors.find((item) => item.id === id);
            const light = sector
              ? lightOf(sector.light - notches * lightStep)
              : null;
            if (sector && light !== null && light !== sector.light) {
              next = updateSector(next, id, { light });
            }
          }
        } else {
          const step = event.shiftKey ? 1 : grid();
          for (const key of keys) {
            if (getCanMoveHeight(key)) {
              next = moveSurfaceHeight(next, key, -notches * step);
            }
          }
        }
        if (next !== map) change("map", next, { reason: "wheel", event });
      },
      keydown(event: KeyboardEvent) {
        if (event.key === "Shift") shiftHeld = true;
        // Keys still walk and fly while the right button looks around.
        if ((stopDrag && !rightPress) || openMenuFromKey(event)) return;
        const { map, placing } = store.get();
        const thing = selectedThing();
        if (event.altKey && nudgeThing(event)) return;
        const command = event.metaKey || event.ctrlKey;
        const { look, pasteLook = true } = context.options();
        const letter = letterOf(event);
        // A surface's look is copied and pasted here. Anything else, like a
        // selected thing, is left to the page's own copy and paste.
        if (command && map && letter === "c" && !thing) {
          const copied = lookOf(map, aimed());
          if (copied) {
            // The page's copy runs next and puts the look on the clipboard,
            // once and not for every repeat of the key.
            if (event.repeat) event.preventDefault();
            else context.options().onLookChange?.(copied);
            return;
          }
        }
        // While the look is the last thing copied, the page's paste of an
        // older piece is kept out even where the look doesn't fit.
        if (command && look && pasteLook && letter === "v") {
          event.preventDefault();
          if (!event.repeat) paste(keyTargets(aimed()), event);
          return;
        }
        const keys = currentKeys();
        const pressed = (name: EditorShortcut) =>
          matchesShortcut(event, keys[name]);
        if (pressed("sceneFlood") && map && look?.kind === "wall") {
          if (flood(aimed(), event)) event.preventDefault();
          return;
        }
        if (moveTextures(event)) return;
        if (!event.repeat) {
          const { view } = store.get();
          if (pressed("sceneFly")) {
            event.preventDefault();
            changeView({ flying: !view.flying });
            return;
          }
          if (pressed("sceneFullbright")) {
            event.preventDefault();
            changeView({ fullbright: !view.fullbright });
            return;
          }
          if (pressed("sceneThings")) {
            event.preventDefault();
            changeView({ things: !view.things });
            return;
          }
          if (pressed("scenePegUpper")) {
            togglePegging(event, "upperFixed");
            return;
          }
          if (pressed("scenePegLower")) {
            togglePegging(event, "lowerFixed");
            return;
          }
        }
        if (pressed("sceneResetOffsets")) {
          resetOffsets(event);
          return;
        }
        if (pressed("sceneAlignRows")) {
          alignAimed(event, "y");
          return;
        }
        if (pressed("sceneLook") && !event.repeat && canvas) {
          event.preventDefault();
          if (store.get().looking) document.exitPointerLock();
          else void canvas.requestPointerLock()?.catch?.(() => undefined);
          return;
        }
        if (pressed("sceneAlignAlong") && map) {
          alignAimed(event, "x");
          return;
        }
        if (thing && map && (event.key === "," || event.key === ".")) {
          event.preventDefault();
          const turn = event.key === "," ? thingTurn : -thingTurn;
          change(
            "map",
            updateThing(map, thing.id, {
              angle: (((thing.angle + turn) % 360) + 360) % 360,
            }),
            { reason: "thing-key", event },
          );
          return;
        }
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
        } else if (!command && walkKeys.test(event.code)) {
          event.preventDefault();
          held.add(event.code);
          if (!walkFrame) walk(performance.now());
        } else if (pressed("sceneOpen") && map && !event.repeat) {
          // The door or lift under the pointer, or else the selected one,
          // stands open until the key is pressed on it again.
          const { hovered, selected, opened, assets } = store.get();
          const heights = heightsOf(assets);
          const mover =
            moverAt(map, hovered, heights) ?? moverAt(map, selected, heights);
          if (!mover) return;
          event.preventDefault();
          store.set({
            opened: opened.includes(mover)
              ? opened.filter((id) => id !== mover)
              : [...opened, mover],
          });
        } else if (pressed("sceneNext") || pressed("scenePrevious")) {
          event.preventDefault();
          cycle(pressed("sceneNext") ? 1 : -1);
        } else if (event.key === "PageUp" || event.key === "PageDown") {
          event.preventDefault();
          nudge(event, event.key === "PageUp" ? 1 : -1);
        } else if (event.key === "Escape") {
          select(null, "key");
        }
      },
      keyup(event: KeyboardEvent) {
        if (event.key === "Shift") shiftHeld = false;
        held.delete(event.code);
      },
      blur() {
        shiftHeld = false;
        held.clear();
        if (document.pointerLockElement === canvas) document.exitPointerLock();
      },
    };
  },
  slots: (slot) => ({
    root: slot({
      attrs: () => ({
        tabindex: "0",
        "aria-roledescription": "3D map editor",
      }),
      live: live<SceneState, unknown, {}>((state) => {
        const surface = state.hovered ? parseSurface(state.hovered) : null;
        if (state.looking) return { "data-hover": "look" };
        let hover: string | undefined;
        if (state.ghost) hover = "place";
        else if (surface?.kind === "thing") hover = "thing";
        else if (state.placing) hover = undefined;
        else if (
          (surface?.kind === "floor" || surface?.kind === "ceiling") &&
          !(
            state.map &&
            movedRooms(state.map, state.opened, heightsOf(state.assets)).has(
              surface.sector,
            )
          )
        ) {
          hover = "height";
        } else if (surface) hover = "surface";
        return { "data-hover": hover };
      }),
      bind: (el, { api }) => api.attach(el),
      on: {
        pointermove: (event, { api }) => api.pointermove(event),
        pointerleave: (_event, { api }) => api.pointerleave(),
        pointerdown: (event, { api }) => api.pointerdown(event),
        // A press of the middle button pastes rather than scrolling the page.
        mousedown: (event) => {
          if (event.button === 1) event.preventDefault();
        },
        wheel: (event, { api }) => api.wheel(event),
        contextmenu: (event, { api }) => api.contextmenu(event),
        keydown: (event, { api }) => api.keydown(event),
        keyup: (event, { api }) => api.keyup(event),
        blur: (_event, { api }) => api.blur(),
      },
    }),
  }),
  agent: { shown: () => false },
});

// The letter a key types, or the one printed on it where the layout types no
// Latin letter, which is how the browser's own copy and paste keys go.
function letterOf(event: KeyboardEvent) {
  return /^[a-z]$/i.test(event.key)
    ? event.key.toLowerCase()
    : event.code.slice(3).toLowerCase();
}

// A switch's wall and a door's track are pegged to the floor when the line
// leaves it unset, as the compiler writes them.
function getIsPeggedByDefault(map: GameMap, wall: string) {
  const owners = wallOwners(map).get(wall) ?? [];
  if (owners.length !== 1) return false;
  return (
    Boolean(owners[0].door) ||
    map.switches.some((item) => wallKey(item.from, item.to) === wall)
  );
}

// The room sides of the walls among `keys`, once each.
function wallSides(map: GameMap, keys: string[]) {
  const sides = new Map<string, { wall: string; sector: string }>();
  for (const key of keys) {
    const surface = parseSurface(key);
    if (surface?.kind !== "wall") continue;
    if (!map.sectors.some((item) => item.id === surface.sector)) continue;
    sides.set(`${surface.sector}:${surface.wall}`, surface);
  }
  return [...sides.values()];
}

// A side's offsets serve its upper, lower and middle parts at once, each with
// a picture of its own size, so an offset is kept as dragged and not wrapped.
const offsetLimit = 32767;

function clampOffset(value: number) {
  return Math.max(-offsetLimit, Math.min(offsetLimit, Math.round(value)));
}

const minColumns = 64;
const maxColumns = 1600;

const lightLimit = 255;

function lightOf(value: number) {
  return Math.max(0, Math.min(lightLimit, value));
}

const standingEye = 41;

// How close the eye comes to a floor or a ceiling while flying.
const eyeRoom = 8;

// How far above standing height the eye may fly in the room at a spot, kept
// clear of its floor and ceiling.
function liftWithin(map: GameMap, point: Point, lift: number) {
  const room = sectorAt(map, point);
  if (!room) return lift;
  const lowest = eyeRoom - standingEye;
  const highest = Math.max(
    lowest,
    room.ceiling - room.floor - eyeRoom - standingEye,
  );
  return Math.max(lowest, Math.min(highest, lift));
}

function drawCrosshair(
  output: CanvasRenderingContext2D,
  target: RenderTarget,
  color: string,
) {
  const x = Math.floor(target.width / 2);
  const y = Math.floor(target.height / 2);
  output.fillStyle = color;
  output.fillRect(x - 6, y, 13, 1);
  output.fillRect(x, y - 6, 1, 13);
}

function heightsOf(assets: SceneAssets | null) {
  return assets ? textureHeightOf(assets) : undefined;
}

function standable(map: GameMap, point: Point) {
  const sector = sectorAt(map, point);
  return !!sector && !sector.door;
}

export const { Root: SceneCanvas } = createParts(sceneEditor, {
  root: "canvas",
});
