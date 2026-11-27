// @vitest-environment happy-dom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import type { MouseMode } from "@/lib/engine/mouse-capture";
import type { GameStatus } from "@/lib/engine/runtime";
import type { GameMap } from "@/lib/map/types";

import { defined } from "@/lib/defined";
import { blankMap, starterMap } from "@/lib/map/starter-map";

import { GameHud, type ScoreRow } from "./game-hud";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

afterEach(() => {
  React.act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const status: GameStatus = {
  inLevel: true,
  inFinale: false,
  episode: 1,
  map: 1,
  health: 100,
  kills: 1,
  frags: 0,
  totalKills: 4,
  x: 0,
  y: 0,
  angle: 0,
  armor: 0,
  ammo: 50,
  ammoType: 1,
  keys: 0,
  items: 0,
  totalItems: 0,
  secrets: 0,
  totalSecrets: 1,
  tics: 350,
  automap: false,
  monsters: [],
};

it("leaves out items on a map with nothing Doom counts as one", () => {
  const container = renderHud(status);
  const run = defined(container.querySelector("[aria-label=Run]"));
  expect(run.textContent).toContain("Enemies1 / 4");
  expect(run.textContent).toContain("Secrets0 / 1");
  expect(run.textContent).not.toContain("Items");
});

it("counts items on a map that has them", () => {
  const container = renderHud({ ...status, items: 1, totalItems: 3 });
  const run = defined(container.querySelector("[aria-label=Run]"));
  expect(run.textContent).toContain("Items1 / 3");
});

it("leaves items out of the tally between levels when there were none", () => {
  const container = renderHud(status, true);
  const tally = defined(
    container.querySelector("[aria-label='MAP01 complete'] dl"),
  );
  expect(tally.textContent).not.toContain("Items");
  expect(tally.className).toContain("grid-cols-3");
});

it("keeps items in the tally between levels when there were some", () => {
  const container = renderHud({ ...status, items: 2, totalItems: 2 }, true);
  const tally = defined(
    container.querySelector("[aria-label='MAP01 complete'] dl"),
  );
  expect(tally.textContent).toContain("Items2 / 2");
  expect(tally.className).toContain("grid-cols-4");
});

it("shows the items column on the co-op scoreboard only when there are some", () => {
  const row: ScoreRow = {
    peer: 1,
    name: "Host",
    host: true,
    you: true,
    frags: 0,
    deaths: 0,
    kills: 1,
    items: 0,
    secrets: 0,
    ping: null,
  };
  const empty = renderHud(status, false, [row]);
  const heads = () =>
    [...document.querySelectorAll("[aria-label=Scoreboard] th")].map(
      (cell) => cell.textContent,
    );
  expect(empty.querySelector("[aria-label=Scoreboard]")).not.toBeNull();
  expect(heads()).toEqual(["Player", "kills", "secrets", "Ping"]);
  React.act(() => root?.unmount());
  renderHud({ ...status, totalItems: 3 }, false, [row]);
  expect(heads()).toEqual(["Player", "kills", "items", "secrets", "Ping"]);
});

interface HudOptions {
  map?: GameMap | null;
  crosshair?: boolean;
  mouseMode?: MouseMode;
}

it("shows the crosshair dot only while the mouse aims a living player", () => {
  const dot = () => document.querySelector("[data-crosshair]");
  renderHud(status);
  expect(dot()).not.toBeNull();
  for (const options of [
    { mouseMode: "released" as const },
    { crosshair: false },
  ]) {
    React.act(() => root?.unmount());
    renderHud(status, false, null, options);
    expect(dot()).toBeNull();
  }
  React.act(() => root?.unmount());
  renderHud({ ...status, health: 0 });
  expect(dot()).toBeNull();
  React.act(() => root?.unmount());
  renderHud({ ...status, automap: true });
  expect(dot()).toBeNull();
});

it("shows held keys as colored key icons and nothing without keys", () => {
  const empty = renderHud(status);
  expect(empty.querySelector("[aria-label=Keys]")).toBeNull();
  expect(empty.textContent).not.toContain("Keys");
  React.act(() => root?.unmount());
  const held = renderHud({ ...status, keys: 0b100001 });
  const labels = [...held.querySelectorAll("[aria-label=Keys] [role=img]")].map(
    (icon) => icon.getAttribute("aria-label"),
  );
  expect(labels).toEqual(["Blue key", "Red skull key"]);
});

it("draws doors, the exit, keys and nearby monsters on the minimap", () => {
  const start = { ...status, x: 96, y: -128 };
  const container = renderHud(
    {
      ...start,
      monsters: [
        { x: 400, y: -128, angle: 180 },
        { x: 4000, y: -128, angle: 0 },
      ],
    },
    false,
    null,
    { map: starterMap },
  );
  const minimap = defined(container.querySelector("[aria-label=Minimap]"));
  expect(minimap.querySelectorAll("[data-monster]")).toHaveLength(1);
  expect(minimap.querySelector("[data-kind=exit]")).not.toBeNull();
  expect(minimap.querySelector("[data-lock=blue]")).not.toBeNull();
  React.act(() => root?.unmount());
  const nearKey = renderHud({ ...start, x: 700 }, false, null, {
    map: starterMap,
  });
  expect(nearKey.querySelector("[data-key=blue]")).not.toBeNull();
  React.act(() => root?.unmount());
  const holding = renderHud({ ...start, x: 700, keys: 1 }, false, null, {
    map: starterMap,
  });
  expect(holding.querySelector("[data-key=blue]")).toBeNull();
});

function renderHud(
  current: GameStatus,
  isBetween = false,
  scores: ScoreRow[] | null = null,
  { map = null, crosshair = true, mouseMode = "locked" }: HudOptions = {},
) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const noop = () => {};
  React.act(() =>
    root?.render(
      <GameHud
        map={map}
        title="Starter map"
        slot="MAP01"
        par={null}
        status={current}
        fullscreen={false}
        showHelp={false}
        crosshair={crosshair}
        coop={scores ? "host" : null}
        deathmatch={false}
        scores={scores}
        others={[]}
        stall={null}
        episode={isBetween}
        between={
          isBetween
            ? {
                tally: current,
                next: { map: blankMap, title: "Next", slot: "MAP02" },
                onNext: noop,
              }
            : null
        }
        exit={{ label: "Back to editor", hint: "" }}
        canEdit
        cheats={null}
        noteOpen={false}
        mouseMode={mouseMode}
        noteSaved={false}
        finished={false}
        audioUnavailable={false}
        onRestart={noop}
        onExit={noop}
        onOpenNote={noop}
        onSaveNote={noop}
        onEditSpot={noop}
      />,
    ),
  );
  return container;
}
