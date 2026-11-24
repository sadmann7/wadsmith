"use client";

import { applyPatch, type MapPatch } from "@rooms/map-patch";
import {
  createLocalStorage,
  formatShortcut,
  matchesShortcut,
} from "@ui-sdk/core";
import * as SegmentedControlPrimitive from "@ui-sdk/react/segmented-control";
import { useShortcut } from "@ui-sdk/react/shortcuts";
import {
  Bot,
  Check,
  CircleCheck,
  CircleDot,
  CircleX,
  Ellipsis,
  PenLine,
  Pentagon,
  Play,
  Redo2,
  Route,
  Slash,
  StickyNote,
  TriangleAlert,
  Undo2,
  Users,
  Waypoints,
} from "lucide-react";
import * as React from "react";

import type { LivePeer } from "@/lib/episodes/live";
import type { FindKind } from "@/lib/map/similar";
import type {
  GameMap,
  Point,
  Sector,
  ThingCategory,
  ThingKind,
} from "@/lib/map/types";

import { GameView, type PlayerSpot } from "@/components/play/play-panel";
import { type HostedGame, PlayTogether } from "@/components/play/play-together";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createMenuController,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuContextTrigger,
  MenuItem,
  MenuItemIndicator,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  Resizable,
  ResizableHandle,
  ResizablePanel,
} from "@/components/ui/resizable";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control";
import { useEditorKeys } from "@/hooks/use-editor-keys";
import { useIwad } from "@/hooks/use-iwad";
import { useVanillaLimits } from "@/hooks/use-vanilla-limits";
import { actForPerson, agentSession } from "@/lib/editor/agent";
import { agentStepSummary } from "@/lib/editor/agent-actions";
import { getHasAgentCard, idleAgentSession } from "@/lib/editor/agent-session";
import {
  dropFragment,
  heldFragment,
  holdFragment,
  originOf,
} from "@/lib/editor/clipboard";
import { createEditHistory } from "@/lib/editor/edit-history";
import {
  type MapTarget,
  normalizeControlClick,
  pointOfTarget,
  targetExists,
  targetForIssue,
  targetForKeys,
  targetForSurface,
  viewOfTarget,
} from "@/lib/editor/map-target";
import {
  clearPlaytest,
  loadPlaytest,
  savePlaytest,
} from "@/lib/editor/playtests";
import { type EditorShortcut, editorShortcuts } from "@/lib/editor/shortcuts";
import { defaultGame, defaultSky, engineSlot } from "@/lib/engine/game";
import { texturesOf } from "@/lib/engine/iwad";
import {
  floorTextures,
  getIsPlayerStart,
  thingCatalog,
  thingKinds,
  wallTextures,
} from "@/lib/map/catalog";
import {
  type CheckedIssue,
  checkMap,
  fixIssue,
  issueText,
} from "@/lib/map/checks";
import {
  addNote,
  addPlayerStarts,
  addSwitch,
  defaultDoor,
  duplicateThings,
  freeWallAt,
  gridSize,
  gridSizes,
  landTeleport,
  removeNote,
  roomKeyPrefix,
  type RoomSide,
  setDoorTexture,
  setLineTarget,
  setRoomDoor,
  setRoomWalls,
  shiftRooms,
  switchKeyPrefix,
  thingKeyPrefix,
  updateLine,
  updateLineSide,
  updateSector,
  updateSwitch,
  updateThings,
  wallKeyPrefix,
  withPlayerStart,
} from "@/lib/map/edit";
import {
  type CopiedPiece,
  copyParts,
  partKeys,
  pasteParts,
  pickedRooms,
  removeParts,
  selectedParts,
  type Transform,
  transformParts,
} from "@/lib/map/fragment";
import {
  loopEdges,
  sectorAt,
  sectorLoops,
  sectorVertices,
  wallKey,
  wallOwners,
} from "@/lib/map/geometry";
import { describeLine, getIsTeleport } from "@/lib/map/lines";
import { lineLinks, type MapLink, sectorLinks } from "@/lib/map/links";
import { gradient, gradientEnds, type SurfaceLook } from "@/lib/map/look";
import {
  paintWalls,
  setWallsAction,
  setWallsTag,
  updateWalls,
  updateWallSides,
} from "@/lib/map/many-lines";
import {
  formatTics,
  keepRun,
  type PlaytestRun,
  type SavedPlaytest,
} from "@/lib/map/playtest";
import { joinRooms } from "@/lib/map/reshape";
import { type DrawShape, polygonSides } from "@/lib/map/shapes";
import { soundReach } from "@/lib/map/sound";
import { standingSpot } from "@/lib/map/standing";
import {
  MapFileError,
  maxFileBytes,
  parseMapFile,
  serializeMap,
} from "@/lib/map/storage";
import {
  describeSurface,
  paintSurface,
  parseSurface,
  surfaceKey,
} from "@/lib/map/surfaces";
import {
  alignWalls,
  countTexture,
  replaceTexture,
  type TextureKind,
} from "@/lib/map/texture-tools";
import { flatUse, wallUse } from "@/lib/map/textures";
import { newProblems } from "@/lib/map/validate";
import {
  curveWalls,
  flipWalls,
  splitIntoSteps,
  stairRooms,
  swapWallSides,
} from "@/lib/map/wall-tools";
import { SceneCamera } from "@/lib/preview/scene-camera";
import { createFlatAssets, readWadAssets } from "@/lib/wad/assets";
import { compileMap } from "@/lib/wad/compile";
import {
  customThingsOf,
  customThingWarnings,
  thingLabel,
} from "@/lib/wad/custom-things";

import type {
  AgentReport,
  EditMode,
  MapTool,
  MapViewStatus,
} from "./map-editor";

import { AgentCard } from "./agent-card";
import { BuildDialog } from "./build-dialog";
import { MapContextMenu, selectionTransforms } from "./context-menu";
import { FindDialog } from "./find-dialog";
import { GradientPanel } from "./gradient-panel";
import {
  LineInspector,
  LinesInspector,
  RoomsInspector,
  SectorInspector,
  SwitchInspector,
  ThingInspector,
} from "./inspector";
import { MapCanvas } from "./map-canvas";
import { type EpisodeEntry, type MapHealth, MapSwitcher } from "./map-switcher";
import { NewMapPanel } from "./new-map-panel";
import { PlaytestPanel } from "./playtest-panel";
import { PrefabsDialog } from "./prefabs-dialog";
import {
  type DraftSource,
  SceneCanvas,
  type SceneView,
  startView,
} from "./scene-editor";
import { CurveDialog, StairsDialog } from "./shape-dialogs";
import { ShortcutSheet } from "./shortcut-sheet";
import { SoundPanel } from "./sound-panel";
import { SurfacePanel } from "./surface-panel";
import { TexturePicker } from "./texture-picker";
import { TransformDialog } from "./transform-dialog";

const modeHints: Record<EditMode, string> = {
  vertices:
    "Drag corners to reshape rooms, or nudge them with the arrow keys. Shift-click adds to the selection.",
  lines: "Click a wall to change its textures or what it does.",
  sectors:
    "Click a room to select it, and drag it to move it. Shift-click adds a room, and Shift-drag selects a box.",
  things:
    "Click a thing to select it, or pick one in the inspector to place it.",
};

const toolHints: Record<Exclude<MapTool, "select">, string> = {
  draw: "Click corners, then click the first one or press Enter. A room drawn against a wall shares corners with it.",
  line: "Click points inside a room, then click the last one again or press Enter. A line can hold a middle texture or a walk-over action.",
  thing:
    "Click a floor to place it, or press Enter in 3D to place it ahead. Esc, or picking the thing again, stops placing.",
  switch:
    "Click a solid wall to add a switch, then drag from it to a door. Esc cancels.",
};

const shapeHints: Record<Exclude<DrawShape, "outline">, string> = {
  rectangle:
    "Click one corner, then the opposite one. Choose another shape in the status bar.",
  polygon:
    "Click the middle, then where one corner goes. Choose another shape in the status bar.",
  ellipse:
    "Click one corner of the box round it, then the opposite one. Choose another shape in the status bar.",
  grid: "Click one corner, then the opposite one, for rooms about 128 across. Choose another shape in the status bar.",
};

const noLinks: MapLink[] = [];

// The same ranges the inspector's fields keep a single room within.
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
// How long after the 3D view copies a look the page's copy event still
// belongs to it.
const lookCopyMs = 250;
const savedWelcome = createLocalStorage("wadsmith:welcomed");
// Below this width, two panes can't hold the map controls and a usable 3D view.
const narrowQuery = "(max-width: 1100px)";

type RailMode = EditMode | "draw" | "line";

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
  { value: "line", label: "Draw line", shortcut: "drawLine", icon: Route },
];

const modeNames: Record<RailMode, string> = {
  vertices: "Vertices",
  lines: "Lines",
  sectors: "Sectors",
  things: "Things",
  draw: "Draw",
  line: "Draw line",
};

interface GridSetting {
  size: number;
  snap: boolean;
  merge: boolean;
}

const savedGrid = createLocalStorage("wadsmith:grid");

interface AppProps {
  initialMap: GameMap;
  mapName: string;
  slot: string;
  par: number | null;
  music?: string;
  sky?: string;
  intertext?: string;
  saveStatus: "saving" | "saved" | "failed" | "session";
  onSave: (map: GameMap) => void;
  watchExternal: (listener: (map: GameMap) => void) => () => void;
  // Edits other people make to the map at the same time, as patches.
  watchRemote?: (listener: (patch: MapPatch) => void) => () => void;
  // Everyone else editing the map, with where their pointers are.
  peers?: LivePeer[];
  onPointer?: (at: Point | null) => void;
  onOpenEpisodes: () => void;
  navigation: React.ReactNode;
  onNewMap: () => void;
  onMapSettings: () => void;
  onShare?: () => void;
  onPublish?: () => void;
  onParChange: (par: number) => void;
  playing: boolean;
  onPlayingChange: (playing: boolean, coop: boolean) => void;
  episode: {
    name: string;
    maps: EpisodeEntry[];
    currentId: string;
    canAddMap: boolean;
    onOpenMap: (id: string) => void;
  };
}

interface PlayedGame {
  map: GameMap;
  coop: HostedGame | null;
  // Started where the 3D camera stood and not at the player start.
  fromCamera?: boolean;
}

const saveLabels: Record<AppProps["saveStatus"], string> = {
  saving: "Saving…",
  saved: "Saved in this browser",
  failed: "Not saved: storage is unavailable",
  session: "Browser storage is off: saved for this session only",
};

interface SelectionGroup {
  mode: EditMode;
  keys: string[];
  sector: string | null;
}

export function EditorScreen({
  initialMap,
  mapName,
  slot,
  par,
  music,
  sky,
  intertext,
  saveStatus,
  onSave,
  watchExternal,
  watchRemote,
  peers,
  onPointer,
  onOpenEpisodes,
  navigation,
  onNewMap,
  onMapSettings,
  onShare,
  onPublish,
  onParChange,
  playing,
  onPlayingChange,
  episode,
}: AppProps) {
  const [map, setMap] = React.useState(initialMap);
  // The map as last shown, which a remote edit lands on before the next
  // render.
  const mapRef = React.useRef(initialMap);
  const agentEdit = React.useRef<number | undefined>(undefined);
  const [tool, setTool] = React.useState<MapTool>("select");
  const [gridSetting, setGridSetting] = React.useState(loadGrid);
  // Snapping off still lands on whole units, which is all the engine stores.
  const grid = gridSetting.snap ? gridSetting.size : 1;
  const changeGrid = (next: GridSetting) => {
    setGridSetting(next);
    savedGrid.set(JSON.stringify(next));
  };
  const stepGrid = (direction: 1 | -1) => {
    const at = gridSizes.indexOf(
      gridSetting.size as (typeof gridSizes)[number],
    );
    const next = gridSizes[at + direction];
    if (next !== undefined)
      changeGrid({ ...gridSetting, size: next, snap: true });
  };
  const [thingKind, setThingKind] = React.useState<ThingKind>("imp");
  const [thingType, setThingType] = React.useState<number | undefined>();
  const [activeSector, setActiveSector] = React.useState<string | null>(
    "sector-3",
  );
  const [selection, setSelection] = React.useState<string[]>([]);
  const [game, setGame] = React.useState<PlayedGame | null>(() =>
    playing ? { map: initialMap, coop: null } : null,
  );
  const [followed, setFollowed] = React.useState(playing);
  const [coopLobby, setCoopLobby] = React.useState(false);
  if (followed !== playing) {
    setFollowed(playing);
    setGame(playing ? (game ?? { map, coop: null }) : null);
  }
  // The last playtest of this map, and whether the map shows it.
  const [playtest, setPlaytest] = React.useState<SavedPlaytest | null>(null);
  const [showTrail, setShowTrail] = React.useState(true);
  const mapId = episode.currentId;
  React.useEffect(() => {
    let stale = false;
    void loadPlaytest(mapId).then((saved) => {
      if (!stale && saved) setPlaytest((current) => current ?? saved);
    });
    return () => {
      stale = true;
    };
  }, [mapId]);
  const hosted = game?.coop ?? null;
  React.useEffect(() => () => hosted?.close(), [hosted]);
  const [mapVersion, setMapVersion] = React.useState(0);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [welcomed, setWelcomed] = React.useState(loadWelcomed);
  const [sound, setSound] = React.useState<{ doorsOpen: boolean } | null>(null);
  const playButton = React.useRef<HTMLButtonElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [notice, setNotice] = React.useState("");
  // A dialog opened from a room's menu keeps what the menu worked on, which
  // the selection alone may not say once the menu has closed.
  const [transforming, setTransforming] = React.useState<string[] | null>(null);
  const [finding, setFinding] = React.useState(false);
  const [curving, setCurving] = React.useState<string[] | null>(null);
  const [stairs, setStairs] = React.useState<string[] | null>(null);
  const [replacing, setReplacing] = React.useState<{
    kind: TextureKind;
    from: string;
  } | null>(null);
  // The look last picked up, from a wall's menu on the map or by copying a
  // surface in the 3D view.
  const [look, setLook] = React.useState<SurfaceLook | null>(null);
  const lookCopy = React.useRef({ texture: "", at: -Infinity });
  // Whether a piece was copied after the look, so the 3D view's paste key
  // pastes the piece and not the look.
  const [pieceNewer, setPieceNewer] = React.useState(false);
  const [scenePicked, setScenePicked] = React.useState<string[]>([]);
  const [sceneView, setSceneView] = React.useState<SceneView>(startView);
  const [drawShape, setDrawShape] = React.useState<DrawShape>("outline");
  const [drawSides, setDrawSides] = React.useState(8);
  const [prefabsAt, setPrefabsAt] = React.useState<{
    point: Point | null;
    selected: GameMap | null;
  } | null>(null);
  const viewStatus = React.useRef<MapViewStatus | null>(null);
  const [initialLayout] = React.useState(loadLayout);
  const [layout, setLayout] = React.useState(initialLayout.view);
  const [findCameraRequest, setFindCameraRequest] = React.useState(0);
  const [fitRequest, setFitRequest] = React.useState(0);
  const [fitSelectionRequest, setFitSelectionRequest] = React.useState(0);
  const [selectAllRequest, setSelectAllRequest] = React.useState(0);
  const [groups, setGroups] = React.useState<Record<string, SelectionGroup>>(
    {},
  );
  const [lastPrefab, setLastPrefab] = React.useState<GameMap | null>(null);
  const [focusRequest, setFocusRequest] = React.useState<{
    id: number;
    point: Point;
  } | null>(null);
  const [drawRequest, setDrawRequest] = React.useState<{
    id: number;
    point: Point;
  } | null>(null);
  const [menu] = React.useState(() => createMenuController());
  const [menuTarget, setMenuTarget] = React.useState<MapTarget | null>(null);
  const menuTargetRef = React.useRef<MapTarget | null>(null);
  const menuOpen = React.useRef(false);
  const [contextMenuOpen, setContextMenuOpen] = React.useState(false);
  const [building, setBuilding] = React.useState(false);
  const [showShortcuts, setShowShortcuts] = React.useState(false);
  const [draftCorners, setDraftCorners] = React.useState(0);
  const [showDock, setShowDock] = React.useState(initialLayout.dock);
  const [editMode, setEditMode] = React.useState<EditMode>("vertices");
  const pointerStatus = React.useRef<HTMLSpanElement>(null);
  const zoomStatus = React.useRef<HTMLSpanElement>(null);
  const mapCheck = React.useRef<HTMLElement>(null);
  const splitSizes = React.useRef(initialLayout.sizes);
  const hoveredPane = React.useRef<SinglePane | null>(null);
  const mapPointer = React.useRef<{ clientX: number; clientY: number } | null>(
    null,
  );
  const [lookAtRequest, setLookAtRequest] = React.useState<{
    id: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const narrow = React.useSyncExternalStore(subscribeNarrow, getIsNarrow);
  const visibleLayout = narrow && layout === "split" ? "map" : layout;
  const [surface, setSurface] = React.useState<string | null>(null);
  const [drafts] = React.useState(createDraftChannel);
  const [camera] = React.useState(() => new SceneCamera(initialMap));
  const [history] = React.useState(() =>
    createEditHistory({ limit: 200, groupDelay: 500 }),
  );
  const [undoable, setUndoable] = React.useState(() => ({
    undo: false,
    redo: false,
    done: history.getDoneIds(),
  }));
  const syncUndoable = React.useCallback(
    () =>
      setUndoable({
        undo: history.canUndo(),
        redo: history.canRedo(),
        done: history.getDoneIds(),
      }),
    [history],
  );

  const iwad = useIwad();
  const shortcutKeys = useEditorKeys();
  const assets = React.useMemo(() => {
    if (!iwad) return createFlatAssets();
    try {
      return readWadAssets(iwad.data, texturesOf(iwad).resources);
    } catch {
      return createFlatAssets();
    }
  }, [iwad]);
  const iwadGame = iwad?.game ?? defaultGame;
  const customThings = React.useMemo(
    () => customThingsOf(iwad ? texturesOf(iwad).resources : []),
    [iwad],
  );
  const customList = React.useMemo(
    () => [...customThings.values()].toSorted((a, b) => a.type - b.type),
    [customThings],
  );
  const customSprites = React.useMemo(
    () =>
      new Map([...customThings].map(([type, thing]) => [type, thing.sprite])),
    [customThings],
  );
  const placingType = thingKind === "custom" ? thingType : undefined;
  const placingLabel = thingLabel(
    { kind: thingKind, type: placingType },
    customThings,
  );
  const context = React.useMemo(
    () => ({ game: iwad?.game, names: iwad ? assets.names : undefined }),
    [assets, iwad],
  );
  // Doom II's things don't exist in a Doom 1 game.
  const placeable = iwadGame.doom2
    ? thingKinds
    : thingKinds.filter((kind) => !thingCatalog[kind].doom2);
  const limits = useVanillaLimits(map);
  const limitIssues = limits.issues;
  const checks = React.useMemo(
    () => [
      ...checkMap(map, context),
      ...customThingWarnings(map, customThings),
      ...limitIssues,
    ],
    [context, customThings, limitIssues, map],
  );
  const issues = checks.filter((issue) => issue.severity === "error");
  const canPlay = issues.length === 0;
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
  const callouts = issues.slice(0, 5).flatMap((issue) => {
    const target = issue.target ? targetForIssue(map, issue.target) : null;
    const point = target ? pointOfTarget(map, target) : null;
    return point
      ? [{ id: issue.id, ...point, text: issueText(issue).title }]
      : [];
  });
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

  const showMap = (next: GameMap) => {
    mapRef.current = next;
    setMap(next);
    onSave(next);
    syncUndoable();
  };

  const commit = (next: GameMap, group?: string) => {
    // The person's own edit ends what a browser agent was doing.
    agentSession.endRequest();
    history.record(mapRef.current, next, { group });
    showMap(next);
  };

  const restore = (next: GameMap | undefined) => {
    syncUndoable();
    if (!next) return;
    showMap(next);
    setSelection([]);
  };
  const undo = () => restore(history.undo(mapRef.current));
  const redo = () => restore(history.redo(mapRef.current));

  const selectedThingIds = selection
    .filter((key) => key.startsWith(thingKeyPrefix))
    .map((key) => key.slice(thingKeyPrefix.length));
  const selectedWalls = selection
    .filter((key) => key.startsWith(wallKeyPrefix))
    .map((key) => key.slice(wallKeyPrefix.length))
    .filter((wall) => wall.split("|").every((id) => map.vertices[id]));

  // The rooms and things the selection stands for, which copy, cut, paste
  // and the transforms work on.
  // A selected wall isn't its room, and a room left active in another mode
  // isn't what that mode works on. A room's own menu works on that room.
  const pickedRoom =
    contextMenuOpen && menuTarget?.kind === "room"
      ? menuTarget.sector
      : (editMode === "vertices" || editMode === "sectors") &&
          (surface ? parseSurface(surface)?.kind !== "wall" : true)
        ? activeSector
        : null;
  const { parts, canCopy, transformKeys } = React.useMemo(() => {
    const parts = selectedParts(map, selection, pickedRoom);
    const picked = new Set(parts.things);
    return {
      parts,
      canCopy:
        parts.sectors.length > 0 ||
        map.things.some(
          (item) => picked.has(item.id) && !getIsPlayerStart(item.kind),
        ),
      transformKeys: [
        ...new Set([
          ...selection.flatMap((key) =>
            key.startsWith(wallKeyPrefix)
              ? key.slice(wallKeyPrefix.length).split("|")
              : map.vertices[key] || key.startsWith(thingKeyPrefix)
                ? [key]
                : [],
          ),
          ...partKeys(map, parts),
        ]),
      ],
    };
  }, [map, pickedRoom, selection]);

  // The rooms picked themselves, without the rooms drawn inside them, which
  // the inspector edits together.
  const selectedRooms = React.useMemo(() => {
    const picked = pickedRooms(map, selection, pickedRoom);
    return map.sectors.filter((item) => picked.includes(item.id));
  }, [map, pickedRoom, selection]);

  const selectPasted = (keys: string[]) => {
    setSurface(null);
    setActiveSector(null);
    setSelection(keys);
  };

  const pasteFragment = (piece: CopiedPiece | null, at: Point | null) => {
    const pasted =
      piece &&
      pasteParts(
        map,
        piece.fragment,
        at,
        grid,
        piece.origin === originOf(episode.currentId),
      );
    if (!pasted) {
      setNotice("There is nothing to paste. Copy a room or a thing first.");
      return;
    }
    setNotice("");
    commit(pasted.map);
    selectPasted(pasted.keys);
  };

  // Under the pointer when it is over the map, and in the middle of the view
  // otherwise.
  const pastePoint = () => {
    const status = viewStatus.current;
    if (!status) return null;
    return (
      status.pointer ?? {
        x: (status.view.left + status.view.right) / 2,
        y: (status.view.top + status.view.bottom) / 2,
      }
    );
  };

  const cutFragment = (fragment: GameMap) => {
    commit(
      removeParts(map, {
        sectors: parts.sectors,
        things: fragment.things.map((item) => item.id),
      }),
    );
    selectPasted([]);
  };

  const copySelection = (cut: boolean) => {
    const fragment = copyParts(map, parts);
    if (!fragment) return;
    const text = holdFragment(fragment, episode.currentId);
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setPieceNewer(true);
    if (cut) cutFragment(fragment);
  };

  const duplicateSelection = () => {
    const fragment = parts.sectors.length > 0 ? copyParts(map, parts) : null;
    if (fragment) {
      pasteFragment({ fragment, origin: originOf(episode.currentId) }, null);
      return;
    }
    const copies = duplicateThings(map, selectedThingIds);
    if (copies.ids.length === 0) return;
    agentSession.endRequest();
    history.record(map, copies.map);
    showMap(copies.map);
    selectPasted(copies.ids.map((id) => `${thingKeyPrefix}${id}`));
  };

  const transformSelection = (steps: Transform[], keys = transformKeys) => {
    if (keys.length === 0 || steps.length === 0) return;
    let next = map;
    for (const step of steps) {
      const turned = transformParts(next, keys, step, grid);
      if (!turned) {
        setNotice(
          "That would press two corners of a room together, or change nothing.",
        );
        return;
      }
      next = turned;
    }
    const [problem] = newProblems(map, next);
    if (problem) {
      setNotice(`That would give the map a new problem. ${problem.message}`);
      return;
    }
    setNotice("");
    commit(next);
    // Corners that met others on the way are gone, and so are the walls and
    // rooms they ended.
    setSelection(
      selection.filter(
        (key) =>
          next.vertices[key] ||
          key.startsWith(thingKeyPrefix) ||
          key.startsWith(switchKeyPrefix) ||
          (key.startsWith(wallKeyPrefix) &&
            key
              .slice(wallKeyPrefix.length)
              .split("|")
              .every((id) => next.vertices[id])) ||
          (key.startsWith(roomKeyPrefix) &&
            next.sectors.some(
              (sector) => `${roomKeyPrefix}${sector.id}` === key,
            )),
      ),
    );
  };

  // Copy and cut go through the browser's own events, so the piece lands on
  // the system clipboard without asking, and text selected on the page still
  // copies as text.
  const onClipboard = React.useEffectEvent((event: ClipboardEvent) => {
    if (
      !notTyping() ||
      document.activeElement?.closest('[role="dialog"]') ||
      document.querySelector(".game-stage")
    ) {
      return;
    }
    // A look copied in the 3D view a moment ago takes the clipboard, so a
    // piece copied before it can no longer be pasted over it.
    if (
      event.type === "copy" &&
      performance.now() - lookCopy.current.at < lookCopyMs &&
      document.activeElement?.closest(".scene")
    ) {
      event.preventDefault();
      event.clipboardData?.setData("text/plain", lookCopy.current.texture);
      dropFragment();
      return;
    }
    if (event.type === "paste") {
      const fragment = heldFragment(event.clipboardData?.getData("text/plain"));
      if (!fragment) return;
      event.preventDefault();
      pasteFragment(fragment, pastePoint());
      return;
    }
    // Text selected elsewhere on the page copies as text, unless the map is
    // what has the focus.
    if (
      window.getSelection()?.toString() &&
      !document.activeElement?.closest('[aria-roledescription="map editor"]')
    ) {
      return;
    }
    const fragment = copyParts(map, parts);
    if (!fragment) return;
    event.preventDefault();
    event.clipboardData?.setData(
      "text/plain",
      holdFragment(fragment, episode.currentId),
    );
    setPieceNewer(true);
    if (event.type === "cut") cutFragment(fragment);
  });

  React.useEffect(() => {
    const kinds = ["copy", "cut", "paste"] as const;
    for (const kind of kinds) window.addEventListener(kind, onClipboard);
    return () => {
      for (const kind of kinds) window.removeEventListener(kind, onClipboard);
    };
  }, []);

  useShortcut(shortcutKeys.undo, undo, shortcut("undo", notTyping));
  useShortcut(shortcutKeys.redo, redo, shortcut("redo", notTyping));
  useShortcut(
    shortcutKeys.duplicate,
    duplicateSelection,
    shortcut(
      "duplicate",
      () =>
        notTyping() &&
        (selectedThingIds.length > 0 || parts.sectors.length > 0),
    ),
  );
  const canTransform = () => modeKeys() && transformKeys.length > 0;
  useShortcut(
    shortcutKeys.rotateRight,
    () => transformSelection([{ kind: "rotate", degrees: 90 }]),
    shortcut("rotateRight", canTransform),
  );
  useShortcut(
    shortcutKeys.rotateLeft,
    () => transformSelection([{ kind: "rotate", degrees: -90 }]),
    shortcut("rotateLeft", canTransform),
  );
  useShortcut(
    shortcutKeys.flipAcross,
    () => transformSelection([{ kind: "mirror", axis: "horizontal" }]),
    shortcut("flipAcross", canTransform),
  );
  useShortcut(
    shortcutKeys.flipOver,
    () => transformSelection([{ kind: "mirror", axis: "vertical" }]),
    shortcut("flipOver", canTransform),
  );

  // What a search found, selected in the mode that works on it.
  const selectFound = (kind: FindKind, keys: string[]) => {
    setNotice(
      `Selected ${keys.length} ${keys.length === 1 ? "match" : "matches"}.`,
    );
    if (kind === "wall" || kind === "action") {
      setEditMode("lines");
      const [first] = keys;
      const wall = first?.slice(wallKeyPrefix.length);
      const owner = wall ? wallOwners(map).get(wall)?.[0] : undefined;
      setSurface(
        wall && owner
          ? surfaceKey({ kind: "wall", sector: owner.id, wall, part: "middle" })
          : null,
      );
      setActiveSector(owner?.id ?? null);
      setSelection(keys);
      return;
    }
    setSurface(null);
    if (kind === "thing") {
      setEditMode("things");
      setActiveSector(null);
      setSelection(keys);
      return;
    }
    setEditMode("sectors");
    // One room on its own is the active room, which the inspector edits.
    if (keys.length === 1) {
      setSelection([]);
      setActiveSector(keys[0].slice(roomKeyPrefix.length));
      return;
    }
    setActiveSector(null);
    setSelection(keys);
  };
  useShortcut(
    shortcutKeys.clearSelection,
    () => {
      setSurface(null);
      setActiveSector(null);
      setSelection([]);
      setScenePicked([]);
    },
    shortcut("clearSelection", modeKeys),
  );
  useShortcut(
    shortcutKeys.find,
    () => setFinding(true),
    shortcut("find", notTyping),
  );

  // The walls a wall's own tool works on: every selected wall when it is
  // one of them, or else just that one.
  const wallsWith = (wall: string) =>
    selectedWalls.includes(wall) ? selectedWalls : [wall];
  const selectedOrShown = () => {
    if (selectedWalls.length > 0) return selectedWalls;
    const shown = surface ? parseSurface(surface) : null;
    return shown?.kind === "wall" ? [shown.wall] : [];
  };

  // An edit from a tool lands unless it would give the map a problem it
  // didn't have, which the notice names instead.
  const commitTool = (next: GameMap, refusal: string) => {
    if (next === map) return false;
    if (newProblems(map, next).length > 0) {
      setNotice(refusal);
      return false;
    }
    setNotice("");
    commit(next);
    return true;
  };

  const flipSelection = (walls: string[], sides: boolean) => {
    const next = sides ? swapWallSides(map, walls) : flipWalls(map, walls);
    if (next === map) {
      setNotice(
        sides
          ? "Only a wall between two rooms, neither a door, swaps sides, and these already look the same."
          : "Only a wall between two rooms, neither a door, turns round.",
      );
      return;
    }
    commit(next);
  };
  useShortcut(
    shortcutKeys.flipWalls,
    () => flipSelection(selectedOrShown(), false),
    shortcut("flipWalls", () => modeKeys() && selectedOrShown().length > 0),
  );
  useShortcut(
    shortcutKeys.swapSides,
    () => flipSelection(selectedOrShown(), true),
    shortcut("swapSides", () => modeKeys() && selectedOrShown().length > 0),
  );

  const joinSelection = () => {
    const joined = joinRooms(
      map,
      selectedRooms.map((room) => room.id),
    );
    if (!joined) {
      setNotice(
        "Only rooms side by side with the same tag can join, and no doors.",
      );
      return;
    }
    setNotice("");
    commit(joined.map);
    setSurface(null);
    setSelection([]);
    setActiveSector(joined.id);
  };
  useShortcut(
    shortcutKeys.joinRooms,
    joinSelection,
    shortcut("joinRooms", () => modeKeys() && selectedRooms.length > 1),
  );

  // The registry skips key repeats, and holding mod+Z should keep stepping back.
  const onHeldKey = React.useEffectEvent((event: KeyboardEvent) => {
    if (
      !event.repeat ||
      !notTyping() ||
      document.activeElement?.closest('[role="dialog"]') ||
      document.querySelector(".game-stage")
    ) {
      return;
    }
    if (matchesShortcut(event, shortcutKeys.redo)) {
      event.preventDefault();
      redo();
    } else if (matchesShortcut(event, shortcutKeys.undo)) {
      event.preventDefault();
      undo();
    } else if (matchesShortcut(event, shortcutKeys.duplicate)) {
      event.preventDefault();
    }
  });

  // Esc stops placing things from wherever the focus is, such as the
  // button that picked the thing.
  const onPlacingEscape = React.useEffectEvent((event: KeyboardEvent) => {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      tool !== "thing" ||
      !notTyping() ||
      document.activeElement?.closest('[role="dialog"]') ||
      !mapKeys()
    ) {
      return;
    }
    event.preventDefault();
    setTool("select");
  });
  React.useEffect(() => {
    window.addEventListener("keydown", onPlacingEscape);
    return () => window.removeEventListener("keydown", onPlacingEscape);
  }, []);

  React.useEffect(() => {
    window.addEventListener("keydown", onHeldKey);
    return () => window.removeEventListener("keydown", onHeldKey);
  }, []);
  useShortcut(
    shortcutKeys.help,
    () => setShowShortcuts(true),
    shortcut("help"),
  );

  const surfaceInfo = describeSurface(map, surface);

  React.useEffect(() => {
    camera.sync(map);
  }, [camera, map]);

  const changeLayout = (next: ViewLayout) => {
    setLayout(next);
    saveLayout(next, splitSizes.current, showDock);
    if (next === "scene") {
      setTool((current) =>
        current === "draw" || current === "line" || current === "switch"
          ? "select"
          : current,
      );
    }
  };

  const chooseMode = (mode: RailMode) => {
    if (mode === "draw" || mode === "line") {
      if (visibleLayout !== "scene") setTool(mode);
      return;
    }
    setEditMode(mode);
    setTool("select");
  };

  const togglePane = (pane: SinglePane) => {
    if (narrow) return;
    changeLayout(visibleLayout === "split" ? pane : "split");
  };

  useShortcut(
    shortcutKeys.vertices,
    () => chooseMode("vertices"),
    shortcut("vertices", modeKeys),
  );
  useShortcut(
    shortcutKeys.lines,
    () => chooseMode("lines"),
    shortcut("lines", modeKeys),
  );
  useShortcut(
    shortcutKeys.sectors,
    () => chooseMode("sectors"),
    shortcut("sectors", modeKeys),
  );
  useShortcut(
    shortcutKeys.things,
    () => chooseMode("things"),
    shortcut("things", modeKeys),
  );
  useShortcut(
    shortcutKeys.draw,
    () => chooseMode("draw"),
    shortcut("draw", modeKeys),
  );
  useShortcut(
    shortcutKeys.drawLine,
    () => chooseMode("line"),
    shortcut("drawLine", modeKeys),
  );
  useShortcut(
    shortcutKeys.gridSmaller,
    () => stepGrid(-1),
    shortcut("gridSmaller", modeKeys),
  );
  useShortcut(
    shortcutKeys.gridLarger,
    () => stepGrid(1),
    shortcut("gridLarger", modeKeys),
  );
  useShortcut(
    shortcutKeys.snap,
    () => changeGrid({ ...gridSetting, snap: !gridSetting.snap }),
    shortcut("snap", modeKeys),
  );
  useShortcut(
    shortcutKeys.look,
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
    shortcutKeys.pane,
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

  useShortcut(
    shortcutKeys.fitSelection,
    () => setFitSelectionRequest((request) => request + 1),
    shortcut("fitSelection", () => modeKeys() && visibleLayout !== "scene"),
  );

  const toggleDoors = () => {
    const making = selectedRooms.some((room) => !room.door);
    commitTool(
      selectedRooms.reduce(
        (next, room) =>
          making
            ? room.door
              ? next
              : setRoomDoor(next, room.id, defaultDoor)
            : setRoomDoor(next, room.id, undefined),
        map,
      ),
      making
        ? "A door can't hold a player start, or be too big to open."
        : "These doors can't turn back into rooms here.",
    );
  };
  useShortcut(
    shortcutKeys.makeDoor,
    toggleDoors,
    shortcut("makeDoor", () => modeKeys() && selectedRooms.length > 0),
  );

  // Rooms in the order they were picked, which a gradient runs along.
  const pickOrder = (room: Sector) =>
    selection.findIndex(
      (key) =>
        key === `${roomKeyPrefix}${room.id}` || room.vertices.includes(key),
    );
  const roomsInPickOrder = () =>
    selectedRooms.toSorted((a, b) => pickOrder(a) - pickOrder(b));
  const slopeRooms = (kind: "floor" | "ceiling" | "light") => {
    const keys = roomsInPickOrder().map((room) =>
      surfaceKey({ kind: kind === "light" ? "floor" : kind, sector: room.id }),
    );
    const what = kind === "light" ? "light" : "height";
    const ends = gradientEnds(map, keys, what);
    if (!ends) return;
    const next = gradient(map, keys, what, ends[0], ends[1]);
    if (next === map) {
      setNotice("These rooms already make an even slope.");
      return;
    }
    setNotice("");
    commit(next);
  };
  const canSlope = () => notTyping() && modeKeys() && selectedRooms.length > 2;
  useShortcut(
    shortcutKeys.floorGradient,
    () => slopeRooms("floor"),
    shortcut("floorGradient", canSlope),
  );
  useShortcut(
    shortcutKeys.ceilingGradient,
    () => slopeRooms("ceiling"),
    shortcut("ceilingGradient", canSlope),
  );
  useShortcut(
    shortcutKeys.lightGradient,
    () => slopeRooms("light"),
    shortcut("lightGradient", canSlope),
  );

  useShortcut(
    shortcutKeys.placePrefab,
    () => {
      if (!lastPrefab) {
        setNotice("Place a prefab from the map's menu first.");
        return;
      }
      pasteFragment({ fragment: lastPrefab, origin: null }, pastePoint());
    },
    shortcut("placePrefab", () => modeKeys() && visibleLayout !== "scene"),
  );

  // An editor that opens on the 3D view takes the keys at once, so WASD walks
  // without a click first.
  const focusOpeningScene = React.useEffectEvent(() => {
    if (visibleLayout === "scene" && document.activeElement === document.body) {
      focusPane("scene");
    }
  });
  React.useEffect(() => focusOpeningScene(), []);

  // The 3D view goes back to the map layout it came from, and from the map
  // it starts where the pointer is, as switching to visual mode does in UDB.
  const leftLayout = React.useRef<ViewLayout>("map");
  React.useEffect(() => {
    if (visibleLayout !== "scene") leftLayout.current = visibleLayout;
  }, [visibleLayout]);
  useShortcut(
    shortcutKeys.switchView,
    () => {
      if (visibleLayout === "scene") {
        changeLayout(narrow ? "map" : leftLayout.current);
        focusPane("map");
        return;
      }
      const pointer = mapPointer.current;
      if (hoveredPane.current === "map" && pointer) {
        setLookAtRequest((request) => ({
          ...pointer,
          id: (request?.id ?? 0) + 1,
        }));
      }
      // The map reads the pointer against its own box, which it loses once
      // hidden, so the layout changes a frame later.
      requestAnimationFrame(() => {
        changeLayout("scene");
        focusPane("scene");
      });
    },
    shortcut("switchView", mapKeys),
  );

  const findCameraOnMap = () => {
    if (visibleLayout === "scene") changeLayout(narrow ? "map" : "split");
    setFindCameraRequest((request) => request + 1);
  };

  const selectedKey = selection[0];
  const selectedSceneSwitch = selectedKey?.startsWith(switchKeyPrefix)
    ? map.switches.find(
        (entry) => `${switchKeyPrefix}${entry.id}` === selectedKey,
      )
    : undefined;
  const sceneSelection = surfaceInfo
    ? surface
    : selectedKey?.startsWith(thingKeyPrefix)
      ? selectedKey
      : selectedKey?.startsWith(switchKeyPrefix)
        ? selectedSceneSwitch
          ? surfaceKey({
              kind: "wall",
              sector: selectedSceneSwitch.sector,
              wall: wallKey(selectedSceneSwitch.from, selectedSceneSwitch.to),
              part: "middle",
            })
          : null
        : activeSector
          ? surfaceKey({ kind: "floor", sector: activeSector })
          : null;
  const sceneInfo = describeSurface(map, sceneSelection);
  const parsedSurface = surface ? parseSurface(surface) : null;
  const selectedWall =
    surfaceInfo && parsedSurface?.kind === "wall" ? parsedSurface : null;
  const line =
    selectedWall && !selectedSwitch && !thing
      ? describeLine(map, selectedWall.wall, selectedWall.sector)
      : null;
  const freeWall = line ? freeWallAt(map, line.wall) : null;
  const alignedMap = line
    ? alignWalls(
        map,
        line.sector.id,
        line.wall,
        (name) => assets.texture(name).width,
      )
    : map;
  const linkedWall = line?.wall;
  const links = React.useMemo(
    () =>
      linkedWall
        ? lineLinks(map, linkedWall)
        : pickedRoom
          ? sectorLinks(map, pickedRoom)
          : noLinks,
    [linkedWall, map, pickedRoom],
  );

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

  // Digits recall a saved selection, Shift adds it to the current one and
  // Alt saves the current one. Ctrl and ⌘ with a digit switch browser tabs.
  const onGroupKey = React.useEffectEvent((event: KeyboardEvent) => {
    const slot = /^Digit([1-9])$/.exec(event.code)?.[1];
    if (
      !slot ||
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      (event.altKey && event.shiftKey) ||
      event.defaultPrevented ||
      !notTyping() ||
      !modeKeys() ||
      document.activeElement?.closest('[role="dialog"]') ||
      document.querySelector(".game-stage")
    ) {
      return;
    }
    event.preventDefault();
    if (event.altKey) {
      const saved = { mode: editMode, keys: selection, sector: activeSector };
      setGroups((current) => ({ ...current, [slot]: saved }));
      setNotice(
        selection.length > 0 || activeSector
          ? `Saved the selection as group ${slot}.`
          : `Cleared group ${slot}.`,
      );
      return;
    }
    const group = groups[slot];
    const keys = group?.keys.filter((key) => getIsLiveKey(map, key)) ?? [];
    const sector =
      group?.sector && map.sectors.some((room) => room.id === group.sector)
        ? group.sector
        : null;
    if (!group || (keys.length === 0 && !sector)) {
      setNotice(`Group ${slot} is empty. Press Alt+${slot} to save one.`);
      return;
    }
    setNotice("");
    setScenePicked([]);
    chooseMode(group.mode);
    if (event.shiftKey && group.mode === editMode) {
      // A room picked on its own is held as the active room, so both rooms
      // join the selection as keys.
      const rooms = [pickedRoom, sector].flatMap((id) =>
        roomKeys(map, group.mode, id),
      );
      const merged = [...new Set([...selection, ...rooms, ...keys])];
      const [only] = merged;
      const single = merged.length === 1 && only.startsWith(roomKeyPrefix);
      setSurface(null);
      setActiveSector(single ? only.slice(roomKeyPrefix.length) : null);
      setSelection(single ? [] : merged);
      return;
    }
    const wall = keys
      .findLast((key) => key.startsWith(wallKeyPrefix))
      ?.slice(wallKeyPrefix.length);
    const owner = wall ? wallOwners(map).get(wall)?.[0] : undefined;
    if (group.mode === "lines" && wall && owner) {
      selectSurface(
        surfaceKey({ kind: "wall", sector: owner.id, wall, part: "middle" }),
      );
      setSelection(keys);
      return;
    }
    setSurface(null);
    setActiveSector(sector);
    setSelection(keys);
  });

  React.useEffect(() => {
    window.addEventListener("keydown", onGroupKey);
    return () => window.removeEventListener("keydown", onGroupKey);
  }, []);

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
    wall,
  }: {
    keys?: string[];
    sector?: string | null;
    wall?: { sector: string; wall: string };
  }) => {
    setSurface(
      wall ? surfaceKey({ kind: "wall", ...wall, part: "middle" }) : null,
    );
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

  // A view a check found goes to the 3D view too, standing where it was seen.
  const showIssue = (issue: CheckedIssue) => {
    const target = issue.target ? targetForIssue(map, issue.target) : null;
    if (target) showTarget(target);
    const { view } = issue;
    if (!view || !camera.placeAt(map, view, view.angle)) return;
    if (narrow) changeLayout("scene");
    else if (
      visibleLayout !== "split" &&
      !(visibleLayout === "map" && showDock)
    ) {
      changeLayout("split");
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
        aria-label={sceneLabel(shortcutKeys)}
        className="screen scene"
        map={map}
        assets={assets}
        camera={camera}
        draftSource={drafts.subscribe}
        selected={surfaceInfo ? surface : null}
        linked={sceneInfo ? sceneSelection : null}
        placing={tool === "thing" ? thingKind : null}
        placingType={placingType}
        customSprites={customSprites}
        sky={sky ?? defaultSky(slot, iwadGame)}
        grid={grid}
        renderWidth={640}
        renderHeight={400}
        look={look}
        pasteLook={!pieceNewer}
        onLookChange={(next) => {
          setLook(next);
          setPieceNewer(false);
          lookCopy.current = { texture: next.texture, at: performance.now() };
          setNotice(
            `Copied ${next.texture}. Paste it with the paste key, paint it with Alt and a click${next.kind === "wall" ? ", or flood it along joined walls with F" : ""}.`,
          );
        }}
        picked={scenePicked}
        onPickedChange={setScenePicked}
        onMapChange={(next, details) =>
          commit(next, sceneGroups[details.reason])
        }
        onSelectedChange={selectSurface}
        view={sceneView}
        onViewChange={setSceneView}
        onContextSurface={reportSceneTarget}
        contextMenuOpen={contextMenuOpen}
      />
    </MenuContextTrigger>
  );

  // The surfaces picked together that are still on the map, with what each
  // one is.
  const pickedSurfaces = scenePicked.flatMap((key) => {
    const info = describeSurface(map, key);
    return info?.sector ? [{ key, info }] : [];
  });
  const pickedKeys = pickedSurfaces.map((item) => item.key);

  const sceneKeys = (
    <p className="scene-keys m-0" aria-hidden="true">
      {sceneView.flying ? "Flying" : "Walking"}
      {shortcutKeys.sceneFly
        ? ` · ${keyText(shortcutKeys.sceneFly)} ${sceneView.flying ? "walk" : "fly"}`
        : ""}{" "}
      · WASD move · Right-drag look · Wheel height · Arrows texture · Shift or
      Alt+A align
    </p>
  );

  const sceneStatus = (
    <p className="scene-status" role="status">
      {pickedSurfaces.length > 1
        ? `${pickedSurfaces.length} surfaces picked. Shift-click adds or removes one.`
        : sceneInfo
          ? `Selected: ${sceneInfo.thing ? thingLabel(sceneInfo.thing, customThings) : sceneInfo.label}${sceneInfo.texture ? ` · ${sceneInfo.texture}` : ""}${sceneInfo.height !== null ? ` · height ${sceneInfo.height}` : ""}`
          : "Click a floor, ceiling, wall or thing. Drag a wall to move its texture."}
    </p>
  );

  React.useEffect(
    () =>
      watchExternal((next) => {
        // The steps were taken on a map that is gone now.
        history.clear();
        mapRef.current = next;
        setMap(next);
        setSelection([]);
        setSurface(null);
        syncUndoable();
      }),
    [history, syncUndoable, watchExternal],
  );

  // Someone else's edit lands on the map as it stands, without an undo step,
  // and is saved like any edit, which sends nothing back.
  const takeRemote = React.useEffectEvent((patch: MapPatch) => {
    const next = applyPatch(mapRef.current, patch);
    mapRef.current = next;
    setMap(next);
    onSave(next);
  });
  React.useEffect(
    () => watchRemote?.((patch) => takeRemote(patch)),
    [watchRemote],
  );

  React.useEffect(() => {
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

  const lineCount = wallOwners(map).size;

  const showMapCheck = () => {
    mapCheck.current?.scrollIntoView({ block: "nearest" });
    mapCheck.current?.focus();
  };

  const updateViewStatus = (status: MapViewStatus) => {
    const { pointer, zoom } = status;
    viewStatus.current = status;
    onPointer?.(pointer);
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
    else if (action === "sound") {
      setSound((current) => (current ? null : { doorsOpen: false }));
    } else changeLayout(action as ViewLayout);
  };

  const runEditAction = (action: string) => {
    const step = selectionTransforms.find((item) => item.value === action);
    if (step) transformSelection([step.transform]);
    else if (action === "undo") undo();
    else if (action === "redo") redo();
    else if (action === "cut") copySelection(true);
    else if (action === "copy") copySelection(false);
    else if (action === "paste") pasteFragment(heldFragment(), pastePoint());
    else if (action === "duplicate") duplicateSelection();
    else if (action === "transform") setTransforming(transformKeys);
    else if (action === "selectAll")
      setSelectAllRequest((request) => request + 1);
    else if (action === "find") setFinding(true);
  };

  const runMapAction = (action: string) => {
    if (action === "check") showMapCheck();
    else if (action === "play") play();
    else if (action === "coop") openCoop();
  };

  // A shot is heard from the selected room, or else from the player start.
  const playerStart = map.things.find((item) => item.kind === "player");
  const soundRoom =
    map.sectors.find((room) => room.id === activeSector) ??
    (playerStart ? sectorAt(map, playerStart) : undefined);
  const soundReached =
    sound && soundRoom ? soundReach(map, soundRoom.id, sound) : null;

  const thingRoom = thing ? sectorAt(map, thing) : null;
  const thingMeta = thing
    ? [
        `Thing ${String(map.things.indexOf(thing) + 1).padStart(2, "0")}`,
        thingCategoryLabels[
          thing.kind === "custom"
            ? (customThings.get(thing.type ?? 0)?.category ?? "decor")
            : thingCatalog[thing.kind].category
        ],
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
    // Two rooms can share a name, so the room goes by its id.
    if (action === "imp") void runAgent("placeThing", ["imp", sector.id]);
    else if (action === "door") void runAgent("makeDoor", [sector.id, "use"]);
    else void runAgent("addConnectedRoom", [sector.id, action, 192]);
  };
  const railMode: RailMode =
    tool === "draw" || tool === "line"
      ? tool
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
        ? thingLabel(thing, customThings)
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
            ? `Placing ${placingLabel}`
            : "Pick a thing to place"
          : line
            ? `${
                line.back === line.front
                  ? "Inside a room"
                  : line.back
                    ? "Two-sided"
                    : "One-sided"
              } · ${line.length} long · ${
                line.back && line.back !== line.front
                  ? `${line.front.name} to ${line.back.name}`
                  : line.front.name
              }`
            : sector
              ? `${sector.door ? "Door" : "Sector"} · ${sectorLoops(sector).flatMap(loopEdges).length} walls`
              : "Click a room, line or thing on the map";

  const play = () => {
    if (canPlay && !buildProblem()) {
      setGame({ map, coop: null });
      onPlayingChange(true, false);
    }
    dismissWelcome();
  };

  const playFromCamera = () => {
    const { x, y, angle } = camera.position;
    // The camera can stand against a wall, where a player would be stuck.
    const spot = standingSpot(map, { x, y });
    if (!spot) {
      setNotice(
        "A player has no room to stand there. Walk the 3D view into a room to play from it.",
      );
      return;
    }
    if (!canPlay || buildProblem()) return;
    setGame({
      map: withPlayerStart(map, spot, angle),
      coop: null,
      fromCamera: true,
    });
    onPlayingChange(true, false);
  };

  useShortcut(shortcutKeys.play, play, shortcut("play"));
  useShortcut(shortcutKeys.playHere, playFromCamera, shortcut("playHere"));

  const keepPlaytest = (run: PlaytestRun) => {
    const saved = keepRun(playtest, run, !game?.fromCamera);
    setPlaytest(saved);
    setShowTrail(true);
    void savePlaytest(mapId, saved).catch(() => undefined);
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
    setScenePicked([]);
    // The last playtest was of the map this one takes the place of.
    setPlaytest(null);
    void clearPlaytest(mapId).catch(() => undefined);
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
    else if (action === "episodes") onOpenEpisodes();
    else if (action === "settings") onMapSettings();
    else if (action === "share") onShare?.();
    else if (action === "publish") onPublish?.();
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
    const result = await actForPerson(action, args);
    const failure =
      typeof result.error === "string" ? result.error : result.error?.message;
    // An edit that landed has logged itself already.
    if (!result.ok) setNotice(failure ?? `${action} was refused.`);
  };

  const agentState = React.useSyncExternalStore(
    agentSession.subscribe,
    agentSession.getSnapshot,
    () => idleAgentSession,
  );
  const hasAgentCard = getHasAgentCard(agentState, undoable.done);
  const showWelcome = !welcomed && !hasAgentCard;
  const showMapDock = visibleLayout === "map" && showDock && !narrow;
  const agentAsk = agentState.question
    ? agentStepSummary(
        map,
        agentState.question.action,
        agentState.question.args,
        null,
      )
    : null;
  // Each of a browser agent's edits is its own undo step, and Undo all takes
  // back its whole request.
  const commitAgentEdit = (next: GameMap) => {
    const request = agentSession.currentRequest();
    if (request === null) return commit(next);
    agentEdit.current = history.record(mapRef.current, next, {
      batch: `agent-${request}`,
    });
    showMap(next);
  };
  const undoAgentRequest = () => {
    const request = agentState.request;
    if (!request) return;
    const working = agentSession.getIsCalling();
    agentSession.stop();
    const batch = `agent-${request.id}`;
    if (!history.hasBatch(batch)) {
      if (working) agentSession.clearTrail();
      else agentSession.dismiss();
      setNotice("The agent's changes are too far back to undo any more.");
      return;
    }
    const next = history.undoBatch(batch, mapRef.current);
    restore(next);
    // A request stopped mid-way stays, so the rest of its calls are refused.
    if (next && working) agentSession.clearTrail();
    else if (next) agentSession.dismiss();
    else {
      setNotice(
        "The agent's changes can't be undone together any more. Undo them one at a time.",
      );
    }
  };
  React.useEffect(() => () => agentSession.reset(), []);

  // The visible trail of what an agent did, whoever the agent is. A browser
  // agent's edits go to its card instead.
  const logAgentAction = (action: string, report: AgentReport) => {
    const edit = agentEdit.current;
    agentEdit.current = undefined;
    const traced = agentSession.record(
      action,
      report.todo,
      (args) => agentStepSummary(mapRef.current, action, args, report.result),
      edit,
    );
    if (!traced) logBridgeAction(action, report);
  };
  const logBridgeAction = (action: string, { fixed, todo }: AgentReport) =>
    setNotice(
      [
        `${action} ran through the agent bridge.`,
        fixed.length > 0 ? `Fixed on the way: ${fixed.join(" ")}` : "",
        todo.length > 0 ? `Still to do: ${todo.join(" ")}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );

  return (
    <>
      <div className="app" inert={Boolean(game)}>
        {/* Only the map takes an agent's steps, so the controls around it stay
            out of what a browser agent sees. */}
        <header className="topbar" data-agent-hidden>
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
            onEpisodeHome={onOpenEpisodes}
          />
          <span className="separator" aria-hidden="true" />
          <div className="flex items-center gap-4">
            <Menu onAction={(action) => runFileAction(action)}>
              <MenuTrigger
                className={buttonVariants({
                  variant: "text",
                  className: "min-h-6",
                })}
              >
                File
              </MenuTrigger>
              <MenuContent>
                <MenuItem value="episodes">Episode home</MenuItem>
                <MenuItem value="new">New map…</MenuItem>
                <MenuItem value="settings">Map settings…</MenuItem>
                {onShare ? (
                  <MenuItem value="share">Keep online…</MenuItem>
                ) : null}
                <MenuItem value="open">Replace with map file…</MenuItem>
                <MenuItem value="save">Save map file</MenuItem>
                <MenuSeparator />
                <MenuItem value="wad">Build WAD…</MenuItem>
                {onPublish ? (
                  <MenuItem value="publish">Publish…</MenuItem>
                ) : null}
              </MenuContent>
            </Menu>
            <Menu onAction={(action) => runEditAction(action)}>
              <MenuTrigger
                className={buttonVariants({
                  variant: "text",
                  className: "min-h-6",
                })}
              >
                Edit
              </MenuTrigger>
              <MenuContent>
                <MenuItem
                  value="undo"
                  shortcut={shortcutKeys.undo}
                  disabled={!undoable.undo}
                >
                  Undo
                </MenuItem>
                <MenuItem
                  value="redo"
                  shortcut={shortcutKeys.redo}
                  disabled={!undoable.redo}
                >
                  Redo
                </MenuItem>
                <MenuSeparator />
                <MenuItem value="cut" shortcut="mod+x" disabled={!canCopy}>
                  Cut
                </MenuItem>
                <MenuItem value="copy" shortcut="mod+c" disabled={!canCopy}>
                  Copy
                </MenuItem>
                <MenuItem value="paste" shortcut="mod+v">
                  Paste
                </MenuItem>
                <MenuItem
                  value="duplicate"
                  shortcut={shortcutKeys.duplicate}
                  disabled={!canCopy}
                >
                  Duplicate
                </MenuItem>
                <MenuSeparator />
                {selectionTransforms.map(({ value, label, shortcut }) => (
                  <MenuItem
                    key={value}
                    value={value}
                    shortcut={shortcut ? shortcutKeys[shortcut] : undefined}
                    disabled={transformKeys.length === 0}
                  >
                    {label}
                  </MenuItem>
                ))}
                <MenuItem
                  value="transform"
                  disabled={transformKeys.length === 0}
                >
                  Turn or resize by…
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  value="selectAll"
                  shortcut={shortcutKeys.selectAll}
                  disabled={layout === "scene" || tool !== "select"}
                >
                  Select all
                </MenuItem>
                <MenuItem value="find" shortcut={shortcutKeys.find}>
                  Find and select…
                </MenuItem>
              </MenuContent>
            </Menu>
            <Menu onAction={(action) => runViewAction(action)}>
              <MenuTrigger
                className={buttonVariants({
                  variant: "text",
                  className: "min-h-6",
                })}
              >
                View
              </MenuTrigger>
              <MenuContent>
                <MenuItem value="map">Map</MenuItem>
                <MenuItem value="split" disabled={narrow}>
                  Split
                </MenuItem>
                <MenuItem value="scene">3D</MenuItem>
                <MenuSeparator />
                <MenuItem value="dock">
                  {showDock ? "Hide player view" : "Show player view"}
                </MenuItem>
                <MenuItem value="camera">Find camera on map</MenuItem>
                <MenuItem value="sound">
                  {sound ? "Hide sound" : "Show sound"}
                </MenuItem>
                <MenuSeparator />
                <MenuItem value="shortcuts" shortcut={shortcutKeys.help}>
                  Keyboard shortcuts
                </MenuItem>
              </MenuContent>
            </Menu>
            <Menu onAction={(action) => runMapAction(action)}>
              <MenuTrigger
                className={buttonVariants({
                  variant: "text",
                  className: "min-h-6",
                })}
              >
                Map
              </MenuTrigger>
              <MenuContent>
                <MenuItem value="check" disabled={checks.length === 0}>
                  Check map
                </MenuItem>
                <MenuItem value="play" disabled={!canPlay}>
                  Play
                </MenuItem>
                <MenuItem value="coop" disabled={!canPlayCoop}>
                  Play together…
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
          <span data-agent-hidden role="status">
            {agentState.status === "idle" ? null : (
              <span className="flex h-7 items-center gap-2 rounded-[3px] border border-input bg-card pr-2.5 pl-2 text-sm">
                <Bot size={14} aria-hidden="true" />
                <span className="font-medium">Agent</span>
                <span className="text-muted-foreground">
                  {agentState.status === "asking"
                    ? "waiting for you"
                    : "working…"}
                </span>
                {agentState.status === "working" ? (
                  <Button
                    variant="text"
                    className="ml-1 text-foreground"
                    onClick={() => agentSession.stop()}
                  >
                    Stop
                  </Button>
                ) : null}
              </span>
            )}
          </span>
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
              disabled={!undoable.undo}
              onClick={undo}
            >
              <Undo2 size={16} aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Redo"
              title="Redo"
              disabled={!undoable.redo}
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
          <SegmentedControlPrimitive.SegmentedControl
            aria-label="Mode"
            data-agent-hidden
            className="tool-rail"
            value={railMode}
            onValueChange={(next) => chooseMode(next as RailMode)}
          >
            {railModes.map(({ value, label, shortcut: key, icon: Icon }) => (
              <SegmentedControlPrimitive.SegmentedControlItem
                key={value}
                value={value}
                aria-keyshortcuts={shortcutKeys[key] || undefined}
                title={`${modeNames[value]}${keyHint(shortcutKeys[key])}`}
                disabled={
                  visibleLayout === "scene" &&
                  (value === "draw" || value === "line")
                }
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </SegmentedControlPrimitive.SegmentedControlItem>
            ))}
          </SegmentedControlPrimitive.SegmentedControl>
          <div className="views" data-layout={visibleLayout}>
            <SegmentedControl
              aria-label="Main view"
              data-agent-hidden
              className="absolute top-3 right-3 z-5"
              value={visibleLayout}
              onValueChange={(next, details) => {
                changeLayout(next as ViewLayout);
                if (next === "scene" && details.source !== "keyboard") {
                  focusPane("scene");
                }
              }}
            >
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
                splitSizes.current = sizes;
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
                      grid={grid}
                      gridSize={gridSetting.size}
                      autoMerge={gridSetting.merge}
                      onWallSelect={(wallSector, wall, walls) => {
                        selectSurface(
                          surfaceKey({
                            kind: "wall",
                            sector: wallSector,
                            wall,
                            part: "middle",
                          }),
                        );
                        setSelection(walls);
                      }}
                      onViewChange={updateViewStatus}
                      thingKind={thingKind}
                      thingType={placingType}
                      customThings={customThings}
                      activeSector={activeSector}
                      selection={selection}
                      onMapChange={(next, details) => {
                        if (details.reason === "agent") {
                          commitAgentEdit(next);
                          return;
                        }
                        commit(
                          next,
                          details.reason === "move-key"
                            ? "nudge"
                            : details.reason === "height-key"
                              ? "heights"
                              : undefined,
                        );
                      }}
                      onAgentAction={logAgentAction}
                      checkContext={context}
                      onToolChange={setTool}
                      onActiveSectorChange={setActiveSector}
                      onSelectionChange={(next) => {
                        setSelection(next);
                        setScenePicked([]);
                      }}
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
                      fitSelectionRequest={fitSelectionRequest}
                      fitAround={[
                        showWelcome && "#welcome-card",
                        hasAgentCard && "[data-agent-card]",
                        showMapDock && ".player-dock",
                      ]
                        .filter(Boolean)
                        .join(", ")}
                      selectAllRequest={selectAllRequest}
                      focusRequest={focusRequest}
                      callouts={callouts}
                      links={links}
                      trail={showTrail ? (playtest?.run ?? null) : null}
                      peers={peers}
                      agentAt={
                        agentState.status === "idle"
                          ? null
                          : (agentAsk?.at ?? agentState.request?.at ?? null)
                      }
                      drawShape={drawShape}
                      drawSides={drawSides}
                      drawRequest={drawRequest}
                      lookAtRequest={lookAtRequest}
                      onContextTarget={reportMenuTarget}
                      onDrawingChange={setDraftCorners}
                      contextMenuOpen={contextMenuOpen}
                      sound={soundReached}
                    />
                  </MenuContextTrigger>
                  {sound && soundRoom && soundReached ? (
                    <SoundPanel
                      reach={soundReached}
                      source={soundRoom.name}
                      doorsOpen={sound.doorsOpen}
                      onDoorsOpenChange={(doorsOpen) => setSound({ doorsOpen })}
                      onClose={() => setSound(null)}
                    />
                  ) : null}
                  <AgentCard
                    session={agentState}
                    map={map}
                    doneEdits={undoable.done}
                    onAnswer={(yes, always) =>
                      agentSession.answer(yes, { always })
                    }
                    onStop={() => agentSession.stop()}
                    onUndoAll={undoAgentRequest}
                    onDismiss={() => agentSession.dismiss()}
                  />
                  {showWelcome ? (
                    <section
                      id="welcome-card"
                      aria-labelledby="welcome-title"
                      data-agent-hidden
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
                        spot.{" "}
                        {map.sectors.length === 0
                          ? "Draw a room to start, place a player start in it, then play it."
                          : canPlay
                            ? "This map is ready, so play it, then change anything and play again."
                            : "Fix what the map check lists, then play it."}
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
                  ) : null}
                  {showMapDock ? (
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
                data-agent-hidden
              />
              <ResizablePanel
                className="view-panel scene-panel"
                minSize="280px"
              >
                <section
                  className="pane scene-pane"
                  data-agent-hidden
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
                    {sceneKeys}
                    {visibleLayout === "scene" ? (
                      <Button onClick={findCameraOnMap}>Find on map</Button>
                    ) : null}
                    <Button
                      disabled={!canPlay}
                      title="Play the map from where the 3D view stands"
                      onClick={playFromCamera}
                    >
                      <Play size={14} aria-hidden="true" />
                      Play from here
                    </Button>
                  </div>
                </section>
              </ResizablePanel>
            </Resizable>
          </div>

          <aside className="side" data-agent-hidden>
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
                        ) : target || issue.view ? (
                          <button
                            type="button"
                            className="border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
                            aria-label={`Show: ${title}`}
                            onClick={() => showIssue(issue)}
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
                <Menu onAction={(action) => runQuickBuild(action)}>
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
            {notice ? (
              <p className="agent-log" role="status">
                {notice}
              </p>
            ) : null}
            {fileError ? (
              <section className="inspector-section issues" role="alert">
                <h2>Map problem</h2>
                <p>{fileError}</p>
              </section>
            ) : null}

            {pickedSurfaces.length > 1 ? (
              <GradientPanel
                key={pickedKeys.join()}
                count={pickedSurfaces.length}
                heights={gradientEnds(map, pickedKeys, "height")}
                lights={gradientEnds(map, pickedKeys, "light")}
                onApply={(what, from, to) => {
                  const next = gradient(map, pickedKeys, what, from, to);
                  if (next !== map) commit(next);
                }}
              />
            ) : null}

            {surface && surfaceInfo && !surfaceInfo.thing && !selectedWall ? (
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
                    commit(paintSurface(map, surface, texture, wholeRoom))
                  }
                />
              </section>
            ) : null}

            {selectedWalls.length > 1 ? (
              <LinesInspector
                map={map}
                walls={selectedWalls}
                assets={assets}
                onPaint={(texture) =>
                  commit(paintWalls(map, selectedWalls, texture))
                }
                onOffset={(key, value, shift) =>
                  commit(
                    updateWallSides(map, selectedWalls, (side) => ({
                      [key]:
                        (shift ? (side[key] ?? 0) + value : value) || undefined,
                    })),
                    `lines:${selectedWalls.join()}`,
                  )
                }
                onFlag={(flag, on) =>
                  commit(
                    updateWalls(map, selectedWalls, {
                      [flag]: on || undefined,
                    }),
                  )
                }
                onAction={(kind) =>
                  commit(setWallsAction(map, selectedWalls, kind))
                }
                onTag={(tag) =>
                  commit(
                    setWallsTag(map, selectedWalls, tag),
                    `lines:${selectedWalls.join()}`,
                  )
                }
              />
            ) : line && selectedWall ? (
              <LineInspector
                key={`${line.wall}:${line.sector.id}`}
                map={map}
                wall={line.wall}
                sector={line.sector.id}
                assets={assets}
                onAddSwitch={
                  freeWall
                    ? () => {
                        const a = map.vertices[freeWall.from];
                        const b = map.vertices[freeWall.to];
                        const added = addSwitch(
                          map,
                          freeWall,
                          { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                          null,
                          grid,
                        );
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
                onLineChange={(patch) => {
                  const next = updateLine(map, line.wall, patch);
                  commit(
                    getIsTeleport(line.settings.action?.kind)
                      ? next
                      : landTeleport(next, line.wall),
                    `line:${line.wall}`,
                  );
                }}
                onSideChange={(patch) =>
                  commit(
                    updateLineSide(map, line.wall, line.sector.id, patch),
                    `line:${line.wall}:${line.sector.id}`,
                  )
                }
                onTargetChange={(target) =>
                  commit(setLineTarget(map, line.wall, target))
                }
                onAlign={
                  alignedMap === map ? undefined : () => commit(alignedMap)
                }
              />
            ) : !selectedSwitch && (thing || placingThings) ? (
              <ThingInspector
                map={map}
                things={selectedThings}
                placing={
                  tool === "thing"
                    ? { kind: thingKind, type: placingType }
                    : null
                }
                kinds={placeable}
                custom={customList}
                grid={grid}
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
                onPlace={(pick) => {
                  if (!pick) {
                    setTool("select");
                    return;
                  }
                  setThingKind(pick.kind);
                  setThingType(pick.type);
                  setEditMode("things");
                  setTool("thing");
                }}
              />
            ) : selectedRooms.length > 1 && !selectedSwitch && !thing ? (
              <RoomsInspector
                map={map}
                rooms={selectedRooms}
                assets={assets}
                onChange={(patch) =>
                  commit(
                    selectedRooms.reduce((next, room) => {
                      if (patch.wallTexture) {
                        return setRoomWalls(next, room.id, patch.wallTexture);
                      }
                      // A door has no ceiling height of its own.
                      return updateSector(
                        next,
                        room.id,
                        room.door && "ceiling" in patch ? {} : patch,
                      );
                    }, map),
                    `rooms:${selectedRooms.map((room) => room.id).join()}`,
                  )
                }
                onDoor={(change) =>
                  commit(
                    selectedRooms.reduce((next, room) => {
                      if (change === true) {
                        return room.door
                          ? next
                          : setRoomDoor(next, room.id, defaultDoor);
                      }
                      if (change === false) {
                        return setRoomDoor(next, room.id, undefined);
                      }
                      if (!room.door) return next;
                      const opened = setRoomDoor(next, room.id, {
                        ...room.door,
                        ...change,
                      });
                      return change.texture
                        ? setDoorTexture(opened, room.id, change.texture)
                        : opened;
                    }, map),
                    `rooms:${selectedRooms.map((room) => room.id).join()}`,
                  )
                }
                onShift={(key, delta) => {
                  const next = shiftRooms(
                    map,
                    selectedRooms.map((room) => room.id),
                    key,
                    delta,
                  );
                  if (next !== map) {
                    commit(
                      next,
                      `rooms:${selectedRooms.map((room) => room.id).join()}`,
                    );
                  }
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
                      ? patch.door &&
                        patch.door.texture !== sector.door?.texture
                        ? setDoorTexture(
                            setRoomDoor(map, sector.id, patch.door),
                            sector.id,
                            patch.door.texture,
                          )
                        : setRoomDoor(map, sector.id, patch.door)
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
                  <p className="text-muted-foreground">
                    Click a room or thing on the map.
                  </p>
                )}
              </section>
            )}

            <NewMapPanel
              map={map}
              corners={draftCorners}
              drawing={tool === "draw"}
            />

            {playtest ? (
              <PlaytestPanel
                saved={playtest}
                shown={showTrail}
                par={par}
                onShownChange={setShowTrail}
                onParChange={onParChange}
                onClear={() => {
                  setPlaytest(null);
                  void clearPlaytest(mapId).catch(() => undefined);
                }}
              />
            ) : null}

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
                        {note.tic === undefined ? null : (
                          <span
                            className="ml-1.5 font-mono text-xs text-muted-foreground"
                            title="How far into the playtest it was left"
                          >
                            {formatTics(note.tic)}
                          </span>
                        )}
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
        <footer className="status-bar" data-agent-hidden>
          <p className="status-hint">
            <strong>{modeNames[railMode]}</strong>
            {tool === "select"
              ? modeHints[editMode]
              : tool === "thing"
                ? `Placing ${placingLabel}. ${toolHints.thing}`
                : tool === "draw" && drawShape !== "outline"
                  ? shapeHints[drawShape]
                  : toolHints[tool]}
          </p>
          <div>
            {tool === "draw" ? (
              <Menu>
                <MenuTrigger
                  className={buttonVariants({
                    variant: "text",
                    className: "min-h-5 px-1 font-mono text-[11px]",
                  })}
                  title="The shape a new room is drawn as"
                >
                  Shape {shapeLabel(drawShape, drawSides)}
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuRadioGroup
                    value={
                      drawShape === "polygon" ? String(drawSides) : drawShape
                    }
                    onValueChange={(value) => {
                      const sides = Number(value);
                      if (Number.isFinite(sides)) {
                        setDrawShape("polygon");
                        setDrawSides(sides);
                      } else {
                        setDrawShape(value as DrawShape);
                      }
                    }}
                  >
                    {[
                      "outline",
                      "rectangle",
                      "ellipse",
                      "grid",
                      ...polygonSides.map(String),
                    ].map((value) => (
                      <MenuRadioItem key={value} value={value} closeOnSelect>
                        {Number.isFinite(Number(value))
                          ? shapeLabel("polygon", Number(value))
                          : shapeLabel(value as DrawShape, 0)}
                        <MenuItemIndicator className="ml-auto text-primary">
                          <Check size={14} />
                        </MenuItemIndicator>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuContent>
              </Menu>
            ) : null}
            <span className="max-2xl:hidden">
              {countOf(Object.keys(map.vertices).length, "vertex", "vertices")}{" "}
              · {countOf(lineCount, "line", "lines")}
            </span>
            <span>
              {countOf(map.sectors.length, "sector", "sectors")} ·{" "}
              {countOf(map.things.length, "thing", "things")}
            </span>
            <span ref={pointerStatus} title="Doom coordinates, Y grows north">
              X - Y -
            </span>
            <Menu>
              <MenuTrigger
                className={buttonVariants({
                  variant: "text",
                  className: "min-h-5 px-1 font-mono text-[11px]",
                })}
                title={`Grid size and snapping${keyHint(
                  [
                    shortcutKeys.gridSmaller,
                    shortcutKeys.gridLarger,
                    shortcutKeys.snap,
                  ]
                    .filter(Boolean)
                    .map((keys) => formatShortcut(keys))
                    .join(" "),
                  false,
                )}`}
              >
                Grid {gridSetting.size} · Snap {gridSetting.snap ? "on" : "off"}
              </MenuTrigger>
              <MenuContent align="end">
                <MenuRadioGroup
                  value={String(gridSetting.size)}
                  onValueChange={(value) =>
                    changeGrid({
                      ...gridSetting,
                      size: Number(value),
                      snap: true,
                    })
                  }
                >
                  {gridSizes.map((size) => (
                    <MenuRadioItem
                      key={size}
                      value={String(size)}
                      closeOnSelect
                    >
                      Grid {size}
                      <MenuItemIndicator className="ml-auto text-primary">
                        <Check size={14} />
                      </MenuItemIndicator>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
                <MenuSeparator />
                <MenuCheckboxItem
                  value="snap"
                  checked={gridSetting.snap}
                  onCheckedChange={(snap) =>
                    changeGrid({ ...gridSetting, snap })
                  }
                  closeOnSelect
                >
                  Snap to grid
                  <MenuItemIndicator className="ml-auto text-primary">
                    <Check size={14} />
                  </MenuItemIndicator>
                </MenuCheckboxItem>
                <MenuCheckboxItem
                  value="merge"
                  checked={gridSetting.merge}
                  onCheckedChange={(merge) =>
                    changeGrid({ ...gridSetting, merge })
                  }
                  closeOnSelect
                >
                  Join what's dropped on a wall
                  <MenuItemIndicator className="ml-auto text-primary">
                    <Check size={14} />
                  </MenuItemIndicator>
                </MenuCheckboxItem>
              </MenuContent>
            </Menu>
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
        thingType={placingType}
        thingLabel={placingLabel}
        grid={grid}
        editMode={editMode}
        edit={{
          canCopy,
          canTransform: transformKeys.length > 0,
          onCopy: () => copySelection(false),
          onCut: () => copySelection(true),
          onPaste: (point) => pasteFragment(heldFragment(), point),
          onDuplicate: duplicateSelection,
          onTransform: (transform) => transformSelection([transform]),
          onTransformBy: () => setTransforming(transformKeys),
          onPrefabs: (point) =>
            setPrefabsAt({ point, selected: copyParts(map, parts) }),
          onCurve: (wall) => setCurving(wallsWith(wall)),
          onFlip: (wall, sides) => flipSelection(wallsWith(wall), sides),
          onStairs: (room) =>
            setStairs(
              selectedRooms.some((item) => item.id === room) &&
                selectedRooms.length > 1
                ? selectedRooms.map((item) => item.id)
                : [room],
            ),
        }}
        textures={{
          picked: look?.kind === "wall" ? look.texture : null,
          widthOf: (name) => assets.texture(name).width,
          onPick: (name) => {
            setLook({ kind: "wall", texture: name });
            setPieceNewer(false);
            setNotice(`Picked up ${name}. Right-click a wall to apply it.`);
          },
          onReplace: (kind, from) => setReplacing({ kind, from }),
        }}
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
      {replacing ? (
        <TexturePicker
          kind={replacing.kind}
          title={`Replace ${replacing.from} everywhere`}
          context={`${countTexture(map, replacing.from, replacing.kind)} in this map`}
          value={replacing.from}
          common={replacing.kind === "flat" ? floorTextures : wallTextures}
          use={replacing.kind === "flat" ? flatUse(map) : wallUse(map)}
          picture={replacing.kind === "flat" ? assets.flat : assets.texture}
          assets={assets}
          light={255}
          onApply={(to) => {
            const replaced = replaceTexture(
              map,
              replacing.from,
              to,
              replacing.kind,
            );
            if (replaced.count === 0) return;
            commit(replaced.map);
            setNotice(
              `Replaced ${replacing.from} with ${to} in ${replaced.count} ${replaced.count === 1 ? "place" : "places"}.`,
            );
          }}
          onClose={() => setReplacing(null)}
        />
      ) : null}
      {curving ? (
        <CurveDialog
          walls={curving.length}
          onApply={(segments, distance) => {
            const curved = curveWalls(map, curving, segments, distance);
            if (curved === map) {
              setNotice("Those walls can't bend that way, or carry a switch.");
              return;
            }
            // The walls picked are now runs of new ones.
            if (
              commitTool(
                curved,
                "That curve would cross another wall. Try a smaller bulge.",
              )
            ) {
              setSurface(null);
              setSelection([]);
            }
          }}
          onClose={() => setCurving(null)}
        />
      ) : null}
      {stairs ? (
        <StairsDialog
          rooms={stairs.length}
          onApply={(steps, height, ceilings) => {
            if (stairs.length > 1) {
              const stepped = stairRooms(map, stairs, height, ceilings);
              if (!stepped) {
                setNotice(
                  "Stairs need rooms in one run, each joined to the next, without branches.",
                );
                return;
              }
              commitTool(
                stepped,
                "Those steps would leave a room with its ceiling below its floor.",
              );
              return;
            }
            const cut = splitIntoSteps(map, stairs[0], steps, height, ceilings);
            if (!cut) {
              setNotice(
                "That room can't be cut into steps without reaching into another.",
              );
              return;
            }
            if (
              commitTool(
                cut.map,
                "Those steps would leave a room with its ceiling below its floor.",
              )
            ) {
              setSurface(null);
              setActiveSector(null);
              setSelection(cut.rooms.map((id) => `${roomKeyPrefix}${id}`));
            }
          }}
          onClose={() => setStairs(null)}
        />
      ) : null}
      {finding ? (
        <FindDialog
          map={map}
          onSelect={selectFound}
          onClose={() => setFinding(false)}
        />
      ) : null}
      {transforming ? (
        <TransformDialog
          onApply={(steps) => transformSelection(steps, transforming)}
          onClose={() => setTransforming(null)}
        />
      ) : null}
      {prefabsAt ? (
        <PrefabsDialog
          selected={prefabsAt.selected}
          suggestedName={prefabsAt.selected?.sectors[0]?.name ?? "Prefab"}
          onPlace={(fragment) => {
            setLastPrefab(fragment);
            pasteFragment(
              { fragment, origin: null },
              prefabsAt.point ?? pastePoint(),
            );
          }}
          onClose={() => setPrefabsAt(null)}
        />
      ) : null}
      {building ? (
        <BuildDialog
          map={map}
          name={mapName}
          slot={slot}
          game={iwadGame}
          context={context}
          limits={limits}
          onBuild={(fileName) => {
            try {
              downloadWad(
                map,
                engineSlot(slot, iwadGame),
                fileName,
                { par, music, sky, intertext },
                iwad ? texturesOf(iwad) : undefined,
              );
            } catch (error) {
              return `Couldn't build the map. ${(error as Error).message}`;
            }
            setBuilding(false);
            return null;
          }}
          onShow={(issue) => {
            setBuilding(false);
            showIssue(issue);
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
          music={music}
          sky={sky}
          intertext={intertext}
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
          music={music}
          sky={sky}
          intertext={intertext}
          onExit={exitGame}
          onAddNote={(point, text, moment) =>
            commit(addNote(map, point, text, moment))
          }
          onEditSpot={editPlayedSpot}
          onRun={keepPlaytest}
        />
      ) : null}
    </>
  );
}

function loadGrid(): GridSetting {
  try {
    const saved = JSON.parse(savedGrid.get() ?? "null");
    return {
      size: (gridSizes as readonly number[]).includes(saved?.size)
        ? (saved.size as number)
        : gridSize,
      snap: saved?.snap !== false,
      merge: saved?.merge !== false,
    };
  } catch {
    return { size: gridSize, snap: true, merge: true };
  }
}

// Without storage the card would come back on every visit.
function loadWelcomed() {
  return !savedWelcome.available() || savedWelcome.get() !== null;
}

const defaultSplit = [50, 50];

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

function subscribeNarrow(listener: () => void) {
  const query = matchMedia(narrowQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function getIsNarrow() {
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

function shapeLabel(shape: DrawShape, sides: number) {
  if (shape === "outline") return "Outline";
  if (shape === "rectangle") return "Rectangle";
  if (shape === "ellipse") return "Ellipse";
  if (shape === "grid") return "Grid of rooms";
  return `${sides} sides`;
}

function keyText(keys: string) {
  return formatShortcut(keys).replace(/[\u2066\u2069]/g, "");
}

function sceneLabel(keys: Record<EditorShortcut, string>) {
  const clauses = [
    "W, A, S and D walk",
    keys.sceneFly &&
      `${keyText(keys.sceneFly)} switches between walking and flying`,
    "Space and C fly up and down",
    `dragging with the right button${keys.sceneLook ? ` or pressing ${keyText(keys.sceneLook)}` : ""} looks around`,
    keys.sceneNext &&
      keys.scenePrevious &&
      `${keyText(keys.sceneNext)} and ${keyText(keys.scenePrevious)} step through surfaces`,
    keys.sceneOpen &&
      `${keyText(keys.sceneOpen)} opens the door or lift under the pointer`,
  ].filter(Boolean);
  return `3D view. Click a surface to select it, and drag a wall or press the arrows to move its texture. ${clauses.join(", ")}.`;
}

function keyHint(keys: string, format = true) {
  if (!keys) return "";
  return ` (${format ? formatShortcut(keys) : keys})`;
}

// Any key can be given a modifier, which the registry lets through in a text
// field, so only these few still work while typing.
const typingShortcuts = new Set<EditorShortcut>(["help", "play", "playHere"]);

function shortcut(name: EditorShortcut, when?: () => boolean) {
  return {
    description: editorShortcuts[name].description,
    when: () =>
      !document.querySelector(".game-stage") &&
      (typingShortcuts.has(name) || notTyping()) &&
      (when?.() ?? true),
  };
}

function notTyping() {
  const focused = document.activeElement;
  return !(
    focused instanceof HTMLElement &&
    (focused.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName))
  );
}

function saveLayout(view: ViewLayout, sizes: number[], dock: boolean) {
  savedLayout.set(JSON.stringify({ view, sizes, dock }));
}

// Edits from the 3D view that join one undo step while they keep coming, like
// a held key's repeats.
const sceneGroups: Partial<Record<string, string>> = {
  wheel: "scene-wheel",
  "offset-key": "scene-offsets",
  "height-key": "scene-heights",
};

function getIsLiveKey(map: GameMap, key: string) {
  if (key.startsWith(wallKeyPrefix)) {
    return key
      .slice(wallKeyPrefix.length)
      .split("|")
      .every((id) => map.vertices[id]);
  }
  if (key.startsWith(roomKeyPrefix)) {
    const id = key.slice(roomKeyPrefix.length);
    return map.sectors.some((room) => room.id === id);
  }
  if (key.startsWith(thingKeyPrefix)) {
    const id = key.slice(thingKeyPrefix.length);
    return map.things.some((thing) => thing.id === id);
  }
  if (key.startsWith(switchKeyPrefix)) {
    const id = key.slice(switchKeyPrefix.length);
    return map.switches.some((item) => item.id === id);
  }
  return Boolean(map.vertices[key]);
}

function roomKeys(map: GameMap, mode: EditMode, id: string | null) {
  const room = map.sectors.find((sector) => sector.id === id);
  if (!room) return [];
  if (mode === "sectors") return [`${roomKeyPrefix}${room.id}`];
  return mode === "vertices" ? sectorVertices(room) : [];
}

// A pane shown by a key takes the keys that follow, once it has rendered.
function focusPane(pane: SinglePane) {
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>(
        pane === "scene"
          ? '[data-pane="scene"] [aria-roledescription="3D map editor"]'
          : '[aria-roledescription="map editor"]',
      )
      ?.focus({ preventScroll: true });
  });
}

function modeKeys() {
  return mapKeys() && !document.activeElement?.closest(".scene");
}

const listRoles = '[role="combobox"], [role="listbox"], [role="menu"]';

// Letters belong to typeahead in open lists, and to walking in the 3D view.
function mapKeys() {
  return !document.activeElement?.closest(listRoles);
}

function downloadWad(
  map: GameMap,
  slot: string,
  fileName: string,
  level: Parameters<typeof compileMap>[2],
  textures: Parameters<typeof compileMap>[3],
) {
  downloadFile(
    fileName,
    compileMap(map, slot, level, textures).slice().buffer,
    "application/octet-stream",
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

function countOf(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}
