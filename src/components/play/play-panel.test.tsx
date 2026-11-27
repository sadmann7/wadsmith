// @vitest-environment happy-dom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { NetworkState } from "@/lib/engine/doom-worker";
import type { GameStatus } from "@/lib/engine/runtime";

import { defined } from "@/lib/defined";
import { defaultGame } from "@/lib/engine/game";
import { startGameClient } from "@/lib/engine/game-client";
import { testMap } from "@/lib/map/test-map";

import { type CoopSession, GameView } from "./play-panel";

vi.mock("@/lib/engine/game-client", () => ({ startGameClient: vi.fn() }));
vi.mock("@/lib/engine/iwad", () => ({
  loadIwad: () =>
    Promise.resolve({
      game: defaultGame,
      data: new Uint8Array(),
      own: false,
      resources: [],
    }),
  texturesOf: () => [],
}));
vi.mock("@/lib/wad/inspect", () => ({
  inspectWads: () => ({ complevel: "vanilla" }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type ClientOptions = Parameters<typeof startGameClient>[0];

let root: Root | null = null;
let options: ClientOptions | null = null;
let now = 0;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.mocked(startGameClient).mockImplementation((next) => {
    options = next;
    return {
      setHeld: () => {},
      setCheats: () => {},
      setSound: () => {},
      key: () => {},
      receive: () => {},
      launch: () => {},
      stop: () => {},
    } as unknown as ReturnType<typeof startGameClient>;
  });
});

afterEach(() => {
  React.act(() => root?.unmount());
  root = null;
  options = null;
  now = 0;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const status: GameStatus = {
  inLevel: true,
  inFinale: false,
  episode: 1,
  map: 1,
  health: 100,
  kills: 0,
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
  totalSecrets: 0,
  tics: 350,
  automap: false,
  monsters: [],
};

const guestSlot = 1;

it.each(["host", "guest"] as const)(
  "keeps the %s's tally and ending text clear of the waiting message",
  async (role) => {
    const client = await renderCoop(role);
    report(client, { ...status, inLevel: false }, network(0));
    expect(waitingText()).toHaveLength(1);

    report(client, status, network(10));
    expect(waitingText()).toEqual([]);

    report(client, { ...status, inLevel: false }, network(20));
    expect(waitingText()).toEqual([]);

    report(client, { ...status, inLevel: false, inFinale: true }, network(30));
    expect(waitingText()).toEqual([]);
  },
);

it("names a guest the host waits on while a level is played", async () => {
  const client = await renderCoop("host");
  report(client, status, network(10));
  now = 1500;
  report(client, status, network(10, 1 << guestSlot));
  expect(waitingText()).toEqual([
    "Waiting for GuestEveryone waits so the game stays in step.0 s",
  ]);
});

it("names a guest the host waits on at the tally", async () => {
  const client = await renderCoop("host");
  report(client, status, network(10));
  const tally = { ...status, inLevel: false };
  now = 500;
  report(client, tally, network(20, 1 << guestSlot));
  expect(waitingText()).toEqual([]);
  now = 1600;
  report(client, tally, network(20, 1 << guestSlot));
  expect(waitingText()).toEqual([
    "Waiting for GuestEveryone waits so the game stays in step.0 s",
  ]);
});

function network(gameTic: number, lagging = 0): NetworkState {
  return {
    connected: true,
    waitingPlayers: 2,
    playersInGame: 2,
    gameTic,
    consolePlayer: 0,
    scores: [1, 2].map((peer, slot) => ({
      slot,
      peer,
      frags: 0,
      deaths: 0,
      kills: 0,
      items: 0,
      secrets: 0,
      x: 0,
      y: 0,
    })),
    lagging,
  };
}

function coopSession(role: CoopSession["role"]): CoopSession {
  return {
    role,
    peer: role === "host" ? 1 : 2,
    mode: "coop",
    skill: "medium",
    wad: new Uint8Array(),
    send: () => {},
    listen: () => {},
    players: () => 2,
    roster: () => [
      { peer: 1, name: "Host", ready: true, progress: 1, ping: null },
      { peer: 2, name: "Guest", ready: true, progress: 1, ping: 20 },
    ],
    announceStall: () => {},
    listenStall: () => {},
    onServerReady: () => {},
  };
}

async function renderCoop(role: CoopSession["role"]) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  React.act(() =>
    root?.render(
      <GameView
        map={testMap}
        title="Test"
        slot="MAP01"
        par={null}
        intertext="The end."
        coop={coopSession(role)}
        onExit={() => {}}
      />,
    ),
  );
  await React.act(async () => {
    await vi.waitFor(() => expect(options).not.toBeNull());
  });
  return defined(options);
}

function report(client: ClientOptions, next: GameStatus, state: NetworkState) {
  React.act(() => {
    client.network?.onState(state);
    client.onStatus(next);
  });
}

function waitingText() {
  return [...document.querySelectorAll("[role=status]")]
    .map((element) => element.textContent)
    .filter((text) => text?.startsWith("Waiting for"));
}
