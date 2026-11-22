import {
  bindDrag,
  type ChangeDetails,
  type ConnectDraft,
  createChange,
  createConnect,
  createMove,
  createViewport,
  css,
  definePrimitive,
  dragThreshold,
  live,
  type MoveDraft,
  selects,
  type Viewport,
} from "@ui-sdk/core";
import { createParts } from "@ui-sdk/react/primitive";
import * as React from "react";

import type { GameMap, Point, Sector, ThingKind } from "@/lib/map/types";
import type { CheckContext } from "@/lib/map/validate";
import type { Camera } from "@/lib/preview/render";
import type { SceneCamera } from "@/lib/preview/scene-camera";

import { defined } from "@/lib/defined";
import {
  agentActionNames,
  type AgentOutcome,
  runAgentAction,
} from "@/lib/editor/agent-actions";
import {
  getIsDragging,
  getIsKeyboardMenu,
  getIsSecondaryPress,
  type MapTarget,
  openMenuFromKey,
  targetForKeys,
  wallTarget,
} from "@/lib/editor/map-target";
import { getIsPlayerStart } from "@/lib/map/catalog";
import {
  addSwitch,
  addThing,
  applyPositions,
  doorKeyPrefix,
  freeWallNear,
  gridSize,
  mergeCorners,
  positionsOf,
  removeSwitch,
  roomCenter,
  snapPoint,
  splitWall,
  switchKeyPrefix,
  thingKeyPrefix,
  updateSwitch,
  wallNear,
} from "@/lib/map/edit";
import { partKeys, removeParts, selectedParts } from "@/lib/map/fragment";
import {
  type Box,
  boxOf,
  holeAt,
  loopsPath,
  sectorAt,
  sectorVertices,
  wallKey,
} from "@/lib/map/geometry";
import {
  drawLines,
  drawRoom,
  joinCornersToWalls,
  removeCorner,
} from "@/lib/map/reshape";
import { type DrawShape, shapeCorners } from "@/lib/map/shapes";

export type MapTool = "select" | "draw" | "line" | "thing" | "switch";
export type EditMode = "vertices" | "lines" | "sectors" | "things";
export interface MapViewStatus {
  pointer: Point | null;
  zoom: number;
  view: { left: number; top: number; right: number; bottom: number };
}

type MapChangeReason =
  | "drag"
  | "move-key"
  | "imperative"
  | "draw"
  | "place"
  | "delete"
  | "connect-key"
  | "agent";

export type AgentReport = Omit<AgentOutcome, "map">;

interface MapEditorOptions {
  map?: GameMap;
  tool?: MapTool;
  editMode?: EditMode;
  onWallSelect?: (sector: string, wall: string) => void;
  onViewChange?: (status: MapViewStatus) => void;
  thingKind?: ThingKind;
  activeSector?: string | null;
  selection?: string[];
  onMapChange?: (map: GameMap, details: ChangeDetails<MapChangeReason>) => void;
  onToolChange?: (tool: MapTool, details: ChangeDetails<"draw">) => void;
  onActiveSectorChange?: (
    sector: string | null,
    details: ChangeDetails<"select">,
  ) => void;
  onSelectionChange?: (
    selection: string[],
    details: ChangeDetails<"select">,
  ) => void;
  onDraftMapChange?: (map: GameMap | null) => void;
  onMapSelect?: () => void;
  camera?: SceneCamera;
  highlightedWall?: string | null;
  findCameraRequest?: number;
  fitRequest?: number;
  drawRequest?: { id: number; point: Point } | null;
  focusRequest?: { id: number; point: Point } | null;
  lookAtRequest?: { id: number; clientX: number; clientY: number } | null;
  onContextTarget?: (target: MapTarget | null) => void;
  // An agent's edit landed: which action, what was fixed on the way and what
  // the map still needs.
  onAgentAction?: (action: string, outcome: AgentReport) => void;
  // The game's texture names, so an agent's edit can't use one it lacks.
  checkContext?: CheckContext;
  onDrawingChange?: (corners: number) => void;
  contextMenuOpen?: boolean;
  grid?: number;
  drawShape?: DrawShape;
  drawSides?: number;
}

interface MapEditorState {
  map: GameMap;
  positions: Record<string, Point>;
  viewport: Viewport;
  moving: MoveDraft | null;
  connecting: ConnectDraft | null;
  tool: MapTool;
  editMode: EditMode;
  thingKind: ThingKind;
  activeSector: string | null;
  selection: string[];
  drawing: Point[];
  cursor: Point | null;
  cameraPosition: Camera | null;
  highlightedWall: string | null;
  marquee: Box | null;
  drawShape: DrawShape;
  drawSides: number;
  grid: number;
}

const emptyMap: GameMap = {
  vertices: {},
  sectors: [],
  things: [],
  switches: [],
};

const clickSlop = 4;
const switchReach = 32;
const cameraNudge = 16;
const arrowSteps: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};
const wallReach = 14;
const defaultSides = 8;

interface LiveApi {
  viewport: ReturnType<typeof createViewport<MapEditorState>>;
  move: ReturnType<typeof createMove<MapEditorState>>;
  connect: ReturnType<typeof createConnect<MapEditorState>>;
}

interface KeyedProps {
  value: string;
}
interface SectorProps {
  value: string;
  corners: string[];
  holes?: string[][];
  door: boolean;
}
interface WallProps {
  value: string;
  from: string;
  to: string;
}
interface LabelProps {
  value: string;
  corners: string[];
}

const none: readonly never[] = [];

// A key a slot reads in full, so every change to it reaches all of its parts.
const whole = { values: () => none, moved: () => true };

// Every state key, as one a slot's parts never read. A slot's `selects` starts
// from this and names the keys its parts do read, and how, so a pan wakes no
// part and a drag wakes the parts of what it moves.
const readsNothing = {
  map: none,
  positions: none,
  viewport: none,
  moving: none,
  connecting: none,
  tool: none,
  editMode: none,
  thingKind: none,
  activeSector: none,
  selection: none,
  drawing: none,
  cursor: none,
  cameraPosition: none,
  highlightedWall: none,
  marquee: none,
  drawShape: none,
  drawSides: none,
  grid: none,
} satisfies Record<keyof MapEditorState, readonly never[]>;

export const mapEditor = definePrimitive({
  name: "map-editor",
  options: {
    map: "value",
    tool: "string",
    editMode: "string",
    onWallSelect: "callback",
    onViewChange: "callback",
    thingKind: "string",
    activeSector: "value",
    selection: "value",
    onMapChange: "callback",
    onToolChange: "callback",
    onActiveSectorChange: "callback",
    onSelectionChange: "callback",
    onDraftMapChange: "callback",
    onMapSelect: "callback",
    camera: "value",
    highlightedWall: "value",
    findCameraRequest: "number",
    fitRequest: "number",
    drawRequest: "value",
    focusRequest: "value",
    lookAtRequest: "value",
    onContextTarget: "callback",
    onAgentAction: "callback",
    checkContext: "value",
    onDrawingChange: "callback",
    contextMenuOpen: "boolean",
    grid: "number",
    drawShape: "string",
    drawSides: "number",
  },
  controlled: ["map", "tool", "activeSector", "selection"],
  state: (options: MapEditorOptions): MapEditorState => {
    const map = options.map ?? emptyMap;
    return {
      map,
      positions: positionsOf(map),
      viewport: { x: 0, y: 0, zoom: 1 },
      moving: null,
      connecting: null,
      tool: options.tool ?? "select",
      editMode: options.editMode ?? "vertices",
      thingKind: options.thingKind ?? "imp",
      activeSector: options.activeSector ?? null,
      selection: options.selection ?? [],
      drawing: [],
      cursor: null,
      cameraPosition: options.camera?.position ?? null,
      highlightedWall: options.highlightedWall ?? null,
      marquee: null,
      drawShape: options.drawShape ?? "outline",
      drawSides: options.drawSides ?? defaultSides,
      grid: options.grid ?? gridSize,
    };
  },
  sync: (options) => ({
    ...(options.map
      ? { map: options.map, positions: positionsOf(options.map) }
      : {}),
    ...(options.tool ? { tool: options.tool } : {}),
    ...(options.editMode ? { editMode: options.editMode } : {}),
    ...(options.thingKind ? { thingKind: options.thingKind } : {}),
    ...(options.activeSector !== undefined
      ? { activeSector: options.activeSector }
      : {}),
    ...(options.selection ? { selection: options.selection } : {}),
    highlightedWall: options.highlightedWall ?? null,
    drawShape: options.drawShape ?? "outline",
    drawSides: options.drawSides ?? defaultSides,
    grid: options.grid ?? gridSize,
  }),
  live: [
    "viewport",
    "moving",
    "connecting",
    "cursor",
    "drawing",
    "cameraPosition",
    "marquee",
  ],
  api: (context) => {
    const { store } = context;
    const change = createChange(context);
    const root = () => context.element("root");

    const viewport = createViewport<MapEditorState>(context, {
      key: "viewport",
      surface: root,
      minZoom: () => 0.1,
      maxZoom: () => 4,
    });

    const grid = () => context.options().grid ?? gridSize;

    // A drop lands the pressed item on the grid and carries the rest of the
    // selection by the same offset, so a shape drawn on a finer grid keeps its
    // form. The helper would round every item on its own.
    let dropping: string[] | null = null;
    // What a press on a selected room drags: its corners, the rooms inside it
    // and the things standing in them, whether or not each is selected.
    let carried: string[] | null = null;
    const move = createMove<MapEditorState>(context, {
      key: "positions",
      draft: "moving",
      step: () => (dropping ? 1 : grid()),
      largeStep: () => grid() * 8,
      scale: () => store.get().viewport.zoom,
      disabled: (key) =>
        store.get().tool !== "select" || key.startsWith(switchKeyPrefix),
      group: (key) => {
        if (carried?.[0] === key) return carried;
        const { selection } = store.get();
        return selection.includes(key)
          ? [key, ...selection.filter((item) => item !== key)]
          : [key];
      },
      set: (positions, details) => {
        const keys = dropping;
        dropping = null;
        const current = store.get().positions;
        const anchor = keys?.[0];
        let next = positions;
        if (details.reason === "drag" && keys && anchor && current[anchor]) {
          const at = snapPoint(positions[anchor], grid());
          const dx = at.x - current[anchor].x;
          const dy = at.y - current[anchor].y;
          if (dx === 0 && dy === 0) return false;
          next = { ...positions };
          for (const key of keys) {
            const from = current[key];
            if (from) next[key] = { x: from.x + dx, y: from.y + dy };
          }
        }
        const moved = applyPositions(store.get().map, next);
        // A corner dropped onto another, or onto a wall, joins it.
        const corners = (keys ?? []).filter(
          (key) => !key.startsWith(thingKeyPrefix),
        );
        const joined =
          details.reason === "drag" && corners.length > 0
            ? mergeCorners(joinCornersToWalls(moved, corners), corners)
            : moved;
        const done = change("map", joined, details);
        if (done && joined !== moved) select([]);
        return done;
      },
    });

    const connect = createConnect<MapEditorState>(context, {
      slot: "port",
      draft: "connecting",
      canConnect: (from, to) =>
        from.startsWith(switchKeyPrefix) && to.startsWith(doorKeyPrefix),
      point: (x, y) => viewport.toCanvas(x, y),
      label: (key) => {
        const { map } = store.get();
        if (key.startsWith(switchKeyPrefix)) return "Switch";
        const id = key.slice(doorKeyPrefix.length);
        return map.sectors.find((sector) => sector.id === id)?.name ?? "Door";
      },
      connect: (from, to, details) =>
        change(
          "map",
          updateSwitch(store.get().map, from.slice(switchKeyPrefix.length), {
            door: to.slice(doorKeyPrefix.length),
          }),
          details,
        ),
    });

    let lastCorners = 0;
    const stopCorners = store.subscribe(() => {
      const corners = store.get().drawing.length;
      if (corners === lastCorners) return;
      lastCorners = corners;
      context.options().onDrawingChange?.(corners);
    });
    context.onDestroy(stopCorners);

    let lastDraft: MoveDraft | null = null;
    const stopWatching = store.subscribe(() => {
      const { moving, map, positions } = store.get();
      if (moving === lastDraft) return;
      // The drop commits right after the draft clears; a cancelled drag
      // commits nothing, so the keys are let go once that moment has passed.
      if (!moving && lastDraft) {
        dropping = lastDraft.keys;
        carried = null;
        queueMicrotask(() => {
          dropping = null;
        });
      }
      lastDraft = moving;
      const { onDraftMapChange } = context.options();
      if (!moving) {
        onDraftMapChange?.(null);
        return;
      }
      const draft = Object.fromEntries(
        moving.keys.map((key) => [
          key,
          {
            x: positions[key].x + moving.dx,
            y: positions[key].y + moving.dy,
          },
        ]),
      );
      onDraftMapChange?.(applyPositions(map, { ...positions, ...draft }));
    });
    context.onDestroy(stopWatching);

    let press: { x: number; y: number } | null = null;
    let fitted = false;
    let reportPointer: ((point: Point | null) => void) | undefined;
    let findAfterFit = false;
    let focusAfterFit: Point | null = null;
    let stopCameraDrag: (() => void) | undefined;
    let findRequest = context.options().findCameraRequest ?? 0;
    let lookRequest = context.options().lookAtRequest?.id ?? 0;
    let fitRequest = context.options().fitRequest ?? 0;
    let drawRequest = context.options().drawRequest?.id ?? 0;
    let focusRequest = context.options().focusRequest?.id ?? 0;
    let touchPress: { event: PointerEvent; held: boolean } | null = null;
    let ignoreClick = false;

    const findCamera = () => {
      if (!fitted) {
        findAfterFit = true;
        return;
      }
      const surface = root();
      const camera = store.get().cameraPosition;
      if (!surface || !camera) return;
      const { zoom } = store.get().viewport;
      viewport.setViewport({
        x: surface.clientWidth / 2 - camera.x * zoom,
        y: surface.clientHeight / 2 - camera.y * zoom,
        zoom,
      });
    };

    context.onOptions((options) => {
      const request = options.findCameraRequest ?? 0;
      if (request === findRequest) return;
      findRequest = request;
      requestAnimationFrame(findCamera);
    });
    context.onOptions(({ lookAtRequest }) => {
      if (!lookAtRequest || lookAtRequest.id === lookRequest) return;
      lookRequest = lookAtRequest.id;
      moveCamera(
        viewport.toCanvas(lookAtRequest.clientX, lookAtRequest.clientY),
      );
    });
    context.onOptions((options) => {
      const request = options.fitRequest ?? 0;
      if (request === fitRequest) return;
      fitRequest = request;
      fitMap();
    });
    context.onOptions(({ contextMenuOpen }) => {
      if (!contextMenuOpen || !touchPress) return;
      const { event } = touchPress;
      touchPress = null;
      ignoreClick = true;
      event.target?.dispatchEvent(
        new PointerEvent("pointercancel", {
          bubbles: true,
          pointerId: event.pointerId,
          pointerType: "touch",
        }),
      );
    });
    const centerOn = (point: Point) => {
      const surface = root();
      if (!surface) return;
      const { zoom } = store.get().viewport;
      viewport.setViewport({
        x: surface.clientWidth / 2 - point.x * zoom,
        y: surface.clientHeight / 2 - point.y * zoom,
        zoom,
      });
    };
    context.onOptions(({ focusRequest: request }) => {
      if (!request || request.id === focusRequest) return;
      focusRequest = request.id;
      if (fitted) centerOn(request.point);
      else focusAfterFit = request.point;
    });
    context.onOptions(({ drawRequest: request }) => {
      if (!request || request.id === drawRequest) return;
      drawRequest = request.id;
      store.set({ drawing: [snapPoint(request.point, grid())], cursor: null });
      change("tool", "draw", { reason: "draw" });
    });
    context.onDestroy(() => stopCameraDrag?.());

    const moveCamera = (point: Point) =>
      context
        .options()
        .camera?.moveTo(store.get().map, snapPoint(point, grid()));

    const select = (selection: string[], sector: string | null = null) => {
      change("selection", selection, { reason: "select" });
      change("activeSector", sector, { reason: "select" });
      context.options().onMapSelect?.();
    };

    const pointFromEvent = (event: MouseEvent) => {
      const { x, y } = viewport.toCanvas(event.clientX, event.clientY);
      return snapPoint({ x, y }, grid());
    };

    const addDrawnRoom = (corners: Point[]) => {
      const room = drawRoom(store.get().map, corners, {}, 1);
      store.set({ drawing: [], cursor: null });
      change("map", room.map, { reason: "draw" });
      select([], room.id);
      change("tool", "select", { reason: "draw" });
    };

    const finishRoom = () => {
      const { drawing, drawShape } = store.get();
      if (drawShape === "outline" && drawing.length >= 3) addDrawnRoom(drawing);
    };

    // A line that no room can hold stays as a draft to adjust or throw away.
    const finishLine = () => {
      const { drawing, map } = store.get();
      const added = drawing.length >= 2 ? drawLines(map, drawing, 1) : null;
      if (!added) return;
      store.set({ drawing: [], cursor: null });
      change("map", added.map, { reason: "draw" });
      select([], added.rooms[0] ?? null);
      change("tool", "select", { reason: "draw" });
    };

    const clickLine = (point: Point) => {
      const { drawing } = store.get();
      const last = drawing.at(-1);
      if (last && last.x === point.x && last.y === point.y) {
        finishLine();
        return;
      }
      if (drawing.some((item) => item.x === point.x && item.y === point.y)) {
        return;
      }
      store.set({ drawing: [...drawing, point] });
    };

    const clickDraw = (point: Point) => {
      const { drawing, drawShape, drawSides } = store.get();
      const first = drawing[0];
      // A rectangle and a polygon take two clicks: where they start, and how
      // far they reach.
      if (drawShape !== "outline") {
        const corners =
          first && shapeCorners(drawShape, drawSides, first, point, grid());
        if (corners) addDrawnRoom(corners);
        else if (!first) store.set({ drawing: [point] });
        return;
      }
      if (
        first &&
        drawing.length >= 3 &&
        first.x === point.x &&
        first.y === point.y
      ) {
        finishRoom();
        return;
      }
      if (drawing.some((item) => item.x === point.x && item.y === point.y)) {
        return;
      }
      store.set({ drawing: [...drawing, point] });
    };

    const nudgeSelection = (event: KeyboardEvent) => {
      const direction = arrowSteps[event.key];
      if (!direction || event.altKey || event.ctrlKey || event.metaKey) {
        return false;
      }
      const { selection, positions } = store.get();
      const keys = selection.filter(
        (key) => key in positions && !key.startsWith(switchKeyPrefix),
      );
      if (keys.length === 0) return false;
      const by = event.shiftKey ? grid() * 8 : grid();
      move.moveBy(keys, direction.x * by, direction.y * by, {
        reason: "move-key",
        event,
      });
      return true;
    };

    // A selected line isn't its room, and a room left active in another mode
    // isn't what that mode works on.
    const pickedRoom = () => {
      const { activeSector, highlightedWall, editMode } = store.get();
      return !highlightedWall &&
        (editMode === "vertices" || editMode === "sectors")
        ? activeSector
        : null;
    };
    const pickedParts = () => {
      const { map, selection } = store.get();
      return selectedParts(map, selection, pickedRoom());
    };

    // Adding to a selection keeps the active room in it, as its corners.
    const withPickedRoom = () => {
      const { map, selection } = store.get();
      const room = map.sectors.find((sector) => sector.id === pickedRoom());
      return room
        ? [...new Set([...selection, ...sectorVertices(room)])]
        : selection;
    };

    const deleteSelection = () => {
      const { map, selection } = store.get();
      const switches = selection
        .filter((key) => key.startsWith(switchKeyPrefix))
        .map((key) => key.slice(switchKeyPrefix.length));
      const parts = pickedParts();
      // A player start outlives its room, so the checks can ask for a new
      // place for it.
      const things = parts.things.filter((id) => {
        const kind = map.things.find((thing) => thing.id === id)?.kind;
        return (
          selection.includes(`${thingKeyPrefix}${id}`) ||
          (kind !== undefined && !getIsPlayerStart(kind))
        );
      });
      // In corner mode, corners picked on their own, not as part of a whole
      // room, come out of their walls.
      const roomCorners = new Set(
        map.sectors
          .filter((sector) => parts.sectors.includes(sector.id))
          .flatMap(sectorVertices),
      );
      const corners =
        store.get().editMode === "vertices"
          ? selection.filter(
              (key) => map.vertices[key] && !roomCorners.has(key),
            )
          : [];
      if (
        things.length === 0 &&
        switches.length === 0 &&
        parts.sectors.length === 0 &&
        corners.length === 0
      ) {
        return false;
      }
      const removed = removeParts(switches.reduce(removeSwitch, map), {
        sectors: parts.sectors,
        things,
      });
      const next = corners.reduce(
        (current, id) => removeCorner(current, id) ?? current,
        removed,
      );
      if (next === map) return false;
      change("map", next, { reason: "delete" });
      select([]);
      return true;
    };

    // A corner added on the wall nearest the point, in corner and line mode.
    const insertCorner = (point: Point) => {
      const { map, editMode, viewport: view } = store.get();
      if (editMode !== "vertices" && editMode !== "lines") return false;
      const wall = wallNear(map, point, wallReach / view.zoom);
      const split = wall && splitWall(map, wall.wall, point, grid());
      if (!split) return false;
      change("map", split.map, { reason: "draw" });
      select([split.id]);
      return true;
    };
    let pointer: Point | null = null;

    // Shift and a drag over the map adds what the box holds to the selection:
    // corners and things in vertex mode, whole rooms and things in sector
    // mode, where corners don't show, and things alone in thing mode.
    let stopMarquee: (() => void) | undefined;
    const startMarquee = (event: PointerEvent) => {
      const surface = root();
      if (!surface) return;
      const from = viewport.toCanvas(event.clientX, event.clientY);
      stopMarquee = bindDrag(surface, event, {
        threshold: dragThreshold,
        cancelOnEscape: true,
        onMove: ({ x, y }) => {
          store.set({ marquee: boxOf([from, viewport.toCanvas(x, y)]) });
        },
        onEnd: (_end, canceled) => {
          stopMarquee = undefined;
          const { marquee, map, positions, editMode } = store.get();
          store.set({ marquee: null });
          if (canceled || !marquee) return;
          const holds = (key: string) => {
            const point = positions[key];
            return (
              point !== undefined &&
              point.x >= marquee.left &&
              point.x <= marquee.right &&
              point.y >= marquee.top &&
              point.y <= marquee.bottom
            );
          };
          const things = Object.keys(positions).filter(
            (key) => key.startsWith(thingKeyPrefix) && holds(key),
          );
          const corners =
            editMode === "vertices"
              ? Object.keys(map.vertices).filter(holds)
              : editMode === "sectors"
                ? map.sectors
                    .filter((sector) => sector.vertices.every(holds))
                    .flatMap(sectorVertices)
                : [];
          select([...new Set([...withPickedRoom(), ...corners, ...things])]);
        },
      });
    };
    context.onDestroy(() => stopMarquee?.());

    // Shift and a click on a room adds its corners to the selection, or takes
    // them out when they are all in it.
    const toggleRoom = (room: Sector) => {
      const selection = withPickedRoom();
      const corners = [...new Set(sectorVertices(room))];
      const picked = room.vertices.every((id) => selection.includes(id));
      select(
        picked
          ? selection.filter((key) => !corners.includes(key))
          : [...new Set([...selection, ...corners])],
      );
    };

    const fitMap = () => {
      const points = Object.values(store.get().positions);
      if (points.length === 0) return;
      viewport.fit(
        {
          left: Math.min(...points.map((point) => point.x)),
          top: Math.min(...points.map((point) => point.y)),
          right: Math.max(...points.map((point) => point.x)),
          bottom: Math.max(...points.map((point) => point.y)),
        },
        { padding: 56, maxZoom: 1.25 },
      );
    };

    const selectedTarget = (): MapTarget => {
      const { selection, activeSector, highlightedWall, map } = store.get();
      const picked = targetForKeys(selection, null);
      if (picked) return picked;
      if (highlightedWall) {
        const item = map.switches.find(
          (entry) => wallKey(entry.from, entry.to) === highlightedWall,
        );
        if (item) return { kind: "switch", id: item.id, point: null };
        const owner = map.sectors.find((sector) => sector.id === activeSector);
        if (owner) return wallTarget(owner.id, highlightedWall, null);
      }
      return activeSector
        ? { kind: "room", sector: activeSector, point: null }
        : { kind: "empty", point: null };
    };

    const targetAt = (event: MouseEvent): MapTarget | null => {
      const state = store.get();
      if (
        state.tool === "draw" ||
        state.moving ||
        state.connecting ||
        stopCameraDrag ||
        getIsDragging(event)
      ) {
        return null;
      }
      const element = event.target as Element;
      if (element.closest("[data-map-control]")) return null;
      const key =
        element.closest<HTMLElement>("[data-map-key]")?.dataset.mapKey;
      const keyboard = getIsKeyboardMenu(event);
      if (keyboard && (!key || key === "camera")) return selectedTarget();
      const at = viewport.toCanvas(event.clientX, event.clientY);
      const point = keyboard ? null : snapPoint(at, grid());
      if (key?.startsWith(doorKeyPrefix)) {
        return {
          kind: "room",
          sector: key.slice(doorKeyPrefix.length),
          point,
        };
      }
      if (key && key !== "camera") {
        const group = state.selection.includes(key) ? state.selection : [key];
        return targetForKeys(group, state.positions[key] ?? point, key);
      }
      const wall = wallNear(state.map, at, wallReach / state.viewport.zoom);
      if (wall) {
        const item = state.map.switches.find(
          (entry) => wallKey(entry.from, entry.to) === wall.wall,
        );
        return item
          ? targetForKeys([`${switchKeyPrefix}${item.id}`], point)
          : wallTarget(wall.sector, wall.wall, point);
      }
      const room = sectorAt(state.map, at);
      if (room) {
        // A room that is one of several selected keeps the rest selected.
        const keepSelection =
          state.selection.length > 0 && pickedParts().sectors.includes(room.id);
        return { kind: "room", sector: room.id, point, keepSelection };
      }
      const hole = holeAt(state.map, at);
      return hole
        ? { kind: "hole", sector: hole.sector.id, index: hole.index, point }
        : { kind: "empty", point };
    };

    // Every agent action is a method here, so a bridge step reaches it by
    // name. A read returns what it found, and an edit lands as one change
    // that already passed the map's checks.
    const agentMethods = Object.fromEntries(
      agentActionNames.map((name) => [
        name,
        (...args: unknown[]) => {
          const { map } = store.get();
          // The editor names the map from its settings, which would undo a
          // name set here.
          if (name === "setMapDetails" && args.some(getHasName)) {
            throw new Error("Rename the map from Map settings in the editor.");
          }
          const { map: next, ...outcome } = runAgentAction(
            map,
            name,
            args,
            context.options().checkContext,
          );
          if (next === map) return outcome.result;
          change("map", next, { reason: "agent" });
          const made = next.sectors.find(
            (sector) =>
              sector.id === outcome.result &&
              !map.sectors.some((item) => item.id === sector.id),
          );
          if (made) select([], made.id);
          context.options().onAgentAction?.(name, outcome);
          return outcome;
        },
      ]),
    );

    return {
      viewport,
      move,
      connect,
      findCamera,
      attach(element: HTMLElement) {
        const stopCamera = context.options().camera?.subscribe(() =>
          store.set({
            cameraPosition: context.options().camera?.position ?? null,
          }),
        );
        let pointerAt: Point | null = null;
        const reportView = () => {
          const { x, y, zoom } = store.get().viewport;
          context.options().onViewChange?.({
            pointer: pointerAt,
            zoom,
            view: {
              left: -x / zoom,
              top: -y / zoom,
              right: (element.clientWidth - x) / zoom,
              bottom: (element.clientHeight - y) / zoom,
            },
          });
        };
        reportPointer = (point) => {
          pointerAt = point;
          reportView();
        };
        const stopView = store.subscribe(reportView);
        const resized = new ResizeObserver(reportView);
        resized.observe(element);
        // A hidden pane has no size to fit until it is first shown.
        const observer = new ResizeObserver(() => {
          if (element.clientWidth === 0 || element.clientHeight === 0) return;
          observer.disconnect();
          this.fitMap();
          fitted = true;
          if (findAfterFit) findCamera();
          if (focusAfterFit) centerOn(focusAfterFit);
        });
        observer.observe(element);
        return () => {
          stopCamera?.();
          stopView();
          resized.disconnect();
          observer.disconnect();
        };
      },
      lookHere() {
        const target = lookTarget(store.get());
        if (target) moveCamera(target);
      },
      doubleClick(event: MouseEvent) {
        if (store.get().tool !== "select") return;
        if ((event.target as Element).closest("[data-map-control]")) return;
        const at = viewport.toCanvas(event.clientX, event.clientY);
        if (!insertCorner(at)) moveCamera(at);
      },
      pressCamera(event: PointerEvent, el: HTMLElement) {
        const camera = context.options().camera;
        if (
          !camera ||
          event.button !== 0 ||
          getIsSecondaryPress(event) ||
          store.get().tool !== "select"
        ) {
          return;
        }
        const start = camera.position;
        const wasWalked = camera.walked;
        stopCameraDrag = bindDrag(el, event, {
          threshold: dragThreshold,
          cancelOnEscape: true,
          onMove: ({ x, y }) => {
            moveCamera(viewport.toCanvas(x, y));
          },
          onEnd: (_end, canceled) => {
            stopCameraDrag = undefined;
            if (canceled) {
              camera.position = start;
              camera.walked = wasWalked;
            }
          },
        });
      },
      cameraKeydown(event: KeyboardEvent) {
        const position = store.get().cameraPosition;
        const direction = arrowSteps[event.key];
        if (!position || !direction) return;
        event.preventDefault();
        moveCamera({
          x: position.x + direction.x * cameraNudge,
          y: position.y + direction.y * cameraNudge,
        });
      },
      rooms: () =>
        store.get().map.sectors.map((sector) => ({
          value: sector.id,
          label: sector.name,
        })),
      fitMap,
      contextmenu(event: MouseEvent) {
        const { tool, drawing } = store.get();
        if ((tool === "draw" || tool === "line") && !getIsKeyboardMenu(event)) {
          store.set({ drawing: drawing.slice(0, -1) });
        }
        context.options().onContextTarget?.(targetAt(event));
      },
      ...agentMethods,
      pointerdown(event: PointerEvent) {
        press = { x: event.clientX, y: event.clientY };
        // A second finger joins the press it follows and doesn't start one.
        if (event.isPrimary) carried = null;
        root()?.focus({ preventScroll: true });
        touchPress = null;
        ignoreClick = false;
        if (event.pointerType === "touch") {
          touchPress = { event, held: true };
          context.options().onContextTarget?.(targetAt(event));
        }
        if (getIsSecondaryPress(event)) return;
        const target = event.target as Element;
        if (target.closest("[data-map-control], [data-map-key]")) return;
        const { tool, editMode, map, viewport: view } = store.get();
        if (tool !== "select") return;
        // A touch has no Shift, and two of them zoom the map, so a box and a
        // drag of a room take a mouse or a pen.
        const fine = event.pointerType !== "touch" && event.button === 0;
        if (fine && event.shiftKey && editMode !== "lines") {
          // The browser would stretch the page's text selection to here.
          event.preventDefault();
          startMarquee(event);
          return;
        }
        // In line mode a wall drags by its two corners together.
        if (editMode === "lines" && event.button === 0) {
          const at = viewport.toCanvas(event.clientX, event.clientY);
          const wall = wallNear(map, at, wallReach / view.zoom);
          const surface = root();
          if (wall && surface) {
            const [from, to] = wall.wall.split("|");
            select([from, to]);
            move.pointerdown(event, from, surface);
            return;
          }
        }
        // In sector mode a selected room drags with everything picked.
        if (editMode === "sectors" && fine) {
          const { selection, positions } = store.get();
          const room = sectorAt(
            map,
            viewport.toCanvas(event.clientX, event.clientY),
          );
          const parts = pickedParts();
          const surface = root();
          if (room && surface && parts.sectors.includes(room.id)) {
            carried = [
              ...new Set([
                ...partKeys(map, parts),
                ...selection.filter(
                  (key) => key in positions && !key.startsWith(switchKeyPrefix),
                ),
              ]),
            ];
            move.pointerdown(event, carried[0], surface);
            // The move turns away a press that is already cancelled, so the
            // page's text selection is held off only after it has begun.
            event.preventDefault();
            return;
          }
        }
        viewport.pointerdown(event);
      },
      pointerleave() {
        pointer = null;
        reportPointer?.(null);
      },
      pointermove(event: PointerEvent) {
        if (
          touchPress?.held &&
          event.pointerType === "touch" &&
          press &&
          Math.abs(event.clientX - press.x) +
            Math.abs(event.clientY - press.y) >
            clickSlop
        ) {
          touchPress.held = false;
          context.options().onContextTarget?.(null);
        }
        pointer = viewport.toCanvas(event.clientX, event.clientY);
        reportPointer?.(pointFromEvent(event));
        const { tool } = store.get();
        if (tool === "draw" || tool === "line") {
          store.set({ cursor: pointFromEvent(event) });
        }
      },
      click(event: MouseEvent) {
        carried = null;
        if (ignoreClick) {
          ignoreClick = false;
          return;
        }
        const target = event.target as Element;
        if (target.closest("[data-map-control]")) return;
        const moved =
          press &&
          Math.abs(event.clientX - press.x) +
            Math.abs(event.clientY - press.y) >
            clickSlop;
        if (moved) return;
        const { tool, map, positions, thingKind, viewport: view } = store.get();
        const handle = target.closest<HTMLElement>("[data-map-key]");
        const key = handle?.dataset.mapKey;
        const point = (key && positions[key]) || pointFromEvent(event);
        if (tool === "draw") {
          clickDraw(point);
        } else if (tool === "line") {
          clickLine(point);
        } else if (tool === "thing") {
          const placed = addThing(map, thingKind, point, 0, 1);
          change("map", placed.map, { reason: "place" });
          select([`${thingKeyPrefix}${placed.id}`]);
        } else if (tool === "switch") {
          const at = viewport.toCanvas(event.clientX, event.clientY);
          const wall = freeWallNear(map, at, switchReach / view.zoom);
          if (!wall) return;
          const added = addSwitch(map, wall, at, null, grid());
          change("map", added.map, { reason: "place" });
          select([`${switchKeyPrefix}${added.id}`]);
          change("tool", "select", { reason: "draw" });
        } else if (!key) {
          const { editMode } = store.get();
          const pressed =
            event.shiftKey &&
            (editMode === "vertices" || editMode === "sectors")
              ? sectorAt(map, viewport.toCanvas(event.clientX, event.clientY))
              : undefined;
          if (pressed) {
            toggleRoom(pressed);
          } else if (editMode === "lines") {
            const at = viewport.toCanvas(event.clientX, event.clientY);
            const wall = wallNear(map, at, wallReach / view.zoom);
            select([]);
            if (wall) {
              context.options().onWallSelect?.(wall.sector, wall.wall);
            }
          } else {
            select(
              [],
              editMode === "things" ? null : (sectorAt(map, point)?.id ?? null),
            );
          }
        }
      },
      keydown(event: KeyboardEvent) {
        if (event.defaultPrevented || openMenuFromKey(event)) return;
        const { tool, drawing } = store.get();
        if (tool === "draw" || tool === "line") {
          if (event.key === "Enter") {
            if (tool === "draw") finishRoom();
            else finishLine();
          } else if (event.key === "Escape") {
            store.set({ drawing: [], cursor: null });
          } else if (event.key === "Backspace") {
            store.set({ drawing: drawing.slice(0, -1) });
          } else {
            viewport.keydown(event);
            return;
          }
          event.preventDefault();
          return;
        }
        if ((tool === "thing" || tool === "switch") && event.key === "Escape") {
          change("tool", "select", { reason: "draw" });
          event.preventDefault();
          return;
        }
        if (
          ((event.key === "Delete" || event.key === "Backspace") &&
            deleteSelection()) ||
          (event.key === "Insert" &&
            tool === "select" &&
            pointer !== null &&
            insertCorner(pointer)) ||
          (tool === "select" && nudgeSelection(event))
        ) {
          event.preventDefault();
          return;
        }
        viewport.keydown(event);
      },
      pressPort(event: PointerEvent, key: string, el: HTMLElement) {
        if (event.button !== 0 || getIsSecondaryPress(event)) return;
        if (store.get().tool !== "select") return;
        if (key.startsWith(doorKeyPrefix)) {
          select([], key.slice(doorKeyPrefix.length));
          return;
        }
        select([key]);
        connect.pointerdown(event, key, el);
      },
      portKeydown(event: KeyboardEvent, key: string) {
        if (connect.keydown(event)) return;
        if (
          event.key.toLowerCase() === "c" &&
          !event.ctrlKey &&
          !event.metaKey &&
          key.startsWith(switchKeyPrefix) &&
          connect.start(key)
        ) {
          event.preventDefault();
        }
      },
      pressHandle(event: PointerEvent, key: string, el: HTMLElement) {
        if (event.button !== 0 || getIsSecondaryPress(event)) return;
        const { tool } = store.get();
        if (tool === "thing" && key.startsWith(thingKeyPrefix)) {
          change("tool", "select", { reason: "draw" });
        } else if (tool !== "select") return;
        const { selection } = store.get();
        if (event.shiftKey) {
          select(
            selection.includes(key)
              ? selection.filter((item) => item !== key)
              : [...selection, key],
          );
          return;
        }
        if (!selection.includes(key)) select([key]);
        move.pointerdown(event, key, el);
      },
    };
  },
  slots: (slot) => ({
    root: slot({
      attrs: (state) => ({
        tabindex: "0",
        "aria-roledescription": "map editor",
        "data-tool": state.tool,
        "data-mode": state.editMode,
        style: css({
          position: "relative",
          overflow: "clip",
          "touch-action": "none",
        }),
      }),
      bind: (el, { api }) => api.attach(el),
      on: {
        wheel: (event, { api }) => api.viewport.wheel(event),
        pointerdown: (event, { api }) => api.pointerdown(event),
        pointermove: (event, { api }) => api.pointermove(event),
        pointerleave: (_event, { api }) => api.pointerleave(),
        click: (event, { api }) => api.click(event),
        contextmenu: (event, { api }) => api.contextmenu(event),
        dblclick: (event, { api }) => api.doubleClick(event),
        keydown: (event, { api }) => api.keydown(event),
      },
    }),
    world: slot({
      attrs: () => ({
        style: css({ position: "absolute", left: "0", top: "0" }),
      }),
      live: live<MapEditorState, LiveApi, {}>((state, { api }) => ({
        style: api.viewport.style(state),
      })),
    }),
    sector: slot<SectorProps>({
      props: {
        value: "string",
        corners: "list",
        holes: "value",
        door: "boolean",
      },
      selects: selects<MapEditorState, unknown, SectorProps>({
        ...readsNothing,
        positions: ({ props }) => sectorCorners(props),
        moving: whole,
        activeSector: ({ key }) => [key],
        selection: ({ props }) => props.corners,
      }),
      attrs: (state, { key, props }) => ({
        d: sectorPath(state, props.corners, props.holes),
        "data-active": state.activeSector === key ? "" : undefined,
        "data-selected": props.corners.every((corner) =>
          state.selection.includes(corner),
        )
          ? ""
          : undefined,
        "data-door": props.door ? "" : undefined,
      }),
      live: live<MapEditorState, unknown, SectorProps>((state, { props }) => ({
        d: sectorPath(state, props.corners, props.holes),
      })),
    }),
    wall: slot<WallProps>({
      props: { value: "string", from: "string", to: "string" },
      selects: selects<MapEditorState, unknown, WallProps>({
        ...readsNothing,
        positions: ({ props }) => [props.from, props.to],
        moving: {
          values: ({ props }) => [props.from, props.to],
          moved: movedDraft,
        },
        highlightedWall: ({ key }) => [key],
      }),
      attrs: (state, { key, props }) => ({
        ...wallAttrs(state, props.from, props.to),
        "data-selected": state.highlightedWall === key ? "" : undefined,
      }),
      live: live<MapEditorState, unknown, WallProps>((state, { props }) =>
        wallAttrs(state, props.from, props.to),
      ),
    }),
    draft: slot({
      attrs: (state) => ({ points: draftPoints(state) }),
      live: live<MapEditorState, unknown, {}>((state) => ({
        points: draftPoints(state),
      })),
    }),
    marquee: slot({
      attrs: (state) => ({ style: marqueeStyle(state) }),
      live: live<MapEditorState, unknown, {}>((state) => ({
        style: marqueeStyle(state),
      })),
    }),
    measure: slot({
      selects: selects<MapEditorState, unknown, {}>({
        ...readsNothing,
        positions: whole,
        moving: whole,
        tool: whole,
        drawing: whole,
        cursor: whole,
        highlightedWall: whole,
        drawShape: whole,
      }),
      attrs: (state) => measureAttrs(state),
      live: live<MapEditorState, unknown, {}>((state) => measureAttrs(state)),
    }),
    handle: slot<KeyedProps>({
      props: { value: "string" },
      selects: selects<MapEditorState, unknown, KeyedProps>({
        ...readsNothing,
        positions: ({ key }) => [key],
        moving: { values: ({ key }) => [key], moved: movedDraft },
        selection: ({ key }) => [key],
      }),
      attrs: (state, { key }) => {
        const at = state.positions[key] ?? { x: 0, y: 0 };
        return {
          type: "button",
          "data-map-key": key,
          "data-selected": state.selection.includes(key) ? "" : undefined,
          style: css({
            position: "absolute",
            left: `${at.x}px`,
            top: `${at.y}px`,
            "touch-action": "none",
          }),
        };
      },
      live: live<MapEditorState, LiveApi, { value: string }>(
        (state, { api, key }) => ({
          style: api.move.style(state, key),
          "data-dragging": api.move.dragging(state, key) ? "" : undefined,
        }),
      ),
      on: {
        keydown: (event, { api, key }) => api.move.keydown(event, key),
        pointerdown: (event, { api, el, key }) =>
          api.pressHandle(event, key, defined(el)),
      },
    }),
    port: slot<KeyedProps>({
      props: { value: "string" },
      selects: selects<MapEditorState, unknown, KeyedProps>({
        ...readsNothing,
        map: whole,
        positions: whole,
        moving: whole,
        connecting: whole,
        selection: ({ key }) => [key],
      }),
      attrs: (state, { key }) => {
        const at = portPoint(state, key);
        return {
          type: "button",
          "data-map-key": key,
          "data-selected": state.selection.includes(key) ? "" : undefined,
          style: css({
            position: "absolute",
            left: `${at.x}px`,
            top: `${at.y}px`,
            "touch-action": "none",
          }),
        };
      },
      live: live<MapEditorState, LiveApi, { value: string }>(
        (state, { api, key }) => {
          const at = portPoint(state, key);
          return {
            style: `left:${at.x}px;top:${at.y}px`,
            "data-connect": api.connect.role(state, key),
          };
        },
      ),
      on: {
        keydown: (event, { api, key }) => api.portKeydown(event, key),
        pointerdown: (event, { api, el, key }) =>
          api.pressPort(event, key, defined(el)),
      },
    }),
    wire: slot<WallProps>({
      props: { value: "string", from: "string", to: "string" },
      selects: selects<MapEditorState, unknown, WallProps>({
        ...readsNothing,
        map: whole,
        positions: whole,
        moving: whole,
      }),
      attrs: (state, { props }) =>
        lineAttrs(portPoint(state, props.from), portPoint(state, props.to)),
      live: live<MapEditorState, unknown, WallProps>((state, { props }) =>
        lineAttrs(portPoint(state, props.from), portPoint(state, props.to)),
      ),
    }),
    connecting: slot({
      attrs: (state) => connectingAttrs(state),
      live: live<MapEditorState, unknown, {}>((state) =>
        connectingAttrs(state),
      ),
    }),
    label: slot<LabelProps>({
      props: { value: "string", corners: "list" },
      selects: selects<MapEditorState, unknown, LabelProps>({
        ...readsNothing,
        positions: ({ props }) => props.corners,
        moving: whole,
        viewport: whole,
      }),
      attrs: (state, { props }) => {
        const at = labelPoint(state, props.corners);
        return {
          style: css({
            position: "absolute",
            left: `${at.x}px`,
            top: `${at.y}px`,
          }),
        };
      },
      live: live<MapEditorState, unknown, LabelProps>((state, { props }) => {
        const at = labelPoint(state, props.corners);
        return { style: `left:${at.x}px;top:${at.y}px` };
      }),
    }),
    marker: slot<{ value: string; x: number; y: number }>({
      props: { value: "string", x: "number", y: "number" },
      attrs: (_state, { props }) => ({
        style: css({
          position: "absolute",
          left: `${props.x}px`,
          top: `${props.y}px`,
        }),
      }),
    }),
    camera: slot({
      attrs: (state) => ({
        type: "button",
        "data-map-key": "camera",
        style: cameraStyle(state),
      }),
      live: live<MapEditorState, unknown, {}>((state) => ({
        style: cameraStyle(state),
      })),
      on: {
        keydown: (event, { api }) => api.cameraKeydown(event),
        pointerdown: (event, { api, el }) =>
          api.pressCamera(event, defined(el)),
      },
    }),
    findCamera: slot({
      attrs: () => ({ type: "button", "data-map-control": "" }),
      press: ({ api }) => api.findCamera(),
    }),
    lookHere: slot({
      attrs: (state) => ({
        type: "button",
        "data-map-control": "",
        disabled: lookTarget(state) ? undefined : "",
      }),
      press: ({ api }) => api.lookHere(),
    }),
    fit: slot({
      attrs: () => ({ type: "button", "data-map-control": "" }),
      press: ({ api }) => api.fitMap(),
    }),
  }),
  agent: {
    actions: agentActionNames,
    items: (api) => api.rooms(),
  },
});

function getHasName(value: unknown, index: number) {
  return (
    (index === 0 && typeof value === "string") ||
    (typeof value === "object" && value !== null && "name" in value)
  );
}

function lookTarget(state: MapEditorState): Point | null {
  const { map, activeSector, selection } = state;
  if (selection.length > 0) {
    const thing = map.things.find(
      (item) => `${thingKeyPrefix}${item.id}` === selection[0],
    );
    const sector = thing ? sectorAt(map, thing) : null;
    return thing && sector && !sector.door ? { x: thing.x, y: thing.y } : null;
  }
  const sector = map.sectors.find((item) => item.id === activeSector);
  return sector && !sector.door ? roomCenter(map, sector) : null;
}

function sectorCorners({ corners, holes = [] }: SectorProps) {
  return [...corners, ...holes.flat()];
}

function sectorPath(
  state: MapEditorState,
  corners: readonly string[],
  holes: readonly string[][] = [],
) {
  return loopsPath(
    [corners, ...holes].map((loop) =>
      loop.map((vertex) => pointOf(state, vertex)),
    ),
  );
}

function movedDraft(
  before: MoveDraft | null,
  after: MoveDraft | null,
  notify: (key: string) => void,
) {
  for (const key of before?.keys ?? []) notify(key);
  if (after && after.keys !== before?.keys) {
    for (const key of after.keys) notify(key);
  }
}

function wallAttrs(state: MapEditorState, from: string, to: string) {
  return lineAttrs(pointOf(state, from), pointOf(state, to));
}

function marqueeStyle({ marquee }: MapEditorState) {
  return css({
    position: "absolute",
    left: `${marquee?.left ?? 0}px`,
    top: `${marquee?.top ?? 0}px`,
    width: `${marquee ? marquee.right - marquee.left : 0}px`,
    height: `${marquee ? marquee.bottom - marquee.top : 0}px`,
    visibility: marquee ? undefined : "hidden",
    "pointer-events": "none",
  });
}

function draftPoints(state: MapEditorState) {
  const shape = shapeDraft(state);
  const outline =
    state.tool === "draw" && state.drawShape !== "outline"
      ? shape
        ? [...shape, shape[0]]
        : []
      : state.cursor
        ? [...state.drawing, state.cursor]
        : state.drawing;
  return outline.map((point) => `${point.x},${point.y}`).join(" ");
}

// The corners a rectangle or a polygon would have with the pointer where it
// is, once its first point is down.
function shapeDraft(state: MapEditorState) {
  const { drawShape, drawSides, drawing, cursor, grid, tool } = state;
  if (tool !== "draw" || drawShape === "outline" || !drawing[0] || !cursor) {
    return null;
  }
  return shapeCorners(drawShape, drawSides, drawing[0], cursor, grid);
}

function measureAttrs(state: MapEditorState) {
  const measure = measureOf(state);
  return {
    "data-measure": measure?.text ?? "",
    style: css({
      position: "absolute",
      left: `${measure?.at.x ?? 0}px`,
      top: `${measure?.at.y ?? 0}px`,
      visibility: measure ? undefined : "hidden",
      "pointer-events": "none",
    }),
  };
}

// What the measure shows: the stretch being drawn, a shape's size, or the
// selected wall, which it follows through a drag.
function measureOf(state: MapEditorState) {
  const { tool, drawing, cursor, drawShape, highlightedWall } = state;
  const last = drawing.at(-1);
  if ((tool === "draw" || tool === "line") && last && cursor) {
    if (tool === "line" || drawShape === "outline") {
      return { at: cursor, text: measureText(last, cursor) };
    }
    const wide = Math.abs(cursor.x - last.x);
    const tall = Math.abs(cursor.y - last.y);
    return {
      at: cursor,
      text:
        drawShape === "rectangle"
          ? `${wide} × ${tall}`
          : `${Math.round(Math.hypot(wide, tall) * 2)} across`,
    };
  }
  if (tool !== "select" || !highlightedWall) return null;
  const [from, to] = highlightedWall.split("|");
  if (!state.positions[from] || !state.positions[to]) return null;
  const a = pointOf(state, from);
  const b = pointOf(state, to);
  return {
    at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    text: measureText(a, b),
  };
}

// A wall's length and the way it runs, counted like a thing's facing: from
// east, turning left.
function measureText(from: Point, to: Point) {
  const length = Math.round(Math.hypot(to.x - from.x, to.y - from.y));
  const turn = (Math.atan2(from.y - to.y, to.x - from.x) * 180) / Math.PI;
  return `${length} · ${Math.round((turn + 360) % 360)}°`;
}

const hiddenLine = { x1: "0", y1: "0", x2: "0", y2: "0" };

function connectingAttrs(state: MapEditorState) {
  const { connecting } = state;
  if (!connecting) return { "data-active": undefined, ...hiddenLine };
  const end = connecting.to
    ? portPoint(state, connecting.to)
    : { x: connecting.x, y: connecting.y };
  return {
    "data-active": "",
    ...lineAttrs(portPoint(state, connecting.from), end),
  };
}

function portPoint(state: MapEditorState, key: string): Point {
  if (key.startsWith(switchKeyPrefix)) {
    const id = key.slice(switchKeyPrefix.length);
    const item = state.map.switches.find((entry) => entry.id === id);
    if (!item) return { x: 0, y: 0 };
    const a = pointOf(state, item.from);
    const b = pointOf(state, item.to);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  const id = key.slice(doorKeyPrefix.length);
  return centroid(state, sectorById(state.map, id)?.vertices ?? []);
}

function centroid(state: MapEditorState, corners: readonly string[]): Point {
  const points = corners.map((corner) => pointOf(state, corner));
  const count = points.length || 1;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / count,
    y: points.reduce((sum, point) => sum + point.y, 0) / count,
  };
}

function pointOf(state: MapEditorState, key: string): Point {
  const base = state.positions[key] ?? { x: 0, y: 0 };
  const { moving } = state;
  return moving?.keys.includes(key)
    ? { x: base.x + moving.dx, y: base.y + moving.dy }
    : base;
}

const sectorIndexes = new WeakMap<GameMap, Map<string, Sector>>();

// Maps are replaced on every edit, never changed in place, so an index built
// for one stays right for as long as it's in use.
function sectorById(map: GameMap, id: string) {
  let index = sectorIndexes.get(map);
  if (!index) {
    index = new Map(map.sectors.map((sector) => [sector.id, sector]));
    sectorIndexes.set(map, index);
  }
  return index.get(id);
}

function lineAttrs(a: Point, b: Point) {
  return {
    x1: String(a.x),
    y1: String(a.y),
    x2: String(b.x),
    y2: String(b.y),
  };
}

const labelInset = 24;

// A label sits near the top of its room, on a part of that band the room
// covers, so an L-shaped room doesn't label the room tucked into its corner.
function labelPoint(state: MapEditorState, corners: readonly string[]): Point {
  const center = centroid(state, corners);
  const points = corners.map((key) => pointOf(state, key));
  const y =
    Math.min(...points.map((point) => point.y)) +
    labelInset / state.viewport.zoom;
  const spans = spansAt(points, y);
  const span =
    spans.find(([left, right]) => left <= center.x && center.x <= right) ??
    spans.toSorted((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
  return {
    x:
      !span || (span[0] <= center.x && center.x <= span[1])
        ? center.x
        : (span[0] + span[1]) / 2,
    y,
  };
}

// The parts of a horizontal line that fall inside a polygon, left to right.
function spansAt(points: Point[], y: number) {
  const crossings: number[] = [];
  points.forEach((a, index) => {
    const b = points[(index + 1) % points.length];
    if (a.y <= y !== b.y <= y) {
      crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
  });
  crossings.sort((left, right) => left - right);
  const spans: [number, number][] = [];
  for (let index = 0; index + 1 < crossings.length; index += 2) {
    spans.push([crossings[index], crossings[index + 1]]);
  }
  return spans;
}

function cameraStyle(state: MapEditorState) {
  const camera = state.cameraPosition;
  return css({
    position: "absolute",
    left: `${camera?.x ?? 0}px`,
    top: `${camera?.y ?? 0}px`,
    "--camera-angle": `${-(camera?.angle ?? 0)}deg`,
    visibility: camera ? undefined : "hidden",
    "touch-action": "none",
  });
}

const parts = createParts(mapEditor, {
  root: "div",
  world: "div",
  sector: "path",
  wall: "line",
  draft: "polyline",
  marquee: "div",
  measure: "div",
  handle: "button",
  port: "button",
  wire: "line",
  connecting: "line",
  label: "div",
  marker: "div",
  camera: "button",
  findCamera: "button",
  lookHere: "button",
  fit: "button",
});

export const MapEditor = parts.Root;
export const MapWorld = parts.World;
// Thousands of these render on a big map and an edit changes a few, so each
// renders again only when its own props change.
export const MapSector = React.memo(parts.Sector);
export const MapWall = React.memo(parts.Wall);
export const MapDraft = parts.Draft;
export const MapMarquee = parts.Marquee;
export const MapMeasure = parts.Measure;
export const MapHandle = React.memo(parts.Handle);
export const MapPort = React.memo(parts.Port);
export const MapWire = React.memo(parts.Wire);
export const MapConnecting = parts.Connecting;
export const MapFit = parts.Fit;
export const MapLabel = parts.Label;
export const MapMarker = parts.Marker;
export const MapCamera = parts.Camera;
export const MapFindCamera = parts.FindCamera;
export const MapLookHere = parts.LookHere;
