import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";

import { defined } from "@/lib/defined";
import { addThing } from "@/lib/map/edit";
import { featuredMaps } from "@/lib/map/featured";
import { testMap } from "@/lib/map/test-map";
import { compileMap } from "@/lib/wad/compile";

import { NetInbox } from "./net-inbox";
import { doomKeys } from "./runtime";
import { RunRecorder } from "./trail";

const engineDirectory = resolve(import.meta.dirname, "../../../public/engine");
const ready = existsSync(resolve(engineDirectory, "woof.js"));
const hostPeer = 1;
const guestPeer = 2;

interface Snapshot {
  connected: boolean;
  waitingPlayers: number;
  playersInGame: number;
  consolePlayer: number;
  inLevel: boolean;
  frags: number;
  kills: number;
  gameTic: number;
  players: { x: number; y: number }[];
  scores: { slot: number; peer: number; frags: number; kills: number }[];
  // The trail events since the last snapshot.
  trail: number[];
}

const workers: Worker[] = [];

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
});

const deathmatchSpots = [
  { x: 64, y: 64 },
  { x: 320, y: 64 },
  { x: 640, y: 64 },
  { x: 832, y: 320 },
];
const deathmatchMap: GameMap = deathmatchSpots.reduce(
  (map, spot) => addThing(map, "deathmatch-start", spot).map,
  testMap,
);

const threePlayerMap = addThing(
  addThing(testMap, "player-2", { x: 96, y: 256 }).map,
  "player-3",
  { x: 160, y: 256 },
).map;

const deathmatchCases: [string, GameMap][] = [
  ["the test map", deathmatchMap],
  ...featuredMaps
    .filter((entry) => entry.mode === "deathmatch")
    .map((entry): [string, GameMap] => [entry.title, entry.map]),
];

describe.skipIf(!ready)("network game through shared memory", () => {
  it("starts co-op for a host and a guest and keeps them in step", async () => {
    const room = createRoom();
    const host = room.join(hostPeer, "host");
    const guest = room.join(guestPeer, "guest");

    await waitFor(host.query, (state) => state.waitingPlayers === 2);
    expect(await guest.launch()).toBe(false);
    expect(await host.launch()).toBe(true);

    const bothIn = async () => {
      const [a, b] = await Promise.all([host.query(), guest.query()]);
      return a && b ? [a, b] : null;
    };
    const started = await waitFor(bothIn, ([a, b]) => a.inLevel && b.inLevel);
    expect(started?.[0]).toMatchObject({ playersInGame: 2, consolePlayer: 0 });
    expect(started?.[1]).toMatchObject({ playersInGame: 2, consolePlayer: 1 });
    for (const snapshot of defined(started)) {
      expect(snapshot.scores.map(({ slot, peer }) => [slot, peer])).toEqual([
        [0, hostPeer],
        [1, guestPeer],
      ]);
    }

    const startX = defined(started)[0].players[1].x;
    guest.key(true, doomKeys.up);
    await waitFor(host.query, (state) => state.players[1].x > startX + 64);
    guest.key(false, doomKeys.up);

    // The host's engine runs both players, so its trail holds the guest's
    // path too.
    const recorder = new RunRecorder();
    recorder.add(Int32Array.from(host.trail()));
    const run = recorder.run();
    expect(run?.players).toEqual([0, 1]);
    const walked = run?.paths.findLast((path) => path.player === 1);
    expect(walked?.points.at(-2)).toBeGreaterThan(startX + 32);

    await waitFor(
      bothIn,
      ([a, b]) =>
        a.players[1].x === b.players[1].x && a.players[1].y === b.players[1].y,
    );
  }, 60_000);

  it("gives game slots in peer order whatever order the guests join in", async () => {
    const room = createRoom(threePlayerMap);
    const host = room.join(hostPeer, "host");
    const late = room.join(3, "guest");
    await waitFor(host.query, (state) => state.waitingPlayers === 2);
    const early = room.join(guestPeer, "guest");
    await waitFor(host.query, (state) => state.waitingPlayers === 3);
    expect(await host.launch()).toBe(true);

    const allIn = async () => {
      const states = await Promise.all([
        host.query(),
        early.query(),
        late.query(),
      ]);
      return states.every(Boolean) ? states : null;
    };
    const started = await waitFor(allIn, (states) =>
      states.every((state) => state.inLevel),
    );
    expect(started.map((state) => state.consolePlayer)).toEqual([0, 1, 2]);
    expect(
      defined(started[0]).scores.map(({ slot, peer }) => [slot, peer]),
    ).toEqual([
      [0, hostPeer],
      [1, guestPeer],
      [2, 3],
    ]);
  }, 60_000);

  it("counts the host's kills in the guest's status", async () => {
    const map = addThing(coopMap, "zombieman", { x: 224, y: 160 }).map;
    const room = createRoom(map);
    const host = room.join(hostPeer, "host");
    const guest = room.join(guestPeer, "guest");
    await waitFor(host.query, (state) => state.waitingPlayers === 2);
    expect(await host.launch()).toBe(true);
    await waitFor(guest.query, (state) => state.inLevel);

    host.key(true, doomKeys.fire);
    await waitFor(host.query, (state) => state.kills > 0);
    host.key(false, doomKeys.fire);

    const seen = await waitFor(guest.query, (state) =>
      state.scores.some((score) => score.slot === 0 && score.kills > 0),
    );
    expect(seen.kills).toBe(1);
  }, 60_000);

  it.each(deathmatchCases)(
    "starts a deathmatch on %s",
    async (_name, map) => {
      const spots = map.things.filter(
        (thing) => thing.kind === "deathmatch-start",
      );
      const room = createRoom(map, "deathmatch");
      const host = room.join(hostPeer, "host");
      const guest = room.join(guestPeer, "guest");
      await waitFor(host.query, (state) => state.waitingPlayers === 2);
      expect(await host.launch()).toBe(true);

      const bothIn = async () => {
        const [a, b] = await Promise.all([host.query(), guest.query()]);
        return a && b ? [a, b] : null;
      };
      const started = await waitFor(bothIn, ([a, b]) => a.inLevel && b.inLevel);
      expect(started?.[0]).toMatchObject({ playersInGame: 2, frags: 0 });
      const onSpot = ({ x, y }: { x: number; y: number }) =>
        spots.some((spot) => spot.x === x && spot.y === -y);
      expect(defined(started)[0].players.every(onSpot)).toBe(true);
      expect(defined(started)[1].players).toEqual(defined(started)[0].players);
    },
    60_000,
  );
});

const coopMap = addThing(testMap, "player-2", { x: 96, y: 256 }).map;

const relayDelayMs = 20;

// Stands in for the room: it forwards each packet to its peer after a delay.
function createRoom(map = coopMap, mode: "coop" | "deathmatch" = "coop") {
  const inboxes = new Map<number, NetInbox>();
  let nextId = 0;

  const join = (peer: number, role: "host" | "guest") => {
    const inbox = NetInbox.create();
    inboxes.set(peer, inbox);
    const worker = new Worker(new URL("./netgame.worker.ts", import.meta.url), {
      execArgv: ["--experimental-transform-types", "--no-warnings"],
      workerData: {
        role,
        mode,
        host: hostPeer,
        peer,
        inbox: inbox.buffer,
        map: compileMap(map),
        engineDirectory,
      },
    });
    workers.push(worker);
    const replies = new Map<number, (value: unknown) => void>();
    let exited = false;
    worker.on("exit", () => {
      exited = true;
      for (const reply of replies.values()) reply(new Error("Worker exited."));
      replies.clear();
    });
    worker.on("message", (message) => {
      if (message.type === "send") {
        setTimeout(
          () => inboxes.get(message.to)?.push(peer, message.data),
          relayDelayMs,
        );
      } else if (message.type === "reply") {
        replies.get(message.id)?.(message.value);
        replies.delete(message.id);
      }
    });
    const ask = <T>(type: "query" | "launch") =>
      new Promise<T>((done, fail) => {
        if (exited) return fail(new Error("Worker exited."));
        const id = (nextId += 1);
        replies.set(id, (value) =>
          value instanceof Error ? fail(value) : done(value as T),
        );
        worker.postMessage({ type, id });
      });
    const trail: number[] = [];
    return {
      query: async () => {
        const snapshot = await ask<Snapshot>("query");
        if (snapshot) trail.push(...snapshot.trail);
        return snapshot;
      },
      trail: () => trail,
      launch: () => ask<boolean>("launch"),
      key: (pressed: boolean, key: number) =>
        worker.postMessage({ type: "key", pressed, key }),
    };
  };

  return { join };
}

async function waitFor<T>(
  read: () => Promise<T | null>,
  done: (value: T) => boolean,
) {
  for (;;) {
    const value = await read();
    if (value !== null && done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
