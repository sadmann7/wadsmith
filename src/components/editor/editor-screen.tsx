"use client";

import {
  createLocalStorage,
  createUndoStack,
  matchesShortcut,
} from "@ui-sdk/core";
import * as SegmentedControlPrimitive from "@ui-sdk/react/segmented-control";
import { useShortcut } from "@ui-sdk/react/shortcuts";
import {
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

import type { GameMap, Point, ThingCategory, ThingKind } from "@/lib/map/types";

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
import { useIwad } from "@/hooks/use-iwad";
import { agent } from "@/lib/editor/agent";
import {
  dropFragment,
  heldFragment,
  holdFragment,
  originOf,
} from "@/lib/editor/clipboard";
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
import { checkMap, fixIssue, issueText } from "@/lib/map/checks";
import {
  addNote,
  addPlayerStarts,
  addSwitch,
  duplicateThings,
  freeWallAt,
  gridSize,
  gridSizes,
  removeNote,
  type RoomSide,
  setDoorTexture,
  setLineTarget,
  setRoomDoor,
  setRoomWalls,
  switchKeyPrefix,
  thingKeyPrefix,
  updateLine,
  updateLineSide,
  updateSector,
  updateSwitch,
  updateThings,
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
  wallKey,
  wallOwners,
} from "@/lib/map/geometry";
import { describeLine } from "@/lib/map/lines";
import { lineLinks, type MapLink, sectorLinks } from "@/lib/map/links";
import { gradient, gradientEnds, type SurfaceLook } from "@/lib/map/look";
import { type DrawShape, polygonSides } from "@/lib/map/shapes";
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
import { SceneCamera } from "@/lib/preview/scene-camera";
import { createFlatAssets, readWadAssets } from "@/lib/wad/assets";
import { compileMap } from "@/lib/wad/compile";

import type { EditMode, MapTool, MapViewStatus } from "./map-editor";

import { BuildDialog } from "./build-dialog";
import { MapContextMenu } from "./context-menu";
import { GradientPanel } from "./gradient-panel";
import {
  LineInspector,
  RoomsInspector,
  SectorInspector,
  SwitchInspector,
  ThingInspector,
} from "./inspector";
import { MapCanvas } from "./map-canvas";
import { type EpisodeEntry, type MapHealth, MapSwitcher } from "./map-switcher";
import { NewMapPanel } from "./new-map-panel";
import { PrefabsDialog } from "./prefabs-dialog";
import { type DraftSource, SceneCanvas } from "./scene-editor";
import { ShortcutSheet } from "./shortcut-sheet";
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
    "Click a floor to place it, or press Enter in 3D to place it ahead. Esc stops placing.",
  switch:
    "Click a solid wall to add a switch, then drag from it to a door. Esc cancels.",
};

const shapeHints: Record<Exclude<DrawShape, "outline">, string> = {
  rectangle:
    "Click one corner, then the opposite one. Choose another shape in the status bar.",
  polygon:
    "Click the middle, then where one corner goes. Choose another shape in the status bar.",
};

const noLinks: MapLink[] = [];

// The same ranges the inspector's fields keep a single room within.
const roomLimits = {
  floor: { min: -1024, max: 1024 },
  ceiling: { min: -1024, max: 2048 },
  light: { min: 0, max: 255 },
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
  onOpenEpisodes: () => void;
  navigation: React.ReactNode;
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
}

interface PlayedGame {
  map: GameMap;
  coop: HostedGame | null;
}

const saveLabels: Record<AppProps["saveStatus"], string> = {
  saving: "Saving…",
  saved: "Saved in this browser",
  failed: "Not saved: storage is unavailable",
  session: "Browser storage is off: saved for this session only",
};

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
  onOpenEpisodes,
  navigation,
  onNewMap,
  onMapSettings,
  playing,
  onPlayingChange,
  episode,
}: AppProps) {
  const [map, setMap] = React.useState(initialMap);
  const [tool, setTool] = React.useState<MapTool>("select");
  const [gridSetting, setGridSetting] = React.useState(loadGrid);
  // Snapping off still lands on whole units, which is all the engine stores.
  const grid = gridSetting.snap ? gridSetting.size : 1;
  const changeGrid = React.useCallback((next: GridSetting) => {
    setGridSetting(next);
    savedGrid.set(JSON.stringify(next));
  }, []);
  const stepGrid = React.useCallback(
    (direction: 1 | -1) => {
      const at = gridSizes.indexOf(
        gridSetting.size as (typeof gridSizes)[number],
      );
      const next = gridSizes[at + direction];
      if (next !== undefined) changeGrid({ size: next, snap: true });
    },
    [changeGrid, gridSetting.size],
  );
  const [thingKind, setThingKind] = React.useState<ThingKind>("imp");
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
  const hosted = game?.coop ?? null;
  React.useEffect(() => () => hosted?.close(), [hosted]);
  const [mapVersion, setMapVersion] = React.useState(0);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [welcomed, setWelcomed] = React.useState(loadWelcomed);
  const playButton = React.useRef<HTMLButtonElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [notice, setNotice] = React.useState("");
  // A dialog opened from a room's menu keeps what the menu worked on, which
  // the selection alone may not say once the menu has closed.
  const [transforming, setTransforming] = React.useState<string[] | null>(null);
  const [replacing, setReplacing] = React.useState<{
    kind: TextureKind;
    from: string;
  } | null>(null);
  // The look last picked up, from a wall's menu on the map or by copying a
  // surface in the 3D view.
  const [look, setLook] = React.useState<SurfaceLook | null>(null);
  const lookCopy = React.useRef({ texture: "", at: -Infinity });
  const [scenePicked, setScenePicked] = React.useState<string[]>([]);
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
    createUndoStack(initialMap, { limit: 200, groupDelay: 500 }),
  );
  const [undoable, setUndoable] = React.useState({ undo: false, redo: false });
  const syncUndoable = React.useCallback(
    () => setUndoable({ undo: history.canUndo(), redo: history.canRedo() }),
    [history],
  );

  const iwad = useIwad();
  const assets = React.useMemo(() => {
    if (!iwad) return createFlatAssets();
    try {
      return readWadAssets(iwad.data, texturesOf(iwad).resources);
    } catch {
      return createFlatAssets();
    }
  }, [iwad]);
  const iwadGame = iwad?.game ?? defaultGame;
  const context = React.useMemo(
    () => ({ game: iwad?.game, names: iwad ? assets.names : undefined }),
    [assets, iwad],
  );
  // Doom II's things don't exist in a Doom 1 game.
  const placeable = React.useMemo(
    () =>
      iwadGame.doom2
        ? thingKinds
        : thingKinds.filter((kind) => !thingCatalog[kind].doom2),
    [iwadGame],
  );
  const checks = React.useMemo(() => checkMap(map, context), [context, map]);
  const issues = React.useMemo(
    () => checks.filter((issue) => issue.severity === "error"),
    [checks],
  );
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
  const callouts = React.useMemo(
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

  const showMap = React.useCallback(
    (next: GameMap) => {
      setMap(next);
      onSave(next);
      syncUndoable();
    },
    [onSave, syncUndoable],
  );

  const commit = (next: GameMap, group?: string) => {
    history.record(next, group ? { group } : undefined);
    showMap(next);
  };

  const restore = React.useCallback(
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
          ...selection.filter(
            (key) => map.vertices[key] || key.startsWith(thingKeyPrefix),
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
    setLook(null);
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
    history.record(copies.map);
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
    setNotice("");
    commit(next);
    // Corners that met others on the way are gone.
    setSelection(
      selection.filter(
        (key) =>
          next.vertices[key] ||
          key.startsWith(thingKeyPrefix) ||
          key.startsWith(switchKeyPrefix),
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
    // The piece is now the last thing copied, so the look goes.
    setLook(null);
    if (event.type === "cut") cutFragment(fragment);
  });

  React.useEffect(() => {
    const kinds = ["copy", "cut", "paste"] as const;
    for (const kind of kinds) window.addEventListener(kind, onClipboard);
    return () => {
      for (const kind of kinds) window.removeEventListener(kind, onClipboard);
    };
  }, []);

  useShortcut(editorShortcuts.undo.keys, undo, shortcut("undo", notTyping));
  useShortcut(editorShortcuts.redo.keys, redo, shortcut("redo", notTyping));
  useShortcut(
    editorShortcuts.duplicate.keys,
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
    editorShortcuts.rotateRight.keys,
    () => transformSelection([{ kind: "rotate", degrees: 90 }]),
    shortcut("rotateRight", canTransform),
  );
  useShortcut(
    editorShortcuts.rotateLeft.keys,
    () => transformSelection([{ kind: "rotate", degrees: -90 }]),
    shortcut("rotateLeft", canTransform),
  );
  useShortcut(
    editorShortcuts.flipAcross.keys,
    () => transformSelection([{ kind: "mirror", axis: "horizontal" }]),
    shortcut("flipAcross", canTransform),
  );
  useShortcut(
    editorShortcuts.flipOver.keys,
    () => transformSelection([{ kind: "mirror", axis: "vertical" }]),
    shortcut("flipOver", canTransform),
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

  React.useEffect(() => {
    window.addEventListener("keydown", onHeldKey);
    return () => window.removeEventListener("keydown", onHeldKey);
  }, []);
  useShortcut(
    editorShortcuts.help.keys,
    () => setShowShortcuts(true),
    shortcut("help"),
  );

  const surfaceInfo = React.useMemo(
    () => describeSurface(map, surface),
    [map, surface],
  );

  React.useEffect(() => {
    camera.sync(map);
  }, [camera, map]);

  const changeLayout = React.useCallback(
    (next: ViewLayout) => {
      setLayout(next);
      saveLayout(next, splitSizes.current, showDock);
      if (next === "scene") {
        setTool((current) =>
          current === "draw" || current === "line" || current === "switch"
            ? "select"
            : current,
        );
      }
    },
    [showDock],
  );

  const chooseMode = React.useCallback(
    (mode: RailMode) => {
      if (mode === "draw" || mode === "line") {
        if (visibleLayout !== "scene") setTool(mode);
        return;
      }
      setEditMode(mode);
      setTool("select");
    },
    [visibleLayout],
  );

  const togglePane = React.useCallback(
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
    editorShortcuts.drawLine.keys,
    () => chooseMode("line"),
    shortcut("drawLine", modeKeys),
  );
  useShortcut(
    editorShortcuts.gridSmaller.keys,
    () => stepGrid(-1),
    shortcut("gridSmaller", modeKeys),
  );
  useShortcut(
    editorShortcuts.gridLarger.keys,
    () => stepGrid(1),
    shortcut("gridLarger", modeKeys),
  );
  useShortcut(
    editorShortcuts.snap.keys,
    () => changeGrid({ ...gridSetting, snap: !gridSetting.snap }),
    shortcut("snap", modeKeys),
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

  const sceneSelection = React.useMemo(() => {
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
  const sceneInfo = React.useMemo(
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
        aria-label="3D view. Click a surface to select it, and drag a wall to move its texture. W, A, S and D walk, N and P step through surfaces, and O opens the door or lift under the pointer."
        className="screen scene"
        map={map}
        assets={assets}
        camera={camera}
        draftSource={drafts.subscribe}
        selected={surfaceInfo ? surface : null}
        linked={sceneInfo ? sceneSelection : null}
        placing={tool === "thing" ? thingKind : null}
        sky={sky ?? defaultSky(slot, iwadGame)}
        grid={grid}
        renderWidth={640}
        renderHeight={400}
        look={look}
        onLookChange={(next) => {
          setLook(next);
          lookCopy.current = { texture: next.texture, at: performance.now() };
          setNotice(
            `Copied ${next.texture}. Paste it with the paste key, paint it with Alt and a click${next.kind === "wall" ? ", or flood it along joined walls with F" : ""}.`,
          );
        }}
        picked={scenePicked}
        onPickedChange={setScenePicked}
        onMapChange={(next, details) =>
          commit(next, details.reason === "wheel" ? "scene-wheel" : undefined)
        }
        onSelectedChange={selectSurface}
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

  const sceneStatus = (
    <p className="scene-status" role="status">
      {pickedSurfaces.length > 1
        ? `${pickedSurfaces.length} surfaces picked. Shift-click adds or removes one.`
        : sceneInfo
          ? `${sceneInfo.label}${sceneInfo.texture ? ` · ${sceneInfo.texture}` : ""}${sceneInfo.height !== null ? ` · height ${sceneInfo.height}` : ""}`
          : "Click a floor, ceiling, wall or thing. Drag a wall to move its texture."}
    </p>
  );

  React.useEffect(
    () =>
      watchExternal((next) => {
        history.record(next);
        setMap(next);
        setSelection([]);
        setSurface(null);
        syncUndoable();
      }),
    [history, syncUndoable, watchExternal],
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

  const lineCount = React.useMemo(() => wallOwners(map).size, [map]);

  const showMapCheck = () => {
    mapCheck.current?.scrollIntoView({ block: "nearest" });
    mapCheck.current?.focus();
  };

  const updateViewStatus = (status: MapViewStatus) => {
    const { pointer, zoom } = status;
    viewStatus.current = status;
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
    if (action === "imp") void runAgent("placeThing", ["imp", sector.name]);
    else if (action === "door") void runAgent("makeDoor", [sector.name, "use"]);
    else void runAgent("addConnectedRoom", [sector.name, action, 192]);
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
    setNotice(
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
                <MenuItem value="open">Replace with map file…</MenuItem>
                <MenuItem value="save">Save map file</MenuItem>
                <MenuSeparator />
                <MenuItem value="wad">Build WAD…</MenuItem>
              </MenuContent>
            </Menu>
            <Menu onAction={(action) => (action === "undo" ? undo() : redo())}>
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
                  shortcut={editorShortcuts.undo.keys}
                  disabled={!undoable.undo}
                >
                  Undo
                </MenuItem>
                <MenuItem
                  value="redo"
                  shortcut={editorShortcuts.redo.keys}
                  disabled={!undoable.redo}
                >
                  Redo
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
                <MenuSeparator />
                <MenuItem
                  value="shortcuts"
                  shortcut={editorShortcuts.help.keys}
                >
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
            className="tool-rail"
            value={railMode}
            onValueChange={(next) => chooseMode(next as RailMode)}
          >
            {railModes.map(({ value, label, shortcut: key, icon: Icon }) => (
              <SegmentedControlPrimitive.SegmentedControlItem
                key={value}
                value={value}
                aria-keyshortcuts={editorShortcuts[key].keys}
                title={`${modeNames[value]} (${editorShortcuts[key].keys.toUpperCase()})`}
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
              className="absolute top-3 right-3 z-5"
              value={visibleLayout}
              onValueChange={(next) => changeLayout(next as ViewLayout)}
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
                      focusRequest={focusRequest}
                      callouts={callouts}
                      links={links}
                      drawShape={drawShape}
                      drawSides={drawSides}
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

            {line && selectedWall ? (
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
                onAlign={
                  alignedMap === map ? undefined : () => commit(alignedMap)
                }
              />
            ) : !selectedSwitch && (thing || placingThings) ? (
              <ThingInspector
                map={map}
                things={selectedThings}
                placing={thingKind}
                kinds={placeable}
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
                onPlace={(kind) => {
                  setThingKind(kind);
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
                    selectedRooms.reduce(
                      (next, room) =>
                        patch.wallTexture
                          ? setRoomWalls(next, room.id, patch.wallTexture)
                          : // A door has no ceiling height of its own.
                            updateSector(
                              next,
                              room.id,
                              room.door && "ceiling" in patch ? {} : patch,
                            ),
                      map,
                    ),
                    `rooms:${selectedRooms.map((room) => room.id).join()}`,
                  )
                }
                onShift={(key, delta) => {
                  const moved = selectedRooms.flatMap((room) => {
                    // A room already past a limit stays, and never moves
                    // against the step.
                    const { min, max } = roomLimits[key];
                    const value =
                      delta > 0
                        ? Math.max(room[key], Math.min(max, room[key] + delta))
                        : Math.min(room[key], Math.max(min, room[key] + delta));
                    return (room.door && key === "ceiling") ||
                      value === room[key]
                      ? []
                      : [{ id: room.id, value }];
                  });
                  if (moved.length === 0) return;
                  commit(
                    moved.reduce(
                      (next, { id, value }) =>
                        updateSector(next, id, { [key]: value }),
                      map,
                    ),
                    `rooms:${selectedRooms.map((room) => room.id).join()}`,
                  );
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
                    {["outline", "rectangle", ...polygonSides.map(String)].map(
                      (value) => (
                        <MenuRadioItem key={value} value={value} closeOnSelect>
                          {Number.isFinite(Number(value))
                            ? shapeLabel("polygon", Number(value))
                            : shapeLabel(value as DrawShape, 0)}
                          <MenuItemIndicator className="ml-auto text-primary">
                            <Check size={14} />
                          </MenuItemIndicator>
                        </MenuRadioItem>
                      ),
                    )}
                  </MenuRadioGroup>
                </MenuContent>
              </Menu>
            ) : null}
            <span className="max-2xl:hidden">
              {Object.keys(map.vertices).length} vertices · {lineCount} lines
            </span>
            <span>
              {map.sectors.length} sectors · {map.things.length} things
            </span>
            <span ref={pointerStatus}>X - Y -</span>
            <Menu>
              <MenuTrigger
                className={buttonVariants({
                  variant: "text",
                  className: "min-h-5 px-1 font-mono text-[11px]",
                })}
                title={`Grid size and snapping (${editorShortcuts.gridSmaller.keys} ${editorShortcuts.gridLarger.keys} ${editorShortcuts.snap.keys.toUpperCase()})`}
              >
                Grid {gridSetting.size} · Snap {gridSetting.snap ? "on" : "off"}
              </MenuTrigger>
              <MenuContent align="end">
                <MenuRadioGroup
                  value={String(gridSetting.size)}
                  onValueChange={(value) =>
                    changeGrid({ size: Number(value), snap: true })
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
        grid={grid}
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
        }}
        textures={{
          picked: look?.kind === "wall" ? look.texture : null,
          widthOf: (name) => assets.texture(name).width,
          onPick: (name) => {
            setLook({ kind: "wall", texture: name });
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
          onPlace={(fragment) =>
            pasteFragment(
              { fragment, origin: null },
              prefabsAt.point ?? pastePoint(),
            )
          }
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
          onAddNote={(point, text) => commit(addNote(map, point, text))}
          onEditSpot={editPlayedSpot}
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
    };
  } catch {
    return { size: gridSize, snap: true };
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
  return `${sides} sides`;
}

function shortcut(name: EditorShortcut, when?: () => boolean) {
  return {
    description: editorShortcuts[name].description,
    when: () => !document.querySelector(".game-stage") && (when?.() ?? true),
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
