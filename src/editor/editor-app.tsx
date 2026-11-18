"use client";

import { createUndoStack, matchesShortcut } from "@ui-sdk/core";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@ui-sdk/react/menu";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import {
  Resizable,
  ResizableHandle,
  ResizablePanel,
} from "@ui-sdk/react/resizable";
import {
  CircleCheck,
  Expand,
  MousePointer2,
  PenLine,
  Play,
  Redo2,
  Rows2,
  ToggleRight,
  TriangleAlert,
  Undo2,
  UserPlus,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { agent } from "../agent";
import {
  LineInspector,
  SectorInspector,
  SwitchInspector,
  ThingInspector,
} from "./inspector";
import { MapCanvas } from "./map-canvas";
import type { EditMode, MapTool, MapViewStatus } from "./map-editor";
import { GameView } from "../engine/play-panel";
import { thingCatalog, thingKinds } from "../map/catalog";
import {
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
  updateThing,
  type RoomSide,
} from "../map/edit";
import { describeLine } from "../map/lines";
import { blankMap, starterMap } from "../map/starter-map";
import {
  loadSavedMap,
  MapFileError,
  maxFileBytes,
  parseMapFile,
  saveMap,
  serializeMap,
  watchSavedMap,
} from "../map/storage";
import type { GameMap, ThingKind } from "../map/types";
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
import { wallKey, wallOwners } from "../map/geometry";
import { createFlatAssets, readWadAssets } from "../wad/assets";
import { compileMap } from "../wad/compile";

const toolHints: Record<MapTool, string> = {
  select:
    "Drag corners and things. Shift-click adds to the selection. Drag empty space to pan.",
  draw: "Click corners, then click the first one or press Enter. Reuse a wall's corners to connect rooms.",
  thing: "Click inside a room to place the chosen thing.",
  switch: "Click a solid wall to add a switch, then drag from it to a door.",
};

const roomSides: RoomSide[] = ["north", "east", "south", "west"];

type ViewLayout = "map" | "split" | "scene";
type SinglePane = Exclude<ViewLayout, "split">;

const layoutKey = "wadsmith:layout";
// Below this width, two panes can't hold the map controls and a usable 3D view.
const narrowQuery = "(max-width: 1100px)";
const defaultSplit = [50, 50];
const mapSlot = "MAP01";

const tools: { value: MapTool; label: string; icon: typeof PenLine }[] = [
  { value: "select", label: "Select", icon: MousePointer2 },
  { value: "draw", label: "Draw room", icon: PenLine },
  { value: "thing", label: "Place", icon: UserPlus },
  { value: "switch", label: "Switch", icon: ToggleRight },
];

const editModes: { value: EditMode; label: string; key: string }[] = [
  { value: "vertices", label: "Vertices", key: "V" },
  { value: "lines", label: "Lines", key: "L" },
  { value: "sectors", label: "Sectors", key: "S" },
  { value: "things", label: "Things", key: "T" },
];

function loadLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(layoutKey) ?? "null");
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
  try {
    localStorage.setItem(layoutKey, JSON.stringify({ view, sizes, dock }));
  } catch {
    return;
  }
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

function isTextEntry(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName))
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

function downloadWad(map: GameMap) {
  downloadFile(
    "wadsmith-map01.wad",
    compileMap(map).slice().buffer,
    "application/octet-stream",
  );
}

function App() {
  const [initialMap] = useState(() => loadSavedMap() ?? starterMap);
  const [map, setMap] = useState(initialMap);
  const [tool, setTool] = useState<MapTool>("select");
  const [thingKind, setThingKind] = useState<ThingKind>("imp");
  const [activeSector, setActiveSector] = useState<string | null>("sector-3");
  const [selection, setSelection] = useState<string[]>([]);
  const [playedMap, setPlayedMap] = useState<GameMap | null>(null);
  const [mapVersion, setMapVersion] = useState(0);
  const [saved, setSaved] = useState(true);
  const [fileError, setFileError] = useState<string | null>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [agentLog, setAgentLog] = useState("");
  const [, setHistoryVersion] = useState(0);
  const [initialLayout] = useState(loadLayout);
  const [layout, setLayout] = useState(initialLayout.view);
  const [findCameraRequest, setFindCameraRequest] = useState(0);
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
  const sector = map.sectors.find((item) => item.id === activeSector);
  const selectedThingKey = selection.find((key) =>
    key.startsWith(thingKeyPrefix),
  );
  const thing = map.things.find(
    (item) => `${thingKeyPrefix}${item.id}` === selectedThingKey,
  );

  const selectedSwitch = map.switches.find((item) =>
    selection.includes(`${switchKeyPrefix}${item.id}`),
  );
  const doors = map.sectors.filter((item) => item.door);

  const showMap = useCallback((next: GameMap) => {
    setMap(next);
    setSaved(saveMap(next));
    setHistoryVersion((version) => version + 1);
  }, []);

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target) || document.querySelector(".game-stage")) {
        return;
      }
      if (matchesShortcut(event, "mod+shift+z")) {
        event.preventDefault();
        restore(history.redo());
      } else if (matchesShortcut(event, "mod+z")) {
        event.preventDefault();
        restore(history.undo());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history, restore]);

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

  const togglePane = useCallback(
    (pane: SinglePane) => {
      if (narrow) return;
      changeLayout(visibleLayout === "split" ? pane : "split");
    },
    [changeLayout, narrow, visibleLayout],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !["m", "c", "v", "l", "s", "t"].includes(event.key.toLowerCase()) ||
        event.repeat ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isTextEntry(event.target) ||
        (event.target as Element).closest?.(
          '[role="combobox"], [role="listbox"], [role="menu"]',
        ) ||
        document.querySelector(".game-stage")
      ) {
        return;
      }
      const shortcut = event.key.toLowerCase();
      const mode = editModes.find(
        (item) => item.key.toLowerCase() === shortcut,
      );
      if (mode) {
        // These letters belong to walking while the 3D view has focus.
        if ((event.target as Element).closest?.(".scene")) return;
        event.preventDefault();
        setEditMode(mode.value);
        return;
      }
      if (shortcut === "c") {
        const pointer = mapPointer.current;
        if (!pointer) return;
        event.preventDefault();
        setLookAtRequest((request) => ({
          ...pointer,
          id: (request?.id ?? 0) + 1,
        }));
        return;
      }
      const focused = (event.target as Element).closest?.<HTMLElement>(
        "[data-pane]",
      )?.dataset.pane as SinglePane | undefined;
      const pane =
        hoveredPane.current ??
        focused ??
        (visibleLayout === "scene" ? "scene" : "map");
      event.preventDefault();
      togglePane(pane);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePane, visibleLayout]);

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

  const scene = (
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
    />
  );

  const thingPicker = (
    <Select
      value={thingKind}
      items={thingKinds.map((value) => ({
        value,
        label: thingCatalog[value].label,
      }))}
      onValueChange={(next) => {
        if (!next) return;
        setThingKind(next as ThingKind);
        setTool("thing");
      }}
    >
      <SelectTrigger className="select-trigger" aria-label="Thing to place">
        <SelectValue />
        <span aria-hidden="true">▾</span>
      </SelectTrigger>
      <SelectContent className="select-content">
        {thingKinds.map((kind) => (
          <SelectItem key={kind} value={kind} className="select-item">
            {thingCatalog[kind].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const sceneStatus = (
    <p className="scene-status" role="status">
      {tool === "thing"
        ? `Placing ${thingCatalog[thingKind].label}. Click a floor, or press Enter to place it ahead.`
        : sceneInfo
          ? `${sceneInfo.label}${sceneInfo.texture ? ` · ${sceneInfo.texture}` : ""}${sceneInfo.height !== null ? ` · height ${sceneInfo.height}` : ""}`
          : "Click a floor, ceiling, wall or thing."}
    </p>
  );

  useEffect(
    () =>
      watchSavedMap((next) => {
        history.record(next);
        setMap(next);
        setSelection([]);
        setSurface(null);
        setSaved(true);
        setHistoryVersion((version) => version + 1);
      }),
    [history],
  );

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
    if (action === "dock") toggleDock();
    else if (action === "camera") findCameraOnMap();
    else changeLayout(action as ViewLayout);
  };

  const runMapAction = (action: string) => {
    if (action === "check") showMapCheck();
    else if (action === "play") play();
  };

  const selectionTitle = selectedSwitch
    ? "Switch"
    : thing
      ? thingCatalog[thing.kind].label
      : line
        ? `Line ${line.number}`
        : surfaceInfo && !surfaceInfo.thing
          ? surfaceInfo.label
          : (sector?.name ?? "Nothing selected");
  const selectionMeta = selectedSwitch
    ? selectedSwitch.door
      ? "Wired to a door"
      : "Not connected"
    : thing
      ? `${thing.id} · X ${thing.x} Y ${-thing.y}`
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
    if (canPlay && !buildProblem()) setPlayedMap(map);
  };

  const exitGame = () => {
    setPlayedMap(null);
    requestAnimationFrame(() => playButton.current?.focus());
  };

  const replaceMap = (next: GameMap) => {
    commit(next);
    setSelection([]);
    setActiveSector(null);
    setSurface(null);
    setFileError(null);
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
    if (action === "new") replaceMap(blankMap);
    else if (action === "open") fileInput.current?.click();
    else if (action === "save") {
      downloadFile("wadsmith-map.json", serializeMap(map), "application/json");
    } else if (action === "wad" && canPlay && !buildProblem()) {
      downloadWad(map);
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
      <div className="app" inert={Boolean(playedMap)}>
        <header className="topbar">
          <div className="topbar-start">
            <h1>WADSMITH</h1>
            <Menu onAction={(action) => runFileAction(action as string)}>
              <MenuTrigger className="menu-trigger">File</MenuTrigger>
              <MenuContent className="select-content">
                <MenuItem value="new" className="select-item">
                  New map
                </MenuItem>
                <MenuItem value="open" className="select-item">
                  Open map…
                </MenuItem>
                <MenuItem value="save" className="select-item">
                  Save map file
                </MenuItem>
                <MenuSeparator className="menu-separator" />
                <MenuItem
                  value="wad"
                  className="select-item"
                  disabled={!canPlay}
                >
                  Download WAD
                </MenuItem>
              </MenuContent>
            </Menu>
            <Menu onAction={(action) => (action === "undo" ? undo() : redo())}>
              <MenuTrigger className="menu-trigger">Edit</MenuTrigger>
              <MenuContent className="select-content">
                <MenuItem
                  value="undo"
                  className="select-item"
                  disabled={!history.canUndo()}
                >
                  Undo
                </MenuItem>
                <MenuItem
                  value="redo"
                  className="select-item"
                  disabled={!history.canRedo()}
                >
                  Redo
                </MenuItem>
              </MenuContent>
            </Menu>
            <Menu onAction={(action) => runViewAction(action as string)}>
              <MenuTrigger className="menu-trigger">View</MenuTrigger>
              <MenuContent className="select-content">
                <MenuItem value="map" className="select-item">
                  Map
                </MenuItem>
                <MenuItem
                  value="split"
                  className="select-item"
                  disabled={narrow}
                >
                  Split
                </MenuItem>
                <MenuItem value="scene" className="select-item">
                  3D
                </MenuItem>
                <MenuSeparator className="menu-separator" />
                <MenuItem value="dock" className="select-item">
                  {showDock ? "Hide player view" : "Show player view"}
                </MenuItem>
                <MenuItem value="camera" className="select-item">
                  Find camera on map
                </MenuItem>
              </MenuContent>
            </Menu>
            <Menu onAction={(action) => runMapAction(action as string)}>
              <MenuTrigger className="menu-trigger">Map</MenuTrigger>
              <MenuContent className="select-content">
                <MenuItem value="check" className="select-item">
                  Check map
                </MenuItem>
                <MenuItem
                  value="play"
                  className="select-item"
                  disabled={!canPlay}
                >
                  Playtest
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
          <div className="map-title">
            <span>{mapSlot}</span>
            <strong>{map.name ?? "Untitled map"}</strong>
          </div>
          <div className="topbar-end">
            <SegmentedControl
              aria-label="Main view"
              className="segments"
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
            <button
              type="button"
              className="icon-button"
              aria-label="Undo"
              title="Undo"
              disabled={!history.canUndo()}
              onClick={undo}
            >
              <Undo2 size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Redo"
              title="Redo"
              disabled={!history.canRedo()}
              onClick={redo}
            >
              <Redo2 size={16} aria-hidden="true" />
            </button>
            <button type="button" className="button" onClick={showMapCheck}>
              {canPlay ? (
                <CircleCheck size={15} aria-hidden="true" />
              ) : (
                <TriangleAlert size={15} aria-hidden="true" />
              )}
              Check map
            </button>
            <button
              ref={playButton}
              type="button"
              className="button primary"
              disabled={!canPlay}
              onClick={play}
            >
              <Play size={14} aria-hidden="true" />
              Playtest
            </button>
          </div>
        </header>

        <main className="workspace">
          <SegmentedControl
            aria-label="Tool"
            className="tool-rail"
            value={tool}
            onValueChange={(next) => setTool(next as MapTool)}
          >
            {tools.map(({ value, label, icon: Icon }) => (
              <SegmentedControlItem
                key={value}
                value={value}
                aria-label={label}
                title={label}
                disabled={
                  visibleLayout === "scene" &&
                  (value === "draw" || value === "switch")
                }
              >
                <Icon size={17} aria-hidden="true" />
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <div className="views" data-layout={visibleLayout}>
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
                      ".pane-actions, .map-overlay, .player-dock, [data-map-control]",
                    )
                      ? null
                      : { clientX, clientY };
                  }}
                  onPointerLeave={() => {
                    hoveredPane.current = null;
                    mapPointer.current = null;
                  }}
                >
                  <div className="map-overlay">
                    <SegmentedControl
                      aria-label="Edit mode"
                      className="edit-modes"
                      value={editMode}
                      onValueChange={(next) => setEditMode(next as EditMode)}
                    >
                      {editModes.map(({ value, label, key }) => (
                        <SegmentedControlItem key={value} value={value}>
                          {label}
                          <kbd>{key}</kbd>
                        </SegmentedControlItem>
                      ))}
                    </SegmentedControl>
                    {visibleLayout === "scene" ? null : thingPicker}
                  </div>
                  <div className="pane-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={
                        visibleLayout === "split"
                          ? "Maximize map"
                          : "Split view"
                      }
                      title={
                        visibleLayout === "split"
                          ? "Maximize map"
                          : "Split view"
                      }
                      disabled={narrow}
                      onClick={() => togglePane("map")}
                    >
                      {visibleLayout === "split" ? (
                        <Expand size={16} aria-hidden="true" />
                      ) : (
                        <Rows2 size={16} aria-hidden="true" />
                      )}
                    </button>
                  </div>
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
                    onMapChange={(next) => commit(next)}
                    onToolChange={setTool}
                    onActiveSectorChange={setActiveSector}
                    onSelectionChange={setSelection}
                    onMapSelect={() => setSurface(null)}
                    onDraftMapChange={(draft) => drafts.publish(draft)}
                    camera={camera}
                    highlightedWall={
                      parsedSurface?.kind === "wall" ? parsedSurface.wall : null
                    }
                    findCameraRequest={findCameraRequest}
                    lookAtRequest={lookAtRequest}
                  />
                  <p className="tool-hint">{toolHints[tool]}</p>
                  {visibleLayout === "map" && showDock && !narrow ? (
                    <div className="player-dock">
                      <div className="player-dock-bar">
                        <span>Player view</span>
                        <button
                          type="button"
                          className="dock-button"
                          aria-label="Open 3D view"
                          title="Open 3D view"
                          onClick={() => changeLayout("scene")}
                        >
                          <Expand size={13} aria-hidden="true" />
                        </button>
                      </div>
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
                    <div className="scene-actions">
                      {visibleLayout === "scene" ? thingPicker : null}
                      <button
                        type="button"
                        className="button"
                        onClick={findCameraOnMap}
                      >
                        Find on map
                      </button>
                      <button
                        type="button"
                        className="button"
                        disabled={narrow}
                        onClick={() => togglePane("scene")}
                      >
                        {visibleLayout === "split"
                          ? "Maximize 3D"
                          : "Split view"}
                      </button>
                    </div>
                  </div>
                </section>
              </ResizablePanel>
            </Resizable>
          </div>

          <aside className="side">
            <header className="selection-header">
              <h2>{selectionTitle}</h2>
              <p>{selectionMeta}</p>
            </header>
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
            ) : sector && !selectedSwitch && !thing ? (
              <SectorInspector
                key={sector.id}
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
                <h2>
                  {selectedSwitch ? "Switch" : thing ? "Thing" : "Inspector"}
                </h2>
                {selectedSwitch ? (
                  <SwitchInspector
                    key={selectedSwitch.id}
                    item={selectedSwitch}
                    doors={doors}
                    onChange={(patch) =>
                      commit(updateSwitch(map, selectedSwitch.id, patch))
                    }
                  />
                ) : thing ? (
                  <ThingInspector
                    key={thing.id}
                    thing={thing}
                    onChange={(patch) =>
                      commit(
                        updateThing(map, thing.id, patch),
                        `thing:${thing.id}`,
                      )
                    }
                  />
                ) : (
                  <p className="muted">Click a room or thing on the map.</p>
                )}
              </section>
            )}

            <section
              ref={mapCheck}
              className="inspector-section map-check"
              aria-label="Map check"
              tabIndex={-1}
            >
              <h2>
                Map check
                <span>
                  {issues.length === 0
                    ? "No problems"
                    : `${issues.length} ${issues.length === 1 ? "problem" : "problems"}`}
                </span>
              </h2>
              {issues.length === 0 ? (
                <p className="muted">This map is ready to playtest.</p>
              ) : (
                <ul>
                  {issues.slice(0, 8).map((issue) => (
                    <li key={issue.id} className="check-issue">
                      <TriangleAlert size={14} aria-hidden="true" />
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="inspector-section">
              <h2>Agent actions</h2>
              <p className="muted">
                These call the same bridge an AI agent uses. No model is
                connected.
              </p>
              {sector ? (
                <div className="agent-actions">
                  {roomSides.map((side) => (
                    <button
                      key={side}
                      type="button"
                      className="button"
                      onClick={() =>
                        runAgent("addConnectedRoom", [sector.name, side, 192])
                      }
                    >
                      Room {side}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="button"
                    onClick={() => runAgent("placeThing", ["imp", sector.name])}
                  >
                    Add imp
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => runAgent("makeDoor", [sector.name, "use"])}
                  >
                    Make door
                  </button>
                </div>
              ) : (
                <p className="muted">Select a room first.</p>
              )}
              {agentLog ? (
                <p className="agent-log" role="status">
                  {agentLog}
                </p>
              ) : null}
            </section>
          </aside>
        </main>
        <footer className="status-bar">
          <div>
            <span>{Object.keys(map.vertices).length} vertices</span>
            <span>{lineCount} lines</span>
            <span>{map.sectors.length} sectors</span>
            <span>{map.things.length} things</span>
          </div>
          <div>
            <span ref={pointerStatus}>X - Y -</span>
            <span>Grid {gridSize}</span>
            <span>Snap on</span>
            <span ref={zoomStatus}>Zoom 100%</span>
            <span role="status">
              {saved
                ? "Saved in this browser"
                : "Not saved: storage is unavailable"}
            </span>
          </div>
        </footer>
      </div>
      {playedMap ? <GameView map={playedMap} onExit={exitGame} /> : null}
    </>
  );
}

export { App };
