import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";

import { afterEach, describe, expect, it } from "vitest";

import { addThing } from "@/map/edit";
import { featuredMaps } from "@/map/featured";
import type { GameMap } from "@/map/types";
import { testMap } from "@/map/test-map";
import { compileMap } from "@/wad/compile";
import { NetInbox } from "./net-inbox";
import { doomKeys } from "./runtime";

const engineDirectory = resolve(import.meta.dirname, "../../public/engine");
const ready = existsSync(resolve(engineDirectory, "woof.js"));
const hostPeer = 1;
const guestPeer = 2;
const relayDelayMs = 20;

interface Snapshot {
  connected: boolean;
  waitingPlayers: number;
  playersInGame: number;
  consolePlayer: number;
  inLevel: boolean;
  frags: number;
  gameTic: number;
  players: { x: number; y: number }[];
  scores: { slot: number; peer: number; frags: number; kills: number }[];
}

const workers: Worker[] = [];

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
});

const coopMap = addThing(testMap, "player-2", { x: 96, y: 256 }).map;
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

const deathmatchCases: [string, GameMap][] = [
  ["the test map", deathmatchMap],
  ...featuredMaps
    .filter((entry) => entry.mode === "deathmatch")
    .map((entry): [string, GameMap] => [entry.title, entry.map]),
];

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
    const ask = <T>(type: "query" | "launch", ms = 1000) =>
      new Promise<T | null>((done) => {
        const id = (nextId += 1);
        replies.set(id, (value) => done(value as T));
        worker.postMessage({ type, id });
        setTimeout(() => done(null), ms);
      });
    return {
      query: () => ask<Snapshot>("query"),
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
  ms: number,
) {
  const end = performance.now() + ms;
  let last: T | null = null;
  while (performance.now() < end) {
    last = await read();
    if (last !== null && done(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return last;
}

describe.skipIf(!ready)("network game through shared memory", () => {
  it("starts co-op for a host and a guest and keeps them in step", async () => {
    const room = createRoom();
    const host = room.join(hostPeer, "host");
    const guest = room.join(guestPeer, "guest");

    const waiting = await waitFor(
      host.query,
      (state) => state.waitingPlayers === 2,
      15_000,
    );
    expect(waiting?.waitingPlayers).toBe(2);
    expect(await guest.launch()).toBe(false);
    expect(await host.launch()).toBe(true);

    const bothIn = async () => {
      const [a, b] = await Promise.all([host.query(), guest.query()]);
      return a && b ? [a, b] : null;
    };
    const started = await waitFor(
      bothIn,
      ([a, b]) => a.inLevel && b.inLevel,
      15_000,
    );
    expect(started?.[0]).toMatchObject({ playersInGame: 2, consolePlayer: 0 });
    expect(started?.[1]).toMatchObject({ playersInGame: 2, consolePlayer: 1 });
    for (const snapshot of started!) {
      expect(snapshot.scores.map(({ slot, peer }) => [slot, peer])).toEqual([
        [0, hostPeer],
        [1, guestPeer],
      ]);
    }

    const startX = started![0].players[1].x;
    guest.key(true, doomKeys.up);
    const moved = await waitFor(
      host.query,
      (state) => state.players[1].x > startX + 64,
      10_000,
    );
    guest.key(false, doomKeys.up);
    expect(moved?.players[1].x).toBeGreaterThan(startX + 64);

    const agreed = await waitFor(
      bothIn,
      ([a, b]) =>
        a.players[1].x === b.players[1].x && a.players[1].y === b.players[1].y,
      5_000,
    );
    expect(agreed).not.toBeNull();
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
      await waitFor(host.query, (state) => state.waitingPlayers === 2, 15_000);
      expect(await host.launch()).toBe(true);

      const bothIn = async () => {
        const [a, b] = await Promise.all([host.query(), guest.query()]);
        return a && b ? [a, b] : null;
      };
      const started = await waitFor(
        bothIn,
        ([a, b]) => a.inLevel && b.inLevel,
        15_000,
      );
      expect(started?.[0]).toMatchObject({ playersInGame: 2, frags: 0 });
      const onSpot = ({ x, y }: { x: number; y: number }) =>
        spots.some((spot) => spot.x === x && spot.y === -y);
      expect(started![0].players.every(onSpot)).toBe(true);
      expect(started![1].players).toEqual(started![0].players);
    },
    60_000,
  );
});
