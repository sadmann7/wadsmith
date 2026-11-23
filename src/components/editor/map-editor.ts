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
  matchesShortcut,
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
import { boundsOf, fitView } from "@/lib/editor/fit-view";
import { currentKeys } from "@/lib/editor/keymap";
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
  roomKeyPrefix,
  shiftRooms,
  snapPoint,
  splitWall,
  switchKeyPrefix,
  thingKeyPrefix,
  updateSwitch,
  wallKeyPrefix,
  wallNear,
} from "@/lib/map/edit";
import {
  partKeys,
  pickedRooms,
  removeParts,
  selectedParts,
} from "@/lib/map/fragment";
import {
  type Box,
  boxOf,
  holeAt,
  loopsPath,
  sectorAt,
  sectorVertices,
  wallKey,
  wallOwners,
} from "@/lib/map/geometry";
import {
  drawLines,
  drawRoom,
  joinCornersToWalls,
  removeCorner,
} from "@/lib/map/reshape";
import { type DrawShape, gridCells, shapeCorners } from "@/lib/map/shapes";

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
  | "height-key"
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
  // A wall picked as the one the inspector shows, with every wall now
  // selected alongside it.
  onWallSelect?: (sector: string, wall: string, selection: string[]) => void;
  onViewChange?: (status: MapViewStatus) => void;
  thingKind?: ThingKind;
  // The editor number a custom thing is placed with.
  thingType?: number;
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
  fitSelectionRequest?: number;
  // A selector for what lies over the map, like a card, which a fit keeps the
  // map clear of.
  fitAround?: string;
  selectAllRequest?: number;
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
  // Whether a corner or wall dropped on a wall joins it.
  autoMerge?: boolean;
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
  hoverWall: string | null;
  hoverRooms: string[];
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
const lightStep = 16;
const heightKeys: Record<string, 1 | -1> = {
  PageUp: 1,
  PageDown: -1,
  Home: 1,
  End: -1,
};
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
  hoverWall: none,
  hoverRooms: none,
} satisfies Record<keyof MapEditorState, readonly never[]>;

type BoxMode = "replace" | "add" | "remove";

export const mapEditor = definePrimitive({
  name: "map-editor",
  options: {
    map: "value",
    tool: "string",
    editMode: "string",
    onWallSelect: "callback",
    onViewChange: "callback",
    thingKind: "string",
    thingType: "value",
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
    fitSelectionRequest: "number",
    fitAround: "string",
    selectAllRequest: "number",
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
    autoMerge: "boolean",
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
      hoverWall: null,
      hoverRooms: [],
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
        const merging = context.options().autoMerge !== false;
        const joined =
          details.reason === "drag" && corners.length > 0
            ? mergeCorners(
                merging ? joinCornersToWalls(moved, corners) : moved,
                corners,
              )
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
    let fittedView: Viewport | null = null;
    let reportPointer: ((point: Point | null) => void) | undefined;
    let findAfterFit = false;
    let focusAfterFit: Point | null = null;
    let stopCameraDrag: (() => void) | undefined;
    let findRequest = context.options().findCameraRequest ?? 0;
    let lookRequest = context.options().lookAtRequest?.id ?? 0;
    let fitRequest = context.options().fitRequest ?? 0;
    let fitSelectionRequest = context.options().fitSelectionRequest ?? 0;
    let fitAround = context.options().fitAround ?? "";
    let selectAllRequest = context.options().selectAllRequest ?? 0;
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
    context.onOptions((options) => {
      const request = options.fitSelectionRequest ?? 0;
      if (request === fitSelectionRequest) return;
      fitSelectionRequest = request;
      fitSelection();
    });
    context.onOptions((options) => {
      const around = options.fitAround ?? "";
      if (around === fitAround) return;
      fitAround = around;
      if (fitted && getIsFitView()) fitMap();
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

    // A grid of rooms is drawn a cell at a time, each sharing the walls of
    // the ones before it.
    const addDrawnGrid = (from: Point, to: Point) => {
      let next = store.get().map;
      const ids: string[] = [];
      for (const cell of gridCells(from, to, grid())) {
        const room = drawRoom(next, cell, {}, 1);
        next = room.map;
        ids.push(room.id);
      }
      store.set({ drawing: [], cursor: null });
      change("map", next, { reason: "draw" });
      select(ids.map((id) => `${roomKeyPrefix}${id}`));
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
        if (corners && drawShape === "grid") addDrawnGrid(first, point);
        else if (corners) addDrawnRoom(corners);
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
      const { map, selection, positions, editMode } = store.get();
      // A room picked whole, or the active room in sector mode, moves with
      // its corners and what stands in it.
      const rooms = selection.filter((key) => key.startsWith(roomKeyPrefix));
      const active = editMode === "sectors" ? pickedRoom() : null;
      const keys = [
        ...new Set([
          ...movableKeys(selection, positions),
          ...(rooms.length > 0 || active
            ? partKeys(map, selectedParts(map, rooms, active))
            : []),
        ]),
      ];
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

    // Adding to a selection keeps the active room in it: as a whole room in
    // sector mode, and as its corners in corner mode.
    const withPickedRoom = () => {
      const { map, selection, editMode } = store.get();
      const room = map.sectors.find((sector) => sector.id === pickedRoom());
      if (!room) return selection;
      return [
        ...new Set([
          ...selection,
          ...(editMode === "sectors"
            ? [`${roomKeyPrefix}${room.id}`]
            : sectorVertices(room)),
        ]),
      ];
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
    const insertThing = (point: Point) => {
      const { map, editMode, tool, thingKind } = store.get();
      if (editMode !== "things" && tool !== "thing") return false;
      const placed = addThing(
        map,
        thingKind,
        snapPoint(point, grid()),
        0,
        1,
        context.options().thingType,
      );
      change("map", placed.map, { reason: "place" });
      select([`${thingKeyPrefix}${placed.id}`]);
      return true;
    };
    let pointer: Point | null = null;
    let spaceHeld = false;

    // What a click would pick, drawn highlighted: the wall in line mode, with
    // the rooms its action works on, and the room in sector mode.
    const hover = (at: Point | null) => {
      const {
        map,
        editMode,
        tool,
        moving,
        marquee,
        viewport: view,
      } = store.get();
      let wall: string | null = null;
      let rooms: string[] = [];
      if (at && tool === "select" && !moving && !marquee) {
        if (editMode === "lines") {
          wall = wallNear(map, at, wallReach / view.zoom)?.wall ?? null;
          const tag = wall ? taggedBy(map, wall) : 0;
          rooms = tag
            ? map.sectors
                .filter((sector) => sector.tag === tag)
                .map((sector) => sector.id)
            : [];
        } else if (editMode === "sectors") {
          const room = sectorAt(map, at);
          rooms = room ? [room.id] : [];
        }
      }
      const { hoverWall, hoverRooms } = store.get();
      if (
        hoverWall !== wall ||
        hoverRooms.length !== rooms.length ||
        hoverRooms.some((id, index) => id !== rooms[index])
      ) {
        store.set({ hoverWall: wall, hoverRooms: rooms });
      }
    };

    const selectedWalls = () =>
      store
        .get()
        .selection.filter((key) => key.startsWith(wallKeyPrefix))
        .map((key) => key.slice(wallKeyPrefix.length));

    // The walls in the selection, with one of them shown in the inspector:
    // the one pressed, from the side of it that was pressed, or else the one
    // shown before.
    const pickWalls = (
      walls: string[],
      primary: { wall: string; sector: string } | null,
    ) => {
      const { map, highlightedWall, activeSector } = store.get();
      const keys = walls.map((wall) => `${wallKeyPrefix}${wall}`);
      select(keys);
      const before =
        highlightedWall && walls.includes(highlightedWall) && activeSector
          ? { wall: highlightedWall, sector: activeSector }
          : null;
      const last = walls.at(-1);
      const owner = last && wallOwners(map).get(last)?.[0];
      const shown =
        primary && walls.includes(primary.wall)
          ? primary
          : (before ??
            (last && owner ? { wall: last, sector: owner.id } : null));
      if (shown) {
        context.options().onWallSelect?.(shown.sector, shown.wall, keys);
      }
    };

    // Page Up and Page Down raise and lower the floors of the picked rooms, or
    // of the room under the pointer, Home and End their ceilings, and with
    // Alt they change the light. Shift takes three steps.
    const shiftHeights = (event: KeyboardEvent) => {
      const way = heightKeys[event.key];
      if (!way || event.ctrlKey || event.metaKey) return false;
      const { map, selection, editMode } = store.get();
      if (editMode === "things") return false;
      let rooms = pickedRooms(map, selection, pickedRoom());
      if (rooms.length === 0 && pointer) {
        const under = sectorAt(map, pointer);
        rooms = under ? [under.id] : [];
      }
      if (rooms.length === 0) return false;
      const ends = event.key === "Home" || event.key === "End";
      if (event.altKey && ends) return false;
      const key = event.altKey ? "light" : ends ? "ceiling" : "floor";
      const step = key === "light" ? lightStep : grid();
      const next = shiftRooms(
        map,
        rooms,
        key,
        way * step * (event.shiftKey ? 3 : 1),
      );
      if (next !== map) change("map", next, { reason: "height-key", event });
      return true;
    };

    // Select all picks everything the mode works on, and inverting swaps
    // what is picked for what isn't.
    const everything = () => {
      const { map, positions, editMode } = store.get();
      return boxedKeys(map, positions, editMode, null);
    };
    const selectEverything = (invert: boolean) => {
      const { map, editMode, selection } = store.get();
      const all = everything();
      let current = new Set(withPickedRoom());
      // A room is in or out as a whole, however it came to be picked.
      if (editMode === "sectors") {
        current = new Set([
          ...selection.filter((key) => key.startsWith(thingKeyPrefix)),
          ...pickedRooms(map, selection, pickedRoom()).map(
            (id) => `${roomKeyPrefix}${id}`,
          ),
        ]);
      }
      applyPicked(invert ? all.filter((key) => !current.has(key)) : all);
    };
    context.onOptions((options) => {
      const request = options.selectAllRequest ?? 0;
      if (request === selectAllRequest) return;
      selectAllRequest = request;
      if (store.get().tool === "select") selectEverything(false);
    });

    // Selects these keys, through the inspector's wall when they are walls.
    const applyPicked = (keys: string[]) => {
      const { editMode } = store.get();
      if (editMode === "lines") {
        const walls = keys.filter((key) => key.startsWith(wallKeyPrefix));
        if (walls.length > 0) {
          pickWalls(
            walls.map((key) => key.slice(wallKeyPrefix.length)),
            null,
          );
        } else select([]);
        return;
      }
      // One room on its own is the active room, which the inspector edits.
      if (
        editMode === "sectors" &&
        keys.length === 1 &&
        keys[0].startsWith(roomKeyPrefix)
      ) {
        select([], keys[0].slice(roomKeyPrefix.length));
        return;
      }
      select(keys);
    };

    // A drag over the map boxes in what the mode works on: corners and
    // things, whole rooms and things, walls with both ends inside, or things.
    // A plain box replaces the selection, Shift adds and Ctrl or Cmd takes
    // away.
    let stopMarquee: (() => void) | undefined;
    const startMarquee = (event: PointerEvent, how: BoxMode) => {
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
          const picked = boxedKeys(map, positions, editMode, marquee);
          if (how === "replace") {
            applyPicked(picked);
            return;
          }
          const current = withPickedRoom();
          const { highlightedWall } = store.get();
          // The wall the inspector shows counts as selected.
          const held =
            editMode === "lines" && highlightedWall
              ? [...new Set([...current, `${wallKeyPrefix}${highlightedWall}`])]
              : current;
          const removed = new Set(
            editMode === "sectors"
              ? picked.flatMap((key) =>
                  key.startsWith(roomKeyPrefix)
                    ? [key, ...roomCornerKeys(map, key)]
                    : [key],
                )
              : picked,
          );
          applyPicked(
            how === "add"
              ? [...new Set([...held, ...picked])]
              : held.filter((key) => !removed.has(key)),
          );
        },
      });
    };
    context.onDestroy(() => stopMarquee?.());

    // Shift and a click on a room adds it to the selection, or takes it out
    // when it is in: as a whole room in sector mode, as its corners in corner
    // mode.
    const toggleRoom = (room: Sector) => {
      const { map, editMode } = store.get();
      const selection = withPickedRoom();
      if (editMode === "sectors") {
        const key = `${roomKeyPrefix}${room.id}`;
        const rooms = pickedRooms(map, selection, null);
        if (!rooms.includes(room.id)) {
          applyPicked([...selection, key]);
          return;
        }
        // Corners the other picked rooms still need stay.
        const kept = new Set(
          map.sectors
            .filter((sector) => sector !== room && rooms.includes(sector.id))
            .flatMap(sectorVertices),
        );
        const own = new Set(sectorVertices(room));
        applyPicked(
          selection.filter(
            (item) => item !== key && !(own.has(item) && !kept.has(item)),
          ),
        );
        return;
      }
      const corners = [...new Set(sectorVertices(room))];
      const picked = room.vertices.every((id) => selection.includes(id));
      select(
        picked
          ? selection.filter((key) => !corners.includes(key))
          : [...new Set([...selection, ...corners])],
      );
    };

    const fitPoints = (
      points: Point[],
      maxZoom: number,
      parts: Point[][] = [points],
    ) => {
      const surface = root();
      if (points.length === 0 || !surface) return;
      const box = surface.getBoundingClientRect();
      const around = context.options().fitAround;
      const overlays = around
        ? [...document.querySelectorAll(around)].map((element) => {
            const { left, top, right, bottom } =
              element.getBoundingClientRect();
            return {
              left: left - box.left,
              top: top - box.top,
              right: right - box.left,
              bottom: bottom - box.top,
            };
          })
        : [];
      viewport.setViewport(
        fitView(
          boundsOf(points),
          box,
          { padding: 56, minZoom: 0.1, maxZoom },
          overlays,
          parts.map(boundsOf),
        ),
      );
    };
    const fitMap = () => {
      const { map, positions } = store.get();
      const points = Object.values(positions);
      if (points.length === 0) return;
      const rooms = map.sectors.map(sectorVertices);
      const inRooms = new Set(rooms.flat());
      const parts = [
        ...rooms.map((room) => room.flatMap((key) => positions[key] ?? [])),
        ...Object.keys(positions)
          .filter((key) => !inRooms.has(key))
          .map((key) => [positions[key]]),
      ].filter((part) => part.length > 0);
      fitPoints(points, 1.25, parts);
      fittedView = store.get().viewport;
    };
    const getIsFitView = () => {
      const { x, y, zoom } = store.get().viewport;
      return (
        fittedView !== null &&
        fittedView.x === x &&
        fittedView.y === y &&
        fittedView.zoom === zoom
      );
    };
    const fitSelection = () => {
      const { map, positions, selection } = store.get();
      const { sectors, things } = pickedParts();
      const keys = [
        ...selection.flatMap((key) =>
          key.startsWith(wallKeyPrefix)
            ? key.slice(wallKeyPrefix.length).split("|")
            : [key],
        ),
        ...map.sectors
          .filter((sector) => sectors.includes(sector.id))
          .flatMap(sectorVertices),
        ...things.map((id) => `${thingKeyPrefix}${id}`),
      ];
      const points = keys.flatMap((key) => positions[key] ?? []);
      if (points.length === 0) fitMap();
      else fitPoints(points, 4);
    };

    const selectedTarget = (): MapTarget => {
      const { selection, activeSector, highlightedWall, map } = store.get();
      const rooms = pickedRooms(
        map,
        selection.filter((key) => key.startsWith(roomKeyPrefix)),
        null,
      );
      if (rooms[0]) {
        return {
          kind: "room",
          sector: rooms[0],
          point: null,
          keepSelection: true,
        };
      }
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
        if (item) {
          return targetForKeys([`${switchKeyPrefix}${item.id}`], point);
        }
        const target = wallTarget(wall.sector, wall.wall, point);
        // A wall that is one of several selected keeps the rest selected.
        return selectedWalls().length > 1 &&
          state.selection.includes(`${wallKeyPrefix}${wall.wall}`)
          ? { ...target, keepSelection: true }
          : target;
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
        // A hidden pane has no size to fit until it is first shown. After
        // that, the map is fitted again until the view is panned or zoomed.
        const observer = new ResizeObserver(() => {
          reportView();
          if (element.clientWidth === 0 || element.clientHeight === 0) return;
          if (fitted) {
            if (getIsFitView()) fitMap();
            return;
          }
          fitMap();
          fitted = true;
          if (findAfterFit) findCamera();
          if (focusAfterFit) centerOn(focusAfterFit);
        });
        observer.observe(element);
        return () => {
          stopCamera?.();
          stopView();
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
        // drag of a room take a mouse or a pen. The middle button, or Space
        // held down, pans instead.
        const fine = event.pointerType !== "touch" && event.button === 0;
        if (event.button !== 0 || spaceHeld) {
          viewport.pointerdown(event);
          return;
        }
        const at = viewport.toCanvas(event.clientX, event.clientY);
        const surface = root();
        if (!surface) return;
        const adding = event.shiftKey || event.ctrlKey || event.metaKey;
        // In line mode a wall drags by its corners, with every selected wall
        // when it is one of them.
        if (editMode === "lines") {
          const wall = wallNear(map, at, wallReach / view.zoom);
          if (wall && !adding) {
            const walls = selectedWalls();
            const group = walls.includes(wall.wall) ? walls : [wall.wall];
            if (group.length === 1) pickWalls(group, wall);
            carried = [...new Set(group.flatMap((item) => item.split("|")))];
            move.pointerdown(event, carried[0], surface);
            event.preventDefault();
            return;
          }
        }
        // In sector mode a room drags with everything picked, and a room not
        // yet picked is picked first.
        if (editMode === "sectors" && fine) {
          const room = sectorAt(map, at);
          if (room && !adding) {
            const { selection, positions } = store.get();
            const held = pickedParts().sectors.includes(room.id);
            if (!held) select([], room.id);
            carried = held
              ? [
                  ...new Set([
                    ...partKeys(map, pickedParts()),
                    ...movableKeys(selection, positions),
                  ]),
                ]
              : partKeys(map, selectedParts(map, [], room.id));
            move.pointerdown(event, carried[0], surface);
            // The move turns away a press that is already cancelled, so the
            // page's text selection is held off only after it has begun.
            event.preventDefault();
            return;
          }
        }
        // A finger or a pen has no Shift or middle button, so it pans.
        if (event.pointerType !== "mouse") {
          viewport.pointerdown(event);
          return;
        }
        // The browser would stretch the page's text selection to here.
        event.preventDefault();
        startMarquee(
          event,
          event.shiftKey
            ? "add"
            : event.ctrlKey || event.metaKey
              ? "remove"
              : "replace",
        );
      },
      pointerleave() {
        pointer = null;
        hover(null);
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
        hover(event.buttons === 0 ? pointer : null);
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
          const placed = addThing(
            map,
            thingKind,
            point,
            0,
            1,
            context.options().thingType,
          );
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
            if (!wall) {
              if (!event.shiftKey) select([]);
              return;
            }
            const walls = selectedWalls();
            const { highlightedWall } = store.get();
            const current =
              highlightedWall && !walls.includes(highlightedWall)
                ? [...walls, highlightedWall]
                : walls;
            if (!event.shiftKey) {
              pickWalls([wall.wall], wall);
              return;
            }
            const next = current.includes(wall.wall)
              ? current.filter((item) => item !== wall.wall)
              : [...current, wall.wall];
            if (next.length === 0) select([]);
            else pickWalls(next, next.includes(wall.wall) ? wall : null);
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
        // Space held over the map pans with the pointer, though a focused
        // button inside it still presses.
        if (event.key === " " && event.target === root()) {
          spaceHeld = true;
          event.preventDefault();
          return;
        }
        if (tool === "select") {
          const all = matchesShortcut(event, currentKeys().selectAll);
          const invert = matchesShortcut(event, currentKeys().invertSelection);
          if (all || invert) {
            selectEverything(invert);
            event.preventDefault();
            return;
          }
          if (shiftHeights(event)) {
            event.preventDefault();
            return;
          }
          if (event.key === "Escape" && store.get().selection.length > 0) {
            select([]);
            event.preventDefault();
            return;
          }
        }
        if (
          ((event.key === "Delete" || event.key === "Backspace") &&
            deleteSelection()) ||
          (event.key === "Insert" &&
            pointer !== null &&
            ((tool === "select" && insertCorner(pointer)) ||
              ((tool === "select" || tool === "thing") &&
                insertThing(pointer)))) ||
          (tool === "select" && nudgeSelection(event))
        ) {
          event.preventDefault();
          return;
        }
        viewport.keydown(event);
      },
      keyup(event: KeyboardEvent) {
        if (event.key === " ") spaceHeld = false;
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
        keyup: (event, { api }) => api.keyup(event),
        blur: (_event, { api }) => api.keyup({ key: " " } as KeyboardEvent),
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
        selection: ({ key, props }) => [
          ...props.corners,
          `${roomKeyPrefix}${key}`,
        ],
        hoverRooms: ({ key }) => [key],
      }),
      attrs: (state, { key, props }) => ({
        d: sectorPath(state, props.corners, props.holes),
        "data-active": state.activeSector === key ? "" : undefined,
        "data-hover": state.hoverRooms.includes(key) ? "" : undefined,
        "data-selected":
          state.selection.includes(`${roomKeyPrefix}${key}`) ||
          props.corners.every((corner) => state.selection.includes(corner))
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
        selection: ({ key }) => [`${wallKeyPrefix}${key}`],
        hoverWall: ({ key }) => [key],
      }),
      attrs: (state, { key, props }) => ({
        ...wallAttrs(state, props.from, props.to),
        "data-selected":
          state.highlightedWall === key ||
          state.selection.includes(`${wallKeyPrefix}${key}`)
            ? ""
            : undefined,
        "data-hover": state.hoverWall === key ? "" : undefined,
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

// The keys a mode works on, within a box or, without one, on the whole map.
function boxedKeys(
  map: GameMap,
  positions: Record<string, Point>,
  editMode: EditMode,
  box: Box | null,
) {
  const holds = (point: Point | undefined) =>
    point !== undefined &&
    (!box ||
      (point.x >= box.left &&
        point.x <= box.right &&
        point.y >= box.top &&
        point.y <= box.bottom));
  const things = Object.keys(positions).filter(
    (key) => key.startsWith(thingKeyPrefix) && holds(positions[key]),
  );
  if (editMode === "things") return things;
  if (editMode === "lines") {
    return [...wallOwners(map).keys()]
      .filter((wall) =>
        wall.split("|").every((corner) => holds(map.vertices[corner])),
      )
      .map((wall) => `${wallKeyPrefix}${wall}`);
  }
  if (editMode === "sectors") {
    return [
      ...map.sectors
        .filter((sector) =>
          sector.vertices.every((corner) => holds(map.vertices[corner])),
        )
        .map((sector) => `${roomKeyPrefix}${sector.id}`),
      ...things,
    ];
  }
  return [
    ...Object.keys(map.vertices).filter((key) => holds(map.vertices[key])),
    ...things,
  ];
}

// The selection's keys that move, with a selected wall moving by its corners.
function movableKeys(selection: string[], positions: Record<string, Point>) {
  return [
    ...new Set(
      selection.flatMap((key) =>
        key.startsWith(wallKeyPrefix)
          ? key.slice(wallKeyPrefix.length).split("|")
          : key in positions && !key.startsWith(switchKeyPrefix)
            ? [key]
            : [],
      ),
    ),
  ];
}

function roomCornerKeys(map: GameMap, key: string) {
  const id = key.slice(roomKeyPrefix.length);
  const room = map.sectors.find((sector) => sector.id === id);
  return room ? sectorVertices(room) : [];
}

function taggedBy(map: GameMap, wall: string) {
  const line = map.lines?.[wall];
  return line?.action?.tag ?? line?.raw?.tag ?? 0;
}

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
        drawShape === "rectangle" ||
        drawShape === "ellipse" ||
        drawShape === "grid"
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
