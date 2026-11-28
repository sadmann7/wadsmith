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
let redraw: (current: GameStatus) => void = () => {};

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
    slot: 0,
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
  others?: { peer: number; slot: number; x: number; y: number }[];
  crosshair?: boolean;
  mouseMode?: MouseMode;
  deathmatch?: boolean;
  coop?: "host" | "guest" | null;
  onRespawn?: () => void;
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

it("offers a dead player a way to try again", () => {
  let respawns = 0;
  const container = renderHud(status, false, null, {
    mouseMode: "idle",
    onRespawn: () => {
      respawns += 1;
    },
  });
  const panel = () => container.querySelector("[aria-label='You died']");
  expect(panel()).toBeNull();
  redraw({ ...status, health: 0 });
  expect(panel()?.textContent).toContain("Press E to try again.");
  const button = defined(panel()?.querySelector("button"));
  expect(button.textContent).toBe("Try again");
  React.act(() => button.click());
  expect(respawns).toBe(1);
});

it("keeps the paused panel over the death panel while the mouse is released", () => {
  const container = renderHud({ ...status, health: 0 }, false, null, {
    mouseMode: "released",
  });
  expect(container.querySelector("[aria-label='You died']")).toBeNull();
  expect(container.querySelector("[aria-label=Paused]")).not.toBeNull();
});

it("keeps the death panel up in co-op, where a released mouse doesn't pause", () => {
  const container = renderHud({ ...status, health: 0 }, false, null, {
    mouseMode: "released",
    coop: "guest",
  });
  const panel = defined(container.querySelector("[aria-label='You died']"));
  expect(panel.textContent).toContain("Press E to respawn.");
});

it("leaves the automap clear for a dead player", () => {
  const container = renderHud({ ...status, health: 0, automap: true });
  expect(container.querySelector("[aria-label='You died']")).toBeNull();
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
  const nearKey = renderHud({ ...start, x: 1456, y: -160 }, false, null, {
    map: starterMap,
  });
  expect(nearKey.querySelector("[data-key=blue]")).not.toBeNull();
  React.act(() => root?.unmount());
  const holding = renderHud(
    { ...start, x: 1456, y: -160, keys: 1 },
    false,
    null,
    {
      map: starterMap,
    },
  );
  expect(holding.querySelector("[data-key=blue]")).toBeNull();
});

it("colors another player's minimap marker by their game slot", () => {
  const container = renderHud(status, false, null, {
    map: starterMap,
    others: [{ peer: 3, slot: 1, x: 64, y: -128 }],
  });
  const marker = defined(container.querySelector("[data-peer='3']"));
  expect(marker.getAttribute("fill")).toBe("var(--color-info)");
});

it("numbers and colors a scoreboard player by game slot, like their minimap marker", () => {
  const rows = [scoreRow(1, 0), scoreRow(3, 1)];
  const others = [{ peer: 3, slot: 1, x: 64, y: -128 }];
  for (const deathmatch of [false, true]) {
    const container = renderHud(status, false, rows, {
      map: starterMap,
      others,
      deathmatch,
    });
    const marker = defined(container.querySelector("[data-peer='3']"));
    const row = defined(
      [...container.querySelectorAll("[aria-label=Scoreboard] tbody tr")].find(
        (entry) => entry.textContent?.includes("Player 3"),
      ),
    );
    const badge = defined(row.querySelector("td span"));
    expect(marker.getAttribute("fill")).toBe("var(--color-info)");
    expect(badge.className).toContain("text-info");
    expect(badge.className).not.toContain("text-warning");
    expect(badge.textContent).toBe("2");
    React.act(() => root?.unmount());
  }
});

it("hands the bottom of the view to Doom's status bar on the automap", () => {
  const container = renderHud({ ...status, automap: true }, false, null, {
    map: starterMap,
  });
  expect(container.textContent).not.toContain("Health");
  expect(container.querySelector("[aria-label=Minimap]")).toBeNull();
});

it("keeps a secret room off the minimap until the player has stood in it", () => {
  const secretWalls = (container: HTMLElement) =>
    [...container.querySelectorAll("[aria-label=Minimap] line")].filter(
      (line) =>
        Math.min(
          Number(line.getAttribute("x1")),
          Number(line.getAttribute("x2")),
        ) >= 1536,
    ).length;
  const container = renderHud({ ...status, x: 1480, y: -224 }, false, null, {
    map: starterMap,
  });
  expect(secretWalls(container)).toBe(0);
  redraw({ ...status, x: 1584, y: -224 });
  expect(secretWalls(container)).toBeGreaterThan(0);
  redraw({ ...status, x: 1480, y: -224, automap: true });
  redraw({ ...status, x: 1480, y: -224 });
  expect(secretWalls(container)).toBeGreaterThan(0);
});

it("leaves monsters and partners in a hidden secret room off the minimap", () => {
  const container = renderHud(
    { ...status, x: 1480, y: -224, monsters: [{ x: 1584, y: -224, angle: 0 }] },
    false,
    null,
    {
      map: starterMap,
      others: [{ peer: 2, slot: 1, x: 1584, y: -200 }],
    },
  );
  const minimap = defined(container.querySelector("[aria-label=Minimap]"));
  expect(minimap.querySelectorAll("[data-monster]")).toHaveLength(0);
  expect(minimap.querySelectorAll("[data-peer]")).toHaveLength(0);
});

function scoreRow(peer: number, slot: number): ScoreRow {
  return {
    peer,
    slot,
    name: `Player ${peer}`,
    host: peer === 1,
    you: peer === 1,
    frags: 0,
    deaths: 0,
    kills: 0,
    items: 0,
    secrets: 0,
    ping: null,
  };
}

function renderHud(
  current: GameStatus,
  isBetween = false,
  scores: ScoreRow[] | null = null,
  {
    map = null,
    others = [],
    crosshair = true,
    mouseMode = "locked",
    deathmatch = false,
    coop = scores ? "host" : null,
    onRespawn = () => {},
  }: HudOptions = {},
) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const noop = () => {};
  redraw = (current: GameStatus) => React.act(() => root?.render(hud(current)));
  const hud = (current: GameStatus) => (
    <GameHud
      map={map}
      title="Starter map"
      slot="MAP01"
      par={null}
      status={current}
      fullscreen={false}
      showHelp={false}
      crosshair={crosshair}
      skill="medium"
      coop={coop}
      deathmatch={deathmatch}
      scores={scores}
      others={others}
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
      onRespawn={onRespawn}
      onExit={noop}
      onOpenNote={noop}
      onSaveNote={noop}
      onEditSpot={noop}
    />
  );
  redraw(current);
  return container;
}
