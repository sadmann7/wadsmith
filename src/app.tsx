import { createUndoStack, matchesShortcut } from "@ui-sdk/core";
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
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
} from "@ui-sdk/react/toolbar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { agent } from "./agent";
import { SectorInspector, ThingInspector } from "./editor/inspector";
import { MapCanvas } from "./editor/map-canvas";
import type { MapTool } from "./editor/map-editor";
import { PlayPanel } from "./engine/play-panel";
import { thingCatalog, thingKinds } from "./map/catalog";
import {
  thingKeyPrefix,
  updateSector,
  updateThing,
  type RoomSide,
} from "./map/edit";
import { starterMap } from "./map/starter-map";
import type { GameMap, ThingKind } from "./map/types";
import { validateMap } from "./map/validate";
import { MapPreview, type MapPreviewHandle } from "./preview/map-preview";
import { compileMap } from "./wad/compile";

const toolHints: Record<MapTool, string> = {
  select:
    "Drag corners and things. Shift-click adds to the selection. Drag empty space to pan.",
  draw: "Click corners, then click the first one or press Enter. Reuse a wall's corners to connect rooms.",
  thing: "Click inside a room to place the chosen thing.",
};

const roomSides: RoomSide[] = ["north", "east", "south", "west"];

function isTextEntry(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName))
  );
}

function downloadWad(map: GameMap) {
  const data = compileMap(map);
  const url = URL.createObjectURL(
    new Blob([data.slice().buffer], { type: "application/octet-stream" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "wadsmith-map01.wad";
  link.click();
  URL.revokeObjectURL(url);
}

function App() {
  const [map, setMap] = useState(starterMap);
  const [tool, setTool] = useState<MapTool>("select");
  const [thingKind, setThingKind] = useState<ThingKind>("imp");
  const [activeSector, setActiveSector] = useState<string | null>("sector-3");
  const [selection, setSelection] = useState<string[]>([]);
  const [tab, setTab] = useState("preview");
  const [playedMap, setPlayedMap] = useState<GameMap | null>(null);
  const [playRun, setPlayRun] = useState(0);
  const [agentLog, setAgentLog] = useState("");
  const [, setHistoryVersion] = useState(0);
  const previewRef = useRef<MapPreviewHandle>(null);
  const [history] = useState(() =>
    createUndoStack(starterMap, { limit: 200, groupDelay: 500 }),
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

  const commit = (next: GameMap, group?: string) => {
    history.record(next, group ? { group } : undefined);
    setMap(next);
    setHistoryVersion((version) => version + 1);
  };

  const restore = useCallback((next: GameMap | undefined) => {
    if (!next) return;
    setMap(next);
    setSelection([]);
    setHistoryVersion((version) => version + 1);
  }, []);
  const undo = () => restore(history.undo());
  const redo = () => restore(history.redo());

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target)) return;
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

  const play = () => {
    if (!canPlay) return;
    setPlayedMap(map);
    setPlayRun((run) => run + 1);
    setTab("play");
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
    <div className="app">
      <header className="topbar">
        <h1>Wadsmith</h1>
        <Toolbar aria-label="Map tools" className="toolbar">
          <SegmentedControl
            aria-label="Tool"
            className="segments"
            value={tool}
            onValueChange={(next) => setTool(next as MapTool)}
          >
            <SegmentedControlIndicator className="segments-indicator" />
            <SegmentedControlItem value="select">Select</SegmentedControlItem>
            <SegmentedControlItem value="draw">Draw room</SegmentedControlItem>
            <SegmentedControlItem value="thing">Place</SegmentedControlItem>
          </SegmentedControl>
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
            <SelectTrigger
              className="select-trigger"
              aria-label="Thing to place"
            >
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
          <ToolbarSeparator className="separator" />
          <ToolbarButton
            className="button"
            disabled={!history.canUndo()}
            onClick={undo}
          >
            Undo
          </ToolbarButton>
          <ToolbarButton
            className="button"
            disabled={!history.canRedo()}
            onClick={redo}
          >
            Redo
          </ToolbarButton>
        </Toolbar>
        <div className="topbar-end">
          <button
            type="button"
            className="button"
            disabled={!canPlay}
            onClick={() => downloadWad(map)}
          >
            Download WAD
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!canPlay}
            onClick={play}
          >
            {tab === "play" ? "Restart" : "Play"}
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="map-pane" aria-label="Top-down map">
          <MapCanvas
            map={map}
            tool={tool}
            thingKind={thingKind}
            activeSector={activeSector}
            selection={selection}
            onMapChange={(next) => commit(next)}
            onToolChange={setTool}
            onActiveSectorChange={setActiveSector}
            onSelectionChange={setSelection}
            onDraftMapChange={(draft) => previewRef.current?.show(draft)}
          />
          <p className="tool-hint">{toolHints[tool]}</p>
        </section>

        <aside className="side">
          <Tabs value={tab} onValueChange={(next) => setTab(next as string)}>
            <TabsList aria-label="View" className="tabs">
              <TabsTab value="preview">3D preview</TabsTab>
              <TabsTab value="play" disabled={!playedMap}>
                Game
              </TabsTab>
            </TabsList>
            <TabsPanel value="preview" className="panel">
              {tab === "preview" ? (
                <MapPreview ref={previewRef} map={map} />
              ) : null}
            </TabsPanel>
            <TabsPanel value="play" className="panel">
              {tab === "play" && playedMap ? (
                <PlayPanel key={playRun} map={playedMap} />
              ) : null}
            </TabsPanel>
          </Tabs>

          {issues.length > 0 ? (
            <section className="card issues" aria-label="Map problems">
              <h2>Fix before playing</h2>
              <ul>
                {issues.slice(0, 5).map((issue) => (
                  <li key={issue.id}>{issue.message}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="card">
            <h2>{thing ? "Thing" : sector ? "Room" : "Inspector"}</h2>
            {thing ? (
              <ThingInspector
                key={thing.id}
                thing={thing}
                onChange={(patch) =>
                  commit(updateThing(map, thing.id, patch), `thing:${thing.id}`)
                }
              />
            ) : sector ? (
              <SectorInspector
                key={sector.id}
                sector={sector}
                onChange={(patch) =>
                  commit(
                    updateSector(map, sector.id, patch),
                    `sector:${sector.id}`,
                  )
                }
              />
            ) : (
              <p className="muted">Click a room or thing on the map.</p>
            )}
          </section>

          <section className="card">
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
    </div>
  );
}

export { App };
