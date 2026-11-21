"use client";

import {
  createLocalStorage,
  createUndoStack,
  matchesShortcut,
} from "@ui-sdk/core";
import { useShortcut } from "@ui-sdk/react/shortcuts";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import {
  Resizable,
  ResizableHandle,
  ResizablePanel,
} from "@ui-sdk/react/resizable";
import {
  CircleCheck,
  CircleX,
  CircleDot,
  Ellipsis,
  Pentagon,
  PenLine,
  Play,
  Redo2,
  StickyNote,
  Slash,
  TriangleAlert,
  Undo2,
  Users,
  Waypoints,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { agent } from "../agent";
import { BuildDialog } from "./build-dialog";
import { ShortcutSheet } from "./shortcut-sheet";
import { editorShortcuts, type EditorShortcut } from "./shortcuts";
import { MapContextMenu } from "./context-menu";
import {
  LineInspector,
  SectorInspector,
  SwitchInspector,
  ThingInspector,
} from "./inspector";
import { MapCanvas } from "./map-canvas";
import { NewMapPanel } from "./new-map-panel";
import {
  normalizeControlClick,
  pointOfTarget,
  targetExists,
  targetForIssue,
  targetForKeys,
  targetForSurface,
  viewOfTarget,
  type MapTarget,
} from "./map-target";
import type { EditMode, MapTool, MapViewStatus } from "./map-editor";
import { PlayTogether, type HostedGame } from "../engine/play-together";
import { GameView, type PlayerSpot } from "../engine/play-panel";
import { thingCatalog } from "../map/catalog";
import {
  addPlayerStarts,
  addNote,
  addSwitch,
  duplicateThings,
  freeWallAt,
  removeNote,
  setLineTarget,
  setRoomDoor,
  setRoomWalls,
  switchKeyPrefix,
  gridSize,
  thingKeyPrefix,
  updateLine,
  updateLineSide,
  updateSector,
  updateSwitch,
  updateThings,
  type RoomSide,
} from "../map/edit";
import { describeLine } from "../map/lines";
import {
  MapFileError,
  maxFileBytes,
  parseMapFile,
  serializeMap,
} from "../map/storage";
import type { GameMap, Point, ThingCategory, ThingKind } from "../map/types";
import { checkMap, fixIssue, issueText } from "../map/checks";
import { MapSwitcher, type EpisodeEntry, type MapHealth } from "./map-switcher";
import { validateMap } from "../map/validate";
import { loadIwad } from "../engine/iwad";
import { SceneCamera } from "../preview/scene-camera";
import { SceneCanvas, type DraftSource } from "../preview/scene-editor";
import { SurfacePanel } from "../preview/surface-panel";
import {
  describeSurface,
  paintSurface,
  parseSurface,
  surfaceKey,
} from "../map/surfaces";
import { sectorAt, wallKey, wallOwners } from "../map/geometry";
import { createFlatAssets, readWadAssets } from "../wad/assets";
import { compileMap } from "../wad/compile";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  createMenuController,
  Menu,
  MenuContent,
  MenuContextTrigger,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu";

const modeHints: Record<EditMode, string> = {
  vertices:
    "Drag corners to reshape rooms, or nudge them with the arrow keys. Shift-click adds to the selection.",
  lines: "Click a wall to change its textures or what it does.",
  sectors: "Click a room to select it. Drag its corners to reshape it.",
  things:
    "Click a thing to select it, or pick one in the inspector to place it.",
};

const toolHints: Record<Exclude<MapTool, "select">, string> = {
  draw: "Click corners, then click the first one or press Enter. Reuse a wall's corners to connect rooms.",
  thing:
    "Click a floor to place it, or press Enter in 3D to place it ahead. Esc stops placing.",
  switch:
    "Click a solid wall to add a switch, then drag from it to a door. Esc cancels.",
};

const roomSides: RoomSide[] = ["north", "east", "south", "west"];

type ViewLayout = "map" | "split" | "scene";
type SinglePane = Exclude<ViewLayout, "split">;

const thingCategoryLabels: Record<ThingCategory, string> = {
  start: "Start",
  enemy: "Enemy",
  item: "Item",
  key: "Key",
  decor: "Decor",
};

const savedLayout = createLocalStorage("wadsmith:layout");
const savedWelcome = createLocalStorage("wadsmith:welcomed");
// Below this width, two panes can't hold the map controls and a usable 3D view.
const narrowQuery = "(max-width: 1100px)";
const defaultSplit = [50, 50];

type RailMode = EditMode | "draw";

const railModes: {
  value: RailMode;
  label: string;
  shortcut: EditorShortcut;
  icon: typeof PenLine;
}[] = [
  { value: "vertices", label: "Vertex", shortcut: "vertices", icon: Waypoints },
  { value: "lines", label: "Line", shortcut: "lines", icon: Slash },
  { value: "sectors", label: "Sector", shortcut: "sectors", icon: Pentagon },
  { value: "things", label: "Thing", shortcut: "things", icon: CircleDot },
  { value: "draw", label: "Draw", shortcut: "draw", icon: PenLine },
];

const modeNames: Record<RailMode, string> = {
  vertices: "Vertices",
  lines: "Lines",
  sectors: "Sectors",
  things: "Things",
  draw: "Draw",
};

function loadLayout() {
  try {
    const saved = JSON.parse(savedLayout.get() ?? "null");
    return {
      view: ["map", "split", "scene"].includes(saved?.view)
        ? (saved.view as ViewLayout)
        : ("map" as ViewLayout),
      dock: saved?.dock !== false,
      sizes:
        Array.isArray(saved?.sizes) &&
        saved.sizes.length === 2 &&
        saved.sizes.every(Number.isFinite)
          ? (saved.sizes as number[])
          : defaultSplit,
    };
  } catch {
    return { view: "map" as ViewLayout, dock: true, sizes: defaultSplit };
  }
}

function saveLayout(view: ViewLayout, sizes: number[], dock: boolean) {
  savedLayout.set(JSON.stringify({ view, sizes, dock }));
}

// Without storage the card would come back on every visit.
function loadWelcomed() {
  return !savedWelcome.available() || savedWelcome.get() !== null;
}

function subscribeNarrow(listener: () => void) {
  const query = matchMedia(narrowQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function isNarrow() {
  return matchMedia(narrowQuery).matches;
}

function createDraftChannel() {
  const listeners = new Set<(map: GameMap | null) => void>();
  const subscribe: DraftSource = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const publish = (map: GameMap | null) => {
    for (const listener of listeners) listener(map);
  };
  return { subscribe, publish };
}

const listRoles = '[role="combobox"], [role="listbox"], [role="menu"]';

function shortcut(name: EditorShortcut, when?: () => boolean) {
  return {
    description: editorShortcuts[name].description,
    when: () => !document.querySelector(".game-stage") && (when?.() ?? true),
  };
}

// Letters belong to typeahead in open lists, and to walking in the 3D view.
function mapKeys() {
  return !document.activeElement?.closest(listRoles);
}

function modeKeys() {
  return mapKeys() && !document.activeElement?.closest(".scene");
}

function notTyping() {
  const focused = document.activeElement;
  return !(
    focused instanceof HTMLElement &&
    (focused.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName))
  );
}

function downloadFile(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadWad(map: GameMap, slot: string, fileName: string) {
  downloadFile(
    fileName,
    compileMap(map, slot).slice().buffer,
    "application/octet-stream",
  );
}

type AppProps = {
  initialMap: GameMap;
  mapName: string;
  slot: string;
  par: number | null;
  saveStatus: "saving" | "saved" | "failed" | "session";
  onSave: (map: GameMap) => void;
  watchExternal: (listener: (map: GameMap) => void) => () => void;
  onOpenProjects: () => void;
  navigation: ReactNode;
  onNewMap: () => void;
  onMapSettings: () => void;
  playing: boolean;
  onPlayingChange: (playing: boolean, coop: boolean) => void;
  episode: {
    name: string;
    maps: EpisodeEntry[];
    currentId: string;
    canAddMap: boolean;
    onOpenMap: (id: string) => void;
  };
};

type PlayedGame = { map: GameMap; coop: HostedGame | null };

const saveLabels: Record<AppProps["saveStatus"], string> = {
  saving: "Saving…",
  saved: "Saved in this browser",
  failed: "Not saved: storage is unavailable",
  session: "Browser storage is off: saved for this session only",
};

function App({
  initialMap,
  mapName,
  slot,
  par,
  saveStatus,
  onSave,
  watchExternal,
  onOpenProjects,
  navigation,
  onNewMap,
  onMapSettings,
  playing,
  onPlayingChange,
  episode,
}: AppProps) {
  const [map, setMap] = useState(initialMap);
  const [tool, setTool] = useState<MapTool>("select");
  const [thingKind, setThingKind] = useState<ThingKind>("imp");
  const [activeSector, setActiveSector] = useState<string | null>("sector-3");
  const [selection, setSelection] = useState<string[]>([]);
  const [game, setGame] = useState<PlayedGame | null>(() =>
    playing ? { map: initialMap, coop: null } : null,
  );
  const [followed, setFollowed] = useState(playing);
  const [coopLobby, setCoopLobby] = useState(false);
  if (followed !== playing) {
    setFollowed(playing);
    setGame(playing ? (game ?? { map, coop: null }) : null);
  }
  const hosted = game?.coop ?? null;
  useEffect(() => () => hosted?.close(), [hosted]);
  const [mapVersion, setMapVersion] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [welcomed, setWelcomed] = useState(loadWelcomed);
  const playButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [agentLog, setAgentLog] = useState("");
  const [, setHistoryVersion] = useState(0);
  const [initialLayout] = useState(loadLayout);
  const [layout, setLayout] = useState(initialLayout.view);
  const [findCameraRequest, setFindCameraRequest] = useState(0);
  const [fitRequest, setFitRequest] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{
    id: number;
    point: Point;
  } | null>(null);
  const [drawRequest, setDrawRequest] = useState<{
    id: number;
    point: Point;
  } | null>(null);
  const [menu] = useState(() => createMenuController());
  const [menuTarget, setMenuTarget] = useState<MapTarget | null>(null);
  const menuTargetRef = useRef<MapTarget | null>(null);
  const menuOpen = useRef(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [building, setBuilding] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [draftCorners, setDraftCorners] = useState(0);
  const [showDock, setShowDock] = useState(initialLayout.dock);
  const [editMode, setEditMode] = useState<EditMode>("vertices");
  const pointerStatus = useRef<HTMLSpanElement>(null);
  const zoomStatus = useRef<HTMLSpanElement>(null);
  const mapCheck = useRef<HTMLElement>(null);
  const splitSizes = useRef(initialLayout.sizes);
  const hoveredPane = useRef<SinglePane | null>(null);
  const mapPointer = useRef<{ clientX: number; clientY: number } | null>(null);
  const [lookAtRequest, setLookAtRequest] = useState<{
    id: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow);
  const visibleLayout = narrow && layout === "split" ? "map" : layout;
  const [surface, setSurface] = useState<string | null>(null);
  const [assets, setAssets] = useState(createFlatAssets);
  const [drafts] = useState(createDraftChannel);
  const [camera] = useState(() => new SceneCamera(initialMap));
  const [history] = useState(() =>
    createUndoStack(initialMap, { limit: 200, groupDelay: 500 }),
  );

  const issues = useMemo(() => validateMap(map), [map]);
  const canPlay = issues.length === 0;
  const checks = useMemo(() => checkMap(map), [map]);
  const liveHealth: MapHealth = checks.some(
    (issue) => issue.severity === "error",
  )
    ? "error"
    : checks.length > 0
      ? "warning"
      : "ready";
  const warningCount = checks.length - issues.length;
  const checkSummary =
    checks.length === 0
      ? "No problems"
      : [
          issues.length > 0
            ? `${issues.length} ${issues.length === 1 ? "error" : "errors"}`
            : null,
          warningCount > 0
            ? `${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");
  const mapStatus =
    checks.length === 0
      ? "Ready"
      : `${checks.length} ${checks.length === 1 ? "problem" : "problems"}`;
  const callouts = useMemo(
    () =>
      issues.slice(0, 5).flatMap((issue) => {
        const target = issue.target ? targetForIssue(map, issue.target) : null;
        const point = target ? pointOfTarget(map, target) : null;
        return point
          ? [{ id: issue.id, ...point, text: issueText(issue).title }]
          : [];
      }),
    [issues, map],
  );
  const sector = map.sectors.find((item) => item.id === activeSector);
  const selectedThingKey = selection.find((key) =>
    key.startsWith(thingKeyPrefix),
  );
  const thing = map.things.find(
    (item) => `${thingKeyPrefix}${item.id}` === selectedThingKey,
  );
  const selectedThings = map.things.filter((item) =>
    selection.includes(`${thingKeyPrefix}${item.id}`),
  );

  const selectedSwitch = map.switches.find((item) =>
    selection.includes(`${switchKeyPrefix}${item.id}`),
  );
  const doors = map.sectors.filter((item) => item.door);

  const showMap = useCallback(
    (next: GameMap) => {
      setMap(next);
      onSave(next);
      setHistoryVersion((version) => version + 1);
    },
    [onSave],
  );

  const commit = (next: GameMap, group?: string) => {
    history.record(next, group ? { group } : undefined);
    showMap(next);
  };

  const restore = useCallback(
    (next: GameMap | undefined) => {
      if (!next) return;
      showMap(next);
      setSelection([]);
    },
    [showMap],
  );
  const undo = () => restore(history.undo());
  const redo = () => restore(history.redo());

  const selectedThingIds = selection
    .filter((key) => key.startsWith(thingKeyPrefix))
    .map((key) => key.slice(thingKeyPrefix.length));

  const duplicateSelection = () => {
    const copies = duplicateThings(map, selectedThingIds);
    if (copies.ids.length === 0) return;
    history.record(copies.map);
    showMap(copies.map);
    setSurface(null);
    setActiveSector(null);
    setSelection(copies.ids.map((id) => `${thingKeyPrefix}${id}`));
  };

  useShortcut(editorShortcuts.undo.keys, undo, shortcut("undo", notTyping));
  useShortcut(editorShortcuts.redo.keys, redo, shortcut("redo", notTyping));
  useShortcut(
    editorShortcuts.duplicate.keys,
    duplicateSelection,
    shortcut("duplicate", () => notTyping() && selectedThingIds.length > 0),
  );

  // The registry skips key repeats, and holding mod+Z should keep stepping back.
  const onHeldKey = useEffectEvent((event: KeyboardEvent) => {
    if (
      !event.repeat ||
      !notTyping() ||
      document.activeElement?.closest('[role="dialog"]') ||
      document.querySelector(".game-stage")
    ) {
      return;
    }
    if (matchesShortcut(event, editorShortcuts.redo.keys)) {
      event.preventDefault();
      redo();
    } else if (matchesShortcut(event, editorShortcuts.undo.keys)) {
      event.preventDefault();
      undo();
    } else if (matchesShortcut(event, editorShortcuts.duplicate.keys)) {
      event.preventDefault();
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onHeldKey);
    return () => window.removeEventListener("keydown", onHeldKey);
  }, []);
  useShortcut(
    editorShortcuts.help.keys,
    () => setShowShortcuts(true),
    shortcut("help"),
  );

  useEffect(() => {
    let active = true;
    loadIwad()
      .then((bytes) => {
        if (active) setAssets(readWadAssets(bytes));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const surfaceInfo = useMemo(
    () => describeSurface(map, surface),
    [map, surface],
  );

  useEffect(() => {
    camera.sync(map);
  }, [camera, map]);

  const changeLayout = useCallback(
    (next: ViewLayout) => {
      setLayout(next);
      saveLayout(next, splitSizes.current, showDock);
      if (next === "scene") {
        setTool((current) =>
          current === "draw" || current === "switch" ? "select" : current,
        );
      }
    },
    [showDock],
  );

  const chooseMode = useCallback(
    (mode: RailMode) => {
      if (mode === "draw") {
        if (visibleLayout !== "scene") setTool("draw");
        return;
      }
      setEditMode(mode);
      setTool("select");
    },
    [visibleLayout],
  );

  const togglePane = useCallback(
    (pane: SinglePane) => {
      if (narrow) return;
      changeLayout(visibleLayout === "split" ? pane : "split");
    },
    [changeLayout, narrow, visibleLayout],
  );

  useShortcut(
    editorShortcuts.vertices.keys,
    () => chooseMode("vertices"),
    shortcut("vertices", modeKeys),
  );
  useShortcut(
    editorShortcuts.lines.keys,
    () => chooseMode("lines"),
    shortcut("lines", modeKeys),
  );
  useShortcut(
    editorShortcuts.sectors.keys,
    () => chooseMode("sectors"),
    shortcut("sectors", modeKeys),
  );
  useShortcut(
    editorShortcuts.things.keys,
    () => chooseMode("things"),
    shortcut("things", modeKeys),
  );
  useShortcut(
    editorShortcuts.draw.keys,
    () => chooseMode("draw"),
    shortcut("draw", modeKeys),
  );
  useShortcut(
    editorShortcuts.look.keys,
    () => {
      const pointer = mapPointer.current;
      if (!pointer) return;
      setLookAtRequest((request) => ({
        ...pointer,
        id: (request?.id ?? 0) + 1,
      }));
    },
    shortcut("look", mapKeys),
  );
  useShortcut(
    editorShortcuts.pane.keys,
    (event) => {
      const focused = (event.target as Element).closest?.<HTMLElement>(
        "[data-pane]",
      )?.dataset.pane as SinglePane | undefined;
      togglePane(
        hoveredPane.current ??
          focused ??
          (visibleLayout === "scene" ? "scene" : "map"),
      );
    },
    shortcut("pane", mapKeys),
  );

  const findCameraOnMap = () => {
    if (visibleLayout === "scene") changeLayout(narrow ? "map" : "split");
    setFindCameraRequest((request) => request + 1);
  };

  const sceneSelection = useMemo(() => {
    if (surfaceInfo) return surface;
    const key = selection[0];
    if (key?.startsWith(thingKeyPrefix)) return key;
    if (key?.startsWith(switchKeyPrefix)) {
      const item = map.switches.find(
        (entry) => `${switchKeyPrefix}${entry.id}` === key,
      );
      return item
        ? surfaceKey({
            kind: "wall",
            sector: item.sector,
            wall: wallKey(item.from, item.to),
            part: "middle",
          })
        : null;
    }
    return activeSector
      ? surfaceKey({ kind: "floor", sector: activeSector })
      : null;
  }, [activeSector, map.switches, selection, surface, surfaceInfo]);
  const sceneInfo = useMemo(
    () => describeSurface(map, sceneSelection),
    [map, sceneSelection],
  );
  const parsedSurface = surface ? parseSurface(surface) : null;
  const selectedWall =
    surfaceInfo && parsedSurface?.kind === "wall" ? parsedSurface : null;
  const line =
    selectedWall && !selectedSwitch && !thing
      ? describeLine(map, selectedWall.wall, selectedWall.sector)
      : null;

  const selectSurface = (key: string | null) => {
    setSurface(key);
    // A thing placed in this same event isn't in this render's map yet.
    const parsed = key ? parseSurface(key) : null;
    if (parsed?.kind === "thing") {
      setActiveSector(null);
      setSelection([`${thingKeyPrefix}${parsed.thing}`]);
    } else {
      setSelection([]);
      setActiveSector(describeSurface(map, key)?.sector?.id ?? null);
    }
  };

  const selectTarget = (target: MapTarget) => {
    if (target.keepSelection) return;
    if (target.surface) {
      selectSurface(target.surface);
      return;
    }
    setSurface(null);
    if (target.kind === "room") {
      setSelection([]);
      setActiveSector(target.sector);
      return;
    }
    setActiveSector(null);
    if (target.kind === "things") {
      setSelection(target.ids.map((id) => `${thingKeyPrefix}${id}`));
    } else if (target.kind === "corners") {
      setSelection(target.ids);
    } else if (target.kind === "switch") {
      setSelection([`${switchKeyPrefix}${target.id}`]);
    } else {
      setSelection([]);
    }
  };

  const reportMenuTarget = (target: MapTarget | null) => {
    menuTargetRef.current = target;
    setMenuTarget(target);
    if (!menuOpen.current) return;
    if (target) selectTarget(target);
    else menu.close();
  };

  const reportSceneTarget = (
    key: string | null,
    point: Point | null,
    keyboard: boolean,
  ) => {
    const picked = key ? parseSurface(key) : null;
    const pressed =
      picked?.kind === "thing" ? `${thingKeyPrefix}${picked.thing}` : null;
    const group =
      keyboard || (pressed && selection.includes(pressed)) ? selection : [];
    const fromSelection =
      group.length > 0
        ? targetForKeys(group, point, pressed ?? undefined)
        : null;
    reportMenuTarget(
      fromSelection ?? (key ? targetForSurface(map, key, point) : null),
    );
  };

  const applyMenuSelection = ({
    keys,
    sector: nextSector,
  }: {
    keys?: string[];
    sector?: string | null;
  }) => {
    setSurface(null);
    if (keys) setSelection(keys);
    if (nextSector !== undefined) setActiveSector(nextSector);
  };

  const showTarget = (target: MapTarget) => {
    selectTarget({ ...target, keepSelection: false });
    const point = pointOfTarget(map, target);
    if (visibleLayout === "scene") changeLayout(narrow ? "map" : "split");
    if (point) {
      setFocusRequest((request) => ({ id: (request?.id ?? 0) + 1, point }));
    }
  };

  const showInScene = (target: MapTarget) => {
    const view = viewOfTarget(map, target);
    if (!view) return;
    camera.lookAt(map, view.from, view.at);
    if (visibleLayout === "map" && (narrow || !showDock)) {
      changeLayout(narrow ? "scene" : "split");
    }
  };

  const scene = (
    <MenuContextTrigger
      controller={menu}
      className="contents"
      onContextMenuCapture={normalizeControlClick}
    >
      <SceneCanvas
        aria-label="3D view. Click a surface to select it. W, A, S and D walk, N and P step through surfaces."
        className="screen scene"
        map={map}
        assets={assets}
        camera={camera}
        draftSource={drafts.subscribe}
        selected={surfaceInfo ? surface : null}
        linked={sceneInfo ? sceneSelection : null}
        placing={tool === "thing" ? thingKind : null}
        renderWidth={640}
        renderHeight={400}
        onMapChange={(next) => commit(next)}
        onSelectedChange={selectSurface}
        onContextSurface={reportSceneTarget}
        contextMenuOpen={contextMenuOpen}
      />
    </MenuContextTrigger>
  );

  const sceneStatus = (
    <p className="scene-status" role="status">
      {sceneInfo
        ? `${sceneInfo.label}${sceneInfo.texture ? ` · ${sceneInfo.texture}` : ""}${sceneInfo.height !== null ? ` · height ${sceneInfo.height}` : ""}`
        : "Click a floor, ceiling, wall or thing."}
    </p>
  );

  useEffect(
    () =>
      watchExternal((next) => {
        history.record(next);
        setMap(next);
        setSelection([]);
        setSurface(null);
        setHistoryVersion((version) => version + 1);
      }),
    [history, watchExternal],
  );

  useEffect(() => {
    if (menuOpen.current && menuTarget && !targetExists(map, menuTarget)) {
      menu.close();
    }
  }, [map, menu, menuTarget]);

  const buildProblem = () => {
    try {
      compileMap(map);
      setFileError(null);
      return false;
    } catch (error) {
      setFileError(`Couldn't build the map. ${(error as Error).message}`);
      return true;
    }
  };

  const lineCount = useMemo(() => wallOwners(map).size, [map]);

  const showMapCheck = () => {
    mapCheck.current?.scrollIntoView({ block: "nearest" });
    mapCheck.current?.focus();
  };

  const updateViewStatus = ({ pointer, zoom }: MapViewStatus) => {
    if (pointerStatus.current) {
      pointerStatus.current.textContent = pointer
        ? `X ${pointer.x}  Y ${-pointer.y}`
        : "X -  Y -";
    }
    if (zoomStatus.current) {
      zoomStatus.current.textContent = `Zoom ${Math.round(zoom * 100)}%`;
    }
  };

  const toggleDock = () => {
    const next = !showDock;
    setShowDock(next);
    saveLayout(layout, splitSizes.current, next);
  };

  const runViewAction = (action: string) => {
    if (action === "shortcuts") setShowShortcuts(true);
    else if (action === "dock") toggleDock();
    else if (action === "camera") findCameraOnMap();
    else changeLayout(action as ViewLayout);
  };

  const runMapAction = (action: string) => {
    if (action === "check") showMapCheck();
    else if (action === "play") play();
    else if (action === "coop") openCoop();
  };

  const thingRoom = thing ? sectorAt(map, thing) : null;
  const thingMeta = thing
    ? [
        `Thing ${String(map.things.indexOf(thing) + 1).padStart(2, "0")}`,
        thingCategoryLabels[thingCatalog[thing.kind].category],
        ...(thingRoom ? [thingRoom.name] : []),
      ].join(" · ")
    : "";
  const placingThings = editMode === "things" || tool === "thing";
  const roomSelected =
    !selectedSwitch &&
    !thing &&
    selectedThings.length < 2 &&
    !line &&
    !(surfaceInfo && !surfaceInfo.thing) &&
    !placingThings;
  const runQuickBuild = (action: string) => {
    if (!sector) return;
    if (action === "imp") runAgent("placeThing", ["imp", sector.name]);
    else if (action === "door") runAgent("makeDoor", [sector.name, "use"]);
    else runAgent("addConnectedRoom", [sector.name, action, 192]);
  };
  const railMode: RailMode =
    tool === "draw"
      ? "draw"
      : tool === "thing"
        ? "things"
        : tool === "switch"
          ? "lines"
          : editMode;
  const selectionTitle = selectedSwitch
    ? "Switch"
    : selectedThings.length > 1
      ? `${selectedThings.length} things`
      : thing
        ? thingCatalog[thing.kind].label
        : line
          ? `Line ${line.number}`
          : surfaceInfo && !surfaceInfo.thing
            ? surfaceInfo.label
            : placingThings
              ? "Things"
              : (sector?.name ?? "Nothing selected");
  const selectionMeta = selectedSwitch
    ? selectedSwitch.door
      ? "Wired to a door"
      : "Not connected"
    : selectedThings.length > 1
      ? "Changes apply to every selected thing"
      : thing
        ? thingMeta
        : placingThings
          ? tool === "thing"
            ? `Placing ${thingCatalog[thingKind].label}`
            : "Pick a thing to place"
          : line
            ? `${line.back ? "Two-sided" : "One-sided"} · ${line.length} long · ${
                line.back
                  ? `${line.front.name} to ${line.back.name}`
                  : line.front.name
              }`
            : sector
              ? `${sector.door ? "Door" : "Sector"} · ${sector.vertices.length} walls`
              : "Click a room, line or thing on the map";

  const play = () => {
    if (canPlay && !buildProblem()) {
      setGame({ map, coop: null });
      onPlayingChange(true, false);
    }
    dismissWelcome();
  };

  const dismissWelcome = () => {
    if (welcomed) return;
    setWelcomed(true);
    savedWelcome.set("1");
  };

  const canPlayCoop = canPlay;

  const openCoop = () => {
    if (canPlayCoop && !buildProblem()) setCoopLobby(true);
  };

  const editPlayedSpot = ({ angle, ...point }: PlayerSpot) => {
    setGame(null);
    onPlayingChange(false, false);
    camera.placeAt(map, point, angle);
    const room = sectorAt(map, point);
    showTarget(
      room
        ? { kind: "room", sector: room.id, point }
        : { kind: "empty", point },
    );
    if (narrow) changeLayout("scene");
    else if (visibleLayout === "map" && !showDock) changeLayout("split");
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(".map")?.focus(),
    );
  };

  const exitGame = () => {
    setGame(null);
    onPlayingChange(false, false);
    requestAnimationFrame(() => playButton.current?.focus());
  };

  const replaceMap = (next: GameMap) => {
    commit(next);
    setSelection([]);
    setActiveSector(null);
    setSurface(null);
    setFileError(null);
    setDraftCorners(0);
    camera.reset(next);
    setMapVersion((version) => version + 1);
  };

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > maxFileBytes) {
        throw new MapFileError("The file is too large.");
      }
      replaceMap(parseMapFile(await file.text()));
    } catch (error) {
      setFileError(
        error instanceof MapFileError
          ? `Couldn't open ${file.name}. ${error.message}`
          : `Couldn't read ${file.name}.`,
      );
    }
  };

  const runFileAction = (action: string) => {
    if (action === "new") onNewMap();
    else if (action === "projects") onOpenProjects();
    else if (action === "settings") onMapSettings();
    else if (action === "open") fileInput.current?.click();
    else if (action === "save") {
      downloadFile(
        "wadsmith-map.json",
        serializeMap({ ...map, name: mapName }),
        "application/json",
      );
    } else if (action === "wad") {
      setBuilding(true);
    }
  };

  const runAgent = async (action: string, args: unknown[]) => {
    const result = await agent.act({
      steps: [{ ref: "Map", action, args }],
    });
    const failure =
      typeof result.error === "string" ? result.error : result.error?.message;
    setAgentLog(
      result.ok
        ? `${action} ran through the agent bridge.`
        : (failure ?? `${action} was refused.`),
    );
  };

  return (
    <>
      <div className="app" inert={Boolean(game)}>
        <header className="topbar">
          {navigation}
          <MapSwitcher
            episodeName={episode.name}
            maps={episode.maps.map((entry) =>
              entry.id === episode.currentId
                ? { ...entry, slot, name: mapName, health: liveHealth }
                : entry,
            )}
            currentId={episode.currentId}
            canAddMap={episode.canAddMap}
            onOpenMap={episode.onOpenMap}
            onAddMap={onNewMap}
            onEpisodeHome={onOpenProjects}
          />
          <span className="separator" aria-hidden="true" />
          <div className="flex items-center gap-4">
            <Menu onAction={(action) => runFileAction(action as string)}>
              <MenuTrigger className={buttonVariants({ variant: "text" })}>
                File
              </MenuTrigger>
              <MenuContent>
                <MenuItem value="projects">Episode home</MenuItem>
                <MenuItem value="new">New map…</MenuItem>
                <MenuItem value="settings">Map settings…</MenuItem>
                <MenuItem value="open">Replace with map file…</MenuItem>
                <MenuItem value="save">Save map file</MenuItem>
                <MenuSeparator />
                <MenuItem value="wad">Build WAD…</MenuItem>
              </MenuContent>
            </Menu>
            <Menu onAction={(action) => (action === "undo" ? undo() : redo())}>
              <MenuTrigger className={buttonVariants({ variant: "text" })}>
                Edit
              </MenuTrigger>
              <MenuContent>
                <MenuItem
                  value="undo"

                  shortcut={editorShortcuts.undo.keys}
                  disabled={!history.canUndo()}
                >
                  Undo
                </MenuItem>
                <MenuItem
                  value="redo"

                  shortcut={editorShortcuts.redo.keys}
                  disabled={!history.canRedo()}
                >
                  Redo
                </MenuItem>
              </MenuContent>
            </Menu>
            <Menu onAction={(action) => runViewAction(action as string)}>
              <MenuTrigger className={buttonVariants({ variant: "text" })}>
                View
              </MenuTrigger>
              <MenuContent>
                <MenuItem value="map">Map</MenuItem>
                <MenuItem
                  value="split"

                  disabled={narrow}
                >
                  Split
                </MenuItem>
                <MenuItem value="scene">3D</MenuItem>
                <MenuSeparator />
                <MenuItem value="dock">
                  {showDock ? "Hide player view" : "Show player view"}
                </MenuItem>
                <MenuItem value="camera">Find camera on map</MenuItem>
                <MenuSeparator />
                <MenuItem
                  value="shortcuts"

                  shortcut={editorShortcuts.help.keys}
                >
                  Keyboard shortcuts
                </MenuItem>
              </MenuContent>
            </Menu>
            <Menu onAction={(action) => runMapAction(action as string)}>
              <MenuTrigger className={buttonVariants({ variant: "text" })}>
                Map
              </MenuTrigger>
              <MenuContent>
                <MenuItem
                  value="check"

                  disabled={checks.length === 0}
                >
                  Check map
                </MenuItem>
                <MenuItem
                  value="play"

                  disabled={!canPlay}
                >
                  Play
                </MenuItem>
                <MenuItem
                  value="coop"

                  disabled={!canPlayCoop}
                >
                  Play together…
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="Open map file"
            onChange={(event) => {
              void openFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <div className="topbar-end">
            <Button
              variant="ghost"
              size="icon"

              aria-label="Undo"
              title="Undo"
              disabled={!history.canUndo()}
              onClick={undo}
            >
              <Undo2 size={16} aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"

              aria-label="Redo"
              title="Redo"
              disabled={!history.canRedo()}
              onClick={redo}
            >
              <Redo2 size={16} aria-hidden="true" />
            </Button>
            {checks.length === 0 ? (
              <span className={buttonVariants({ variant: "ghost" })}>
                <span className="sr-only">Map check: </span>
                <CircleCheck
                  size={15}
                  className="text-success"
                  aria-hidden="true"
                />
                <span className="max-xl:sr-only">{mapStatus}</span>
              </span>
            ) : (
              <Button
                variant="ghost"

                title="Open map check"
                aria-label={`Map check: ${mapStatus}`}
                onClick={showMapCheck}
              >
                <TriangleAlert
                  size={15}
                  className={canPlay ? "text-warning" : "text-destructive"}
                  aria-hidden="true"
                />
                <span className="max-xl:sr-only">{mapStatus}</span>
              </Button>
            )}
            <Button
              disabled={!canPlayCoop}
              title="Play together"
              onClick={openCoop}
            >
              <Users size={14} aria-hidden="true" />
              <span className="max-xl:sr-only">Play together</span>
            </Button>
            <Button
              variant="primary"
              ref={playButton}

              disabled={!canPlay}
              onClick={play}
            >
              <Play size={14} aria-hidden="true" />
              Play
            </Button>
          </div>
        </header>

        <main className="workspace">
          <SegmentedControl
            aria-label="Mode"
            className="tool-rail"
            value={railMode}
            onValueChange={(next) => chooseMode(next as RailMode)}
          >
            {railModes.map(({ value, label, shortcut: key, icon: Icon }) => (
              <SegmentedControlItem
                key={value}
                value={value}
                aria-keyshortcuts={editorShortcuts[key].keys}
                title={`${modeNames[value]} (${editorShortcuts[key].keys.toUpperCase()})`}
                disabled={visibleLayout === "scene" && value === "draw"}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <div className="views" data-layout={visibleLayout}>
            <SegmentedControl
              aria-label="Main view"
              className="segments view-switch"
              value={visibleLayout}
              onValueChange={(next) => changeLayout(next as ViewLayout)}
            >
              <SegmentedControlIndicator className="segments-indicator" />
              <SegmentedControlItem value="map">Map</SegmentedControlItem>
              <SegmentedControlItem value="split" disabled={narrow}>
                Split
              </SegmentedControlItem>
              <SegmentedControlItem value="scene">3D</SegmentedControlItem>
            </SegmentedControl>
            <Resizable
              className="views-group"
              defaultLayout={initialLayout.sizes}
              onLayoutCommit={(sizes) => {
                splitSizes.current = sizes as number[];
                saveLayout(layout, splitSizes.current, showDock);
              }}
            >
              <ResizablePanel className="view-panel map-panel" minSize="340px">
                <section
                  className="pane map-pane"
                  aria-label="Top-down map"
                  data-pane="map"
                  onPointerEnter={() => {
                    hoveredPane.current = "map";
                  }}
                  onPointerMove={({ clientX, clientY, target }) => {
                    mapPointer.current = (target as Element).closest(
                      ".player-dock, [data-map-control]",
                    )
                      ? null
                      : { clientX, clientY };
                  }}
                  onPointerLeave={() => {
                    hoveredPane.current = null;
                    mapPointer.current = null;
                  }}
                >
                  <MenuContextTrigger
                    controller={menu}
                    className="contents"
                    onContextMenuCapture={normalizeControlClick}
                  >
                    <MapCanvas
                      key={mapVersion}
                      map={map}
                      tool={tool}
                      editMode={editMode}
                      onWallSelect={(wallSector, wall) =>
                        selectSurface(
                          surfaceKey({
                            kind: "wall",
                            sector: wallSector,
                            wall,
                            part: "middle",
                          }),
                        )
                      }
                      onViewChange={updateViewStatus}
                      thingKind={thingKind}
                      activeSector={activeSector}
                      selection={selection}
                      onMapChange={(next, details) =>
                        commit(
                          next,
                          details.reason === "move-key" ? "nudge" : undefined,
                        )
                      }
                      onToolChange={setTool}
                      onActiveSectorChange={setActiveSector}
                      onSelectionChange={setSelection}
                      onMapSelect={() => setSurface(null)}
                      onDraftMapChange={(draft) => drafts.publish(draft)}
                      camera={camera}
                      highlightedWall={
                        parsedSurface?.kind === "wall"
                          ? parsedSurface.wall
                          : null
                      }
                      findCameraRequest={findCameraRequest}
                      fitRequest={fitRequest}
                      focusRequest={focusRequest}
                      callouts={callouts}
                      drawRequest={drawRequest}
                      lookAtRequest={lookAtRequest}
                      onContextTarget={reportMenuTarget}
                      onDrawingChange={setDraftCorners}
                      contextMenuOpen={contextMenuOpen}
                    />
                  </MenuContextTrigger>
                  {welcomed ? null : (
                    <section
                      aria-labelledby="welcome-title"
                      className="absolute bottom-3 left-3 z-4 grid max-w-[min(380px,calc(100%-24px))] gap-3 rounded-[3px] border border-border bg-card p-4 shadow-lg"
                    >
                      <h2
                        id="welcome-title"
                        className="text-base font-semibold text-foreground"
                      >
                        Welcome to Wadsmith
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Build Doom maps in your browser and play them on the
                        spot. This starter map is ready, so play it, then change
                        anything and play again.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="primary"

                          disabled={!canPlay}
                          onClick={play}
                        >
                          <Play size={14} aria-hidden="true" />
                          Play
                        </Button>
                        <Button onClick={dismissWelcome}>Start editing</Button>
                      </div>
                    </section>
                  )}
                  {visibleLayout === "map" && showDock && !narrow ? (
                    <div className="player-dock">
                      <div className="player-dock-bar">Player view</div>
                      <div className="scene-frame">{scene}</div>
                    </div>
                  ) : null}
                </section>
              </ResizablePanel>
              <ResizableHandle
                className="view-handle"
                aria-label="Resize map and 3D view"
              />
              <ResizablePanel
                className="view-panel scene-panel"
                minSize="280px"
              >
                <section
                  className="pane scene-pane"
                  aria-label="3D view"
                  data-pane="scene"
                  onPointerEnter={() => {
                    hoveredPane.current = "scene";
                  }}
                  onPointerLeave={() => {
                    hoveredPane.current = null;
                  }}
                >
                  <div className="scene-frame">
                    {visibleLayout === "map" ? null : scene}
                  </div>
                  <div className="scene-bar">
                    {sceneStatus}
                    {visibleLayout === "scene" ? (
                      <Button onClick={findCameraOnMap}>Find on map</Button>
                    ) : null}
                  </div>
                </section>
              </ResizablePanel>
            </Resizable>
          </div>

          <aside className="side">
            {checks.length === 0 ? null : (
              <section
                ref={mapCheck}
                className="inspector-section map-check"
                aria-label="Map check"
                tabIndex={-1}
              >
                <h2>
                  Map check
                  <span>{checkSummary}</span>
                </h2>
                <ul>
                  {checks.slice(0, 8).map((issue) => {
                    const { title, detail } = issueText(issue);
                    const fixed = fixIssue(map, issue);
                    const target = issue.target
                      ? targetForIssue(map, issue.target)
                      : null;
                    const Icon =
                      issue.severity === "error" ? CircleX : TriangleAlert;
                    return (
                      <li key={issue.id} className="check-issue">
                        <Icon
                          size={14}
                          className={
                            issue.severity === "error"
                              ? "text-destructive"
                              : "text-warning"
                          }
                          aria-hidden="true"
                        />
                        <span className="sr-only">
                          {issue.severity === "error" ? "Error: " : "Warning: "}
                        </span>
                        <div className="min-w-0">
                          <div>{title}</div>
                          {detail ? (
                            <div className="truncate font-mono text-xs text-muted-foreground">
                              {detail}
                            </div>
                          ) : null}
                        </div>
                        {fixed ? (
                          <button
                            type="button"
                            className="border-0 bg-transparent p-0 text-primary"
                            aria-label={`Fix: ${title}`}
                            onClick={() => commit(fixed)}
                          >
                            Fix
                          </button>
                        ) : target ? (
                          <button
                            type="button"
                            className="border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
                            aria-label={`Show: ${title}`}
                            onClick={() => showTarget(target)}
                          >
                            Show
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <header className="selection-header">
              <div className="min-w-0 flex-1">
                {roomSelected && sector ? (
                  <Input
                    aria-label="Room name"
                    variant="ghost"
                    className="-mx-1.5 -mt-0.5 text-[18px] font-semibold"
                    maxLength={80}
                    value={sector.name}
                    onValueChange={(name) =>
                      commit(
                        updateSector(map, sector.id, { name }),
                        `sector:${sector.id}`,
                      )
                    }
                  />
                ) : (
                  <h2>{selectionTitle}</h2>
                )}
                <p>{selectionMeta}</p>
              </div>
              {sector ? (
                <Menu onAction={(action) => runQuickBuild(action as string)}>
                  <MenuTrigger
                    className={buttonVariants({
                      variant: "ghost",
                      size: "icon",
                      className: "shrink-0",
                    })}
                    aria-label={`Quick build around ${sector.name}`}
                    title="Quick build"
                  >
                    <Ellipsis size={16} aria-hidden="true" />
                  </MenuTrigger>
                  <MenuContent align="end">
                    {roomSides.map((side) => (
                      <MenuItem key={side} value={side}>
                        Add a room to the {side}
                      </MenuItem>
                    ))}
                    <MenuSeparator />
                    <MenuItem value="imp">Add an imp</MenuItem>
                    <MenuItem value="door">Make a door</MenuItem>
                  </MenuContent>
                </Menu>
              ) : null}
            </header>
            {agentLog ? (
              <p className="agent-log" role="status">
                {agentLog}
              </p>
            ) : null}
            {fileError ? (
              <section className="inspector-section issues" role="alert">
                <h2>Map problem</h2>
                <p>{fileError}</p>
              </section>
            ) : null}

            {surfaceInfo && !surfaceInfo.thing && !selectedWall ? (
              <section
                className="inspector-section"
                aria-label="Selected surface"
              >
                <h2>Surface</h2>
                <SurfacePanel
                  key={surface}
                  info={surfaceInfo}
                  assets={assets}
                  onPaint={(texture, wholeRoom) =>
                    commit(paintSurface(map, surface!, texture, wholeRoom))
                  }
                />
              </section>
            ) : null}

            {line && selectedWall ? (
              <LineInspector
                key={`${line.wall}:${line.sector.id}`}
                map={map}
                wall={line.wall}
                sector={line.sector.id}
                assets={assets}
                onAddSwitch={
                  freeWallAt(map, line.wall)
                    ? () => {
                        const wall = freeWallAt(map, line.wall)!;
                        const a = map.vertices[wall.from];
                        const b = map.vertices[wall.to];
                        const added = addSwitch(map, wall, {
                          x: (a.x + b.x) / 2,
                          y: (a.y + b.y) / 2,
                        });
                        commit(added.map);
                        setSurface(null);
                        setSelection([`${switchKeyPrefix}${added.id}`]);
                      }
                    : undefined
                }
                onSelectSide={(side) =>
                  selectSurface(surfaceKey({ ...selectedWall, sector: side }))
                }
                onPaint={(part, texture, wholeRoom) =>
                  commit(
                    paintSurface(
                      map,
                      surfaceKey({ ...selectedWall, part }),
                      texture,
                      wholeRoom,
                    ),
                  )
                }
                onLineChange={(patch) =>
                  commit(updateLine(map, line.wall, patch), `line:${line.wall}`)
                }
                onSideChange={(patch) =>
                  commit(
                    updateLineSide(map, line.wall, line.sector.id, patch),
                    `line:${line.wall}:${line.sector.id}`,
                  )
                }
                onTargetChange={(target) =>
                  commit(setLineTarget(map, line.wall, target))
                }
              />
            ) : !selectedSwitch && (thing || placingThings) ? (
              <ThingInspector
                map={map}
                things={selectedThings}
                placing={thingKind}
                onChange={(patch) =>
                  commit(
                    updateThings(
                      map,
                      selectedThings.map((item) => item.id),
                      patch,
                    ),
                    `thing:${selectedThings.map((item) => item.id).join()}`,
                  )
                }
                onPlace={(kind) => {
                  setThingKind(kind);
                  setEditMode("things");
                  setTool("thing");
                }}
              />
            ) : sector && !selectedSwitch && !thing ? (
              <SectorInspector
                key={sector.id}
                map={map}
                sector={sector}
                assets={assets}
                onChange={(patch) =>
                  commit(
                    "door" in patch
                      ? setRoomDoor(map, sector.id, patch.door)
                      : patch.wallTexture
                        ? setRoomWalls(map, sector.id, patch.wallTexture)
                        : updateSector(map, sector.id, patch),
                    `sector:${sector.id}`,
                  )
                }
              />
            ) : (
              <section className="inspector-section">
                <h2>{selectedSwitch ? "Switch" : "Inspector"}</h2>
                {selectedSwitch ? (
                  <SwitchInspector
                    key={selectedSwitch.id}
                    item={selectedSwitch}
                    doors={doors}
                    assets={assets}
                    light={
                      map.sectors.find(
                        (item) => item.id === selectedSwitch.sector,
                      )?.light ?? 255
                    }
                    onChange={(patch) =>
                      commit(updateSwitch(map, selectedSwitch.id, patch))
                    }
                  />
                ) : (
                  <p className="muted">Click a room or thing on the map.</p>
                )}
              </section>
            )}

            <NewMapPanel
              map={map}
              corners={draftCorners}
              drawing={tool === "draw"}
            />

            {map.notes?.length ? (
              <section
                className="inspector-section"
                aria-label="Playtest notes"
              >
                <h2>
                  Playtest notes
                  <span>{map.notes.length}</span>
                </h2>
                <ul className="m-0 grid list-none gap-2 p-0">
                  {map.notes.map((note) => (
                    <li
                      key={note.id}
                      className="grid grid-cols-[14px_minmax(0,1fr)_auto_auto] gap-2"
                    >
                      <StickyNote
                        size={14}
                        className="mt-0.5 text-map-note"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 wrap-break-word">
                        {note.text}
                      </span>
                      <button
                        type="button"
                        className="self-start border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
                        aria-label={`Show note: ${note.text}`}
                        onClick={() =>
                          showTarget({ kind: "empty", point: note })
                        }
                      >
                        Show
                      </button>
                      <button
                        type="button"
                        className="self-start border-0 bg-transparent p-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete note: ${note.text}`}
                        onClick={() => commit(removeNote(map, note.id))}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>
        </main>
        <footer className="status-bar">
          <p className="status-hint">
            <strong>{modeNames[railMode]}</strong>
            {tool === "select"
              ? modeHints[editMode]
              : tool === "thing"
                ? `Placing ${thingCatalog[thingKind].label}. ${toolHints.thing}`
                : toolHints[tool]}
          </p>
          <div>
            <span className="max-2xl:hidden">
              {Object.keys(map.vertices).length} vertices · {lineCount} lines
            </span>
            <span>
              {map.sectors.length} sectors · {map.things.length} things
            </span>
            <span ref={pointerStatus}>X - Y -</span>
            <span>Grid {gridSize}</span>
            <span>Snap on</span>
            <span ref={zoomStatus}>Zoom 100%</span>
            <span role="status">{saveLabels[saveStatus]}</span>
          </div>
        </footer>
      </div>
      <MapContextMenu
        controller={menu}
        map={map}
        target={menuTarget}
        thingKind={thingKind}
        onOpenChange={(open, details) => {
          const target = menuTargetRef.current;
          if (open && !target) {
            details.cancel();
            return;
          }
          menuOpen.current = open;
          setContextMenuOpen(open);
          if (open && target) selectTarget(target);
        }}
        onCommit={(next, selected) => {
          commit(next);
          if (selected) applyMenuSelection(selected);
        }}
        onSelect={applyMenuSelection}
        onMoveCamera={(point) => camera.moveTo(map, point)}
        onShow={showInScene}
        onFindCamera={findCameraOnMap}
        onFitMap={() => setFitRequest((request) => request + 1)}
        onDrawRoom={(point) =>
          setDrawRequest((request) => ({
            id: (request?.id ?? 0) + 1,
            point,
          }))
        }
      />
      {showShortcuts ? (
        <ShortcutSheet onClose={() => setShowShortcuts(false)} />
      ) : null}
      {building ? (
        <BuildDialog
          map={map}
          name={mapName}
          slot={slot}
          onBuild={(fileName) => {
            try {
              downloadWad(map, slot, fileName);
            } catch (error) {
              return `Couldn't build the map. ${(error as Error).message}`;
            }
            setBuilding(false);
            return null;
          }}
          onShow={(issue) => {
            const target = issue.target
              ? targetForIssue(map, issue.target)
              : null;
            setBuilding(false);
            if (target) showTarget(target);
          }}
          onClose={() => setBuilding(false)}
        />
      ) : null}
      {coopLobby ? (
        <PlayTogether
          map={map}
          title={mapName}
          slot={slot}
          par={par}
          onAddStarts={(players) => commit(addPlayerStarts(map, players))}
          onStart={(hosted) => {
            setCoopLobby(false);
            setGame({ map, coop: hosted });
            onPlayingChange(true, true);
          }}
          onClose={() => setCoopLobby(false)}
        />
      ) : null}
      {game ? (
        <GameView
          coop={game.coop?.session ?? null}
          map={game.map}
          title={mapName}
          slot={slot}
          par={par}
          onExit={exitGame}
          onAddNote={(point, text) => commit(addNote(map, point, text))}
          onEditSpot={editPlayedSpot}
        />
      ) : null}
    </>
  );
}

export { App };
