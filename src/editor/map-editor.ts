import {
  bindDrag,
  createChange,
  createConnect,
  createMove,
  createViewport,
  css,
  definePrimitive,
  dragThreshold,
  live,
  type ChangeDetails,
  type ConnectDraft,
  type MoveDraft,
  type Viewport,
} from "@ui-sdk/core";
import { createParts } from "@ui-sdk/react/primitive";

import { thingKinds } from "../map/catalog";
import {
  addRoom,
  addRoomOnSide,
  addSwitch,
  addSwitchInRoom,
  addThing,
  applyPositions,
  defaultDoor,
  doorKeyPrefix,
  freeWallNear,
  gridSize,
  positionsOf,
  removeSector,
  removeSwitch,
  removeThing,
  roomCenter,
  setRoomDoor,
  snapPoint,
  switchKeyPrefix,
  thingKeyPrefix,
  updateSector,
  updateSwitch,
  type RoomSide,
} from "../map/edit";
import { sectorAt } from "../map/geometry";
import type { Camera } from "../preview/render";
import type { SceneCamera } from "../preview/scene-camera";
import type {
  DoorSettings,
  GameMap,
  Point,
  Sector,
  ThingKind,
} from "../map/types";

type MapTool = "select" | "draw" | "thing" | "switch";

type MapChangeReason =
  | "drag"
  | "move-key"
  | "imperative"
  | "draw"
  | "place"
  | "delete"
  | "connect-key"
  | "agent";

type MapEditorOptions = {
  map?: GameMap;
  tool?: MapTool;
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
  lookAtRequest?: { id: number; clientX: number; clientY: number } | null;
};

type MapEditorState = {
  map: GameMap;
  positions: Record<string, Point>;
  viewport: Viewport;
  moving: MoveDraft | null;
  connecting: ConnectDraft | null;
  tool: MapTool;
  thingKind: ThingKind;
  activeSector: string | null;
  selection: string[];
  drawing: Point[];
  cursor: Point | null;
  cameraPosition: Camera | null;
  highlightedWall: string | null;
};

const emptyMap: GameMap = {
  vertices: {},
  sectors: [],
  things: [],
  switches: [],
};
const hiddenLine = { x1: "0", y1: "0", x2: "0", y2: "0" };
const clickSlop = 4;
const switchReach = 32;
const cameraNudge = 16;
const agentHeightLimit = 2048;
const agentDepthLimit = 4096;

function agentNumber(value: number, min: number, max: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a number.`);
  return Math.max(min, Math.min(max, Math.round(value)));
}

function agentHeights(floor: number, ceiling: number) {
  const heights = {
    floor: agentNumber(floor, -agentHeightLimit, agentHeightLimit, "Floor"),
    ceiling: agentNumber(
      ceiling,
      -agentHeightLimit,
      agentHeightLimit,
      "Ceiling",
    ),
  };
  if (heights.ceiling <= heights.floor) {
    throw new Error("The ceiling must be above the floor.");
  }
  return heights;
}

function pointOf(state: MapEditorState, key: string): Point {
  const base = state.positions[key] ?? { x: 0, y: 0 };
  const { moving } = state;
  return moving?.keys.includes(key)
    ? { x: base.x + moving.dx, y: base.y + moving.dy }
    : base;
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
  const vertices =
    state.map.sectors.find((sector) => sector.id === id)?.vertices ?? [];
  const points = vertices.map((vertex) => pointOf(state, vertex));
  const count = points.length || 1;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / count,
    y: points.reduce((sum, point) => sum + point.y, 0) / count,
  };
}

function lineAttrs(a: Point, b: Point) {
  return {
    x1: String(a.x),
    y1: String(a.y),
    x2: String(b.x),
    y2: String(b.y),
  };
}

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

function polygonPoints(state: MapEditorState, id: string) {
  const sector = state.map.sectors.find((item) => item.id === id);
  return (sector?.vertices ?? [])
    .map((vertex) => {
      const point = pointOf(state, vertex);
      return `${point.x},${point.y}`;
    })
    .join(" ");
}

function draftPoints(state: MapEditorState) {
  const points = state.cursor
    ? [...state.drawing, state.cursor]
    : state.drawing;
  return points.map((point) => `${point.x},${point.y}`).join(" ");
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

function wallAttrs(state: MapEditorState, from: string, to: string) {
  return lineAttrs(pointOf(state, from), pointOf(state, to));
}

const mapEditor = definePrimitive({
  name: "map-editor",
  options: {
    map: "value",
    tool: "string",
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
    lookAtRequest: "value",
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
      thingKind: options.thingKind ?? "imp",
      activeSector: options.activeSector ?? null,
      selection: options.selection ?? [],
      drawing: [],
      cursor: null,
      cameraPosition: options.camera?.position ?? null,
      highlightedWall: options.highlightedWall ?? null,
    };
  },
  sync: (options) => ({
    ...(options.map
      ? { map: options.map, positions: positionsOf(options.map) }
      : {}),
    ...(options.tool ? { tool: options.tool } : {}),
    ...(options.thingKind ? { thingKind: options.thingKind } : {}),
    ...(options.activeSector !== undefined
      ? { activeSector: options.activeSector }
      : {}),
    ...(options.selection ? { selection: options.selection } : {}),
    highlightedWall: options.highlightedWall ?? null,
  }),
  live: [
    "viewport",
    "moving",
    "connecting",
    "cursor",
    "drawing",
    "cameraPosition",
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

    const move = createMove<MapEditorState>(context, {
      key: "positions",
      draft: "moving",
      step: () => gridSize,
      scale: () => store.get().viewport.zoom,
      disabled: (key) =>
        store.get().tool !== "select" || key.startsWith(switchKeyPrefix),
      group: (key) => {
        const { selection } = store.get();
        return selection.includes(key) ? selection : [key];
      },
      set: (positions, details) =>
        change("map", applyPositions(store.get().map, positions), details),
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

    let lastDraft: MoveDraft | null = null;
    const stopWatching = store.subscribe(() => {
      const { moving, map, positions } = store.get();
      if (moving === lastDraft) return;
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
    let findAfterFit = false;
    let stopCameraDrag: (() => void) | undefined;
    let findRequest = context.options().findCameraRequest ?? 0;
    let lookRequest = context.options().lookAtRequest?.id ?? 0;

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
    context.onDestroy(() => stopCameraDrag?.());

    const moveCamera = (point: Point) =>
      context.options().camera?.moveTo(store.get().map, snapPoint(point));

    const select = (selection: string[], sector: string | null = null) => {
      change("selection", selection, { reason: "select" });
      change("activeSector", sector, { reason: "select" });
      context.options().onMapSelect?.();
    };

    const pointFromEvent = (event: MouseEvent) => {
      const { x, y } = viewport.toCanvas(event.clientX, event.clientY);
      return snapPoint({ x, y });
    };

    const finishRoom = () => {
      const { drawing, map } = store.get();
      if (drawing.length < 3) return;
      const room = addRoom(map, drawing);
      store.set({ drawing: [], cursor: null });
      change("map", room.map, { reason: "draw" });
      select([], room.id);
      change("tool", "select", { reason: "draw" });
    };

    const clickDraw = (point: Point) => {
      const { drawing } = store.get();
      const first = drawing[0];
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

    const deleteSelection = () => {
      const { map, selection, activeSector } = store.get();
      const idsWith = (prefix: string) =>
        selection
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length));
      const things = idsWith(thingKeyPrefix);
      const switches = idsWith(switchKeyPrefix);
      if (things.length > 0 || switches.length > 0) {
        change(
          "map",
          switches.reduce(removeSwitch, things.reduce(removeThing, map)),
          { reason: "delete" },
        );
        select([]);
        return true;
      }
      if (activeSector) {
        change("map", removeSector(map, activeSector), { reason: "delete" });
        select([]);
        return true;
      }
      return false;
    };

    const findRoom = (name: string): Sector => {
      const { map } = store.get();
      const wanted = name.toLowerCase();
      const room = map.sectors.find(
        (sector) => sector.id === name || sector.name.toLowerCase() === wanted,
      );
      if (!room) {
        const rooms = map.sectors.map((sector) => sector.name).join(", ");
        throw new Error(`No room named "${name}". Rooms: ${rooms}.`);
      }
      return room;
    };

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
        // A hidden pane has no size to fit until it is first shown.
        const observer = new ResizeObserver(() => {
          if (element.clientWidth === 0 || element.clientHeight === 0) return;
          observer.disconnect();
          this.fitMap();
          fitted = true;
          if (findAfterFit) findCamera();
        });
        observer.observe(element);
        return () => {
          stopCamera?.();
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
        moveCamera(viewport.toCanvas(event.clientX, event.clientY));
      },
      pressCamera(event: PointerEvent, el: HTMLElement) {
        const camera = context.options().camera;
        if (!camera || store.get().tool !== "select") return;
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
        const direction = {
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
        }[event.key];
        if (!position || !direction) return;
        event.preventDefault();
        moveCamera({
          x: position.x + direction[0] * cameraNudge,
          y: position.y + direction[1] * cameraNudge,
        });
      },
      rooms: () =>
        store.get().map.sectors.map((sector) => ({
          value: sector.id,
          label: sector.name,
        })),
      fitMap() {
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
      },
      addConnectedRoom(
        room: string,
        side: RoomSide,
        depth = 192,
        floor?: number,
        ceiling?: number,
      ) {
        const source = findRoom(room);
        const roomDepth = agentNumber(
          depth,
          gridSize,
          agentDepthLimit,
          "Depth",
        );
        const added = addRoomOnSide(
          store.get().map,
          source.id,
          side,
          roomDepth,
          {
            ...(floor === undefined && ceiling === undefined
              ? { floor: source.floor, ceiling: source.ceiling }
              : agentHeights(floor ?? source.floor, ceiling ?? source.ceiling)),
            light: source.light,
            floorTexture: source.floorTexture,
            ceilingTexture: source.ceilingTexture,
            wallTexture: source.wallTexture,
          },
        );
        if (!added) {
          throw new Error(`${source.name} has no free wall facing ${side}.`);
        }
        change("map", added.map, { reason: "agent" });
        select([], added.id);
        return added.id;
      },
      setRoomHeights(room: string, floor: number, ceiling: number) {
        const { id } = findRoom(room);
        change(
          "map",
          updateSector(store.get().map, id, agentHeights(floor, ceiling)),
          { reason: "agent" },
        );
      },
      makeDoor(
        room: string,
        opensBy: DoorSettings["opensBy"] = "use",
        closes = true,
      ) {
        const { id } = findRoom(room);
        change(
          "map",
          setRoomDoor(store.get().map, id, {
            ...defaultDoor,
            opensBy,
            closes,
          }),
          { reason: "agent" },
        );
      },
      addDoorSwitch(room: string, door: string) {
        const source = findRoom(room);
        const target = findRoom(door);
        if (!target.door) throw new Error(`${target.name} is not a door.`);
        const added = addSwitchInRoom(store.get().map, source.id, target.id);
        if (!added) throw new Error(`${source.name} has no free wall.`);
        change("map", added.map, { reason: "agent" });
        return added.id;
      },
      placeThing(kind: ThingKind, room: string) {
        if (!thingKinds.includes(kind)) {
          throw new Error(`Unknown thing. Use: ${thingKinds.join(", ")}.`);
        }
        const { map } = store.get();
        const placed = addThing(map, kind, roomCenter(map, findRoom(room)));
        change("map", placed.map, { reason: "agent" });
        return placed.id;
      },
      pointerdown(event: PointerEvent) {
        press = { x: event.clientX, y: event.clientY };
        root()?.focus({ preventScroll: true });
        const target = event.target as Element;
        if (target.closest("[data-map-control], [data-map-key]")) return;
        if (store.get().tool === "select") {
          viewport.pointerdown(event);
        }
      },
      pointermove(event: PointerEvent) {
        if (store.get().tool === "draw") {
          store.set({ cursor: pointFromEvent(event) });
        }
      },
      click(event: MouseEvent) {
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
        } else if (tool === "thing") {
          const placed = addThing(map, thingKind, point);
          change("map", placed.map, { reason: "place" });
          select([`${thingKeyPrefix}${placed.id}`]);
        } else if (tool === "switch") {
          const at = viewport.toCanvas(event.clientX, event.clientY);
          const wall = freeWallNear(map, at, switchReach / view.zoom);
          if (!wall) return;
          const added = addSwitch(map, wall, at);
          change("map", added.map, { reason: "place" });
          select([`${switchKeyPrefix}${added.id}`]);
          change("tool", "select", { reason: "draw" });
        } else if (!key) {
          select([], sectorAt(map, point)?.id ?? null);
        }
      },
      keydown(event: KeyboardEvent) {
        if (event.defaultPrevented) return;
        const { tool, drawing } = store.get();
        if (tool === "draw") {
          if (event.key === "Enter") finishRoom();
          else if (event.key === "Escape") {
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
        if (
          (event.key === "Delete" || event.key === "Backspace") &&
          deleteSelection()
        ) {
          event.preventDefault();
          return;
        }
        viewport.keydown(event);
      },
      pressPort(event: PointerEvent, key: string, el: HTMLElement) {
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
        if (store.get().tool !== "select") return;
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
        click: (event, { api }) => api.click(event),
        dblclick: (event, { api }) => api.doubleClick(event),
        keydown: (event, { api }) => api.keydown(event),
      },
    }),
    world: slot({
      attrs: () => ({
        style: css({ position: "absolute", left: "0", top: "0" }),
      }),
      live: live<MapEditorState, any, {}>((state, { api }) => ({
        style: api.viewport.style(state),
      })),
    }),
    sector: slot<{ value: string }>({
      props: { value: "string" },
      attrs: (state, { key }) => ({
        points: polygonPoints(state, key),
        "data-active": state.activeSector === key ? "" : undefined,
        "data-door": state.map.sectors.find((sector) => sector.id === key)?.door
          ? ""
          : undefined,
      }),
      live: live<MapEditorState, any, { value: string }>((state, { key }) => ({
        points: polygonPoints(state, key),
      })),
    }),
    wall: slot<{ value: string; from: string; to: string }>({
      props: { value: "string", from: "string", to: "string" },
      attrs: (state, { key, props }) => ({
        ...wallAttrs(state, props.from, props.to),
        "data-selected": state.highlightedWall === key ? "" : undefined,
      }),
      live: live<
        MapEditorState,
        any,
        { value: string; from: string; to: string }
      >((state, { props }) => wallAttrs(state, props.from, props.to)),
    }),
    draft: slot({
      attrs: (state) => ({ points: draftPoints(state) }),
      live: live<MapEditorState, any, {}>((state) => ({
        points: draftPoints(state),
      })),
    }),
    handle: slot<{ value: string }>({
      props: { value: "string" },
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
      live: live<MapEditorState, any, { value: string }>(
        (state, { api, key }) => ({
          style: api.move.style(state, key),
          "data-dragging": api.move.dragging(state, key) ? "" : undefined,
        }),
      ),
      on: {
        keydown: (event, { api, key }) => api.move.keydown(event, key),
        pointerdown: (event, { api, el, key }) =>
          api.pressHandle(event, key, el!),
      },
    }),
    port: slot<{ value: string }>({
      props: { value: "string" },
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
      live: live<MapEditorState, any, { value: string }>(
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
          api.pressPort(event, key, el!),
      },
    }),
    wire: slot<{ value: string; from: string; to: string }>({
      props: { value: "string", from: "string", to: "string" },
      attrs: (state, { props }) =>
        lineAttrs(portPoint(state, props.from), portPoint(state, props.to)),
      live: live<
        MapEditorState,
        any,
        { value: string; from: string; to: string }
      >((state, { props }) =>
        lineAttrs(portPoint(state, props.from), portPoint(state, props.to)),
      ),
    }),
    connecting: slot({
      attrs: (state) => connectingAttrs(state),
      live: live<MapEditorState, any, {}>((state) => connectingAttrs(state)),
    }),
    camera: slot({
      attrs: (state) => ({
        type: "button",
        "data-map-key": "camera",
        style: cameraStyle(state),
      }),
      live: live<MapEditorState, any, {}>((state) => ({
        style: cameraStyle(state),
      })),
      on: {
        keydown: (event, { api }) => api.cameraKeydown(event),
        pointerdown: (event, { api, el }) => api.pressCamera(event, el!),
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
    actions: [
      "addConnectedRoom",
      "setRoomHeights",
      "placeThing",
      "makeDoor",
      "addDoorSwitch",
    ],
    items: (api) => api.rooms(),
  },
});

const parts = createParts(mapEditor, {
  root: "div",
  world: "div",
  sector: "polygon",
  wall: "line",
  draft: "polyline",
  handle: "button",
  port: "button",
  wire: "line",
  connecting: "line",
  camera: "button",
  findCamera: "button",
  lookHere: "button",
  fit: "button",
});

const MapEditor = parts.Root;
const MapWorld = parts.World;
const MapSector = parts.Sector;
const MapWall = parts.Wall;
const MapDraft = parts.Draft;
const MapHandle = parts.Handle;
const MapPort = parts.Port;
const MapWire = parts.Wire;
const MapConnecting = parts.Connecting;
const MapFit = parts.Fit;
const MapCamera = parts.Camera;
const MapFindCamera = parts.FindCamera;
const MapLookHere = parts.LookHere;

export {
  MapCamera,
  MapConnecting,
  MapDraft,
  MapEditor,
  MapFindCamera,
  MapFit,
  MapHandle,
  MapLookHere,
  MapPort,
  MapSector,
  MapWall,
  MapWire,
  MapWorld,
  type MapTool,
};
