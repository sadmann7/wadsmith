// @vitest-environment happy-dom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import type { GameStatus } from "@/lib/engine/runtime";

import { defined } from "@/lib/defined";
import { blankMap } from "@/lib/map/starter-map";

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

function renderHud(
  current: GameStatus,
  isBetween = false,
  scores: ScoreRow[] | null = null,
) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const noop = () => {};
  React.act(() =>
    root?.render(
      <GameHud
        map={null}
        title="Starter map"
        slot="MAP01"
        par={null}
        status={current}
        fullscreen={false}
        showHelp={false}
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
        mouseMode="locked"
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
