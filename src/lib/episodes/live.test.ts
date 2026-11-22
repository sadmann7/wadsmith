import { applyPatch, type MapPatch } from "@rooms/map-patch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameMap } from "@/lib/map/types";

import { updateSector, updateThing } from "@/lib/map/edit";
import { testMap } from "@/lib/map/test-map";

import { type LivePeer, liveUrl, openLiveMap } from "./live";

const settle = () => new Promise((done) => setTimeout(done, 0));
const strip = ({ name: _, ...map }: GameMap) => map;

describe("live editing in the browser", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const ready = async (server: ReturnType<typeof fakeServer>) => {
    await Promise.resolve();
    server.run();
  };

  it("brings two editors' edits together", async () => {
    const server = fakeServer(testMap);
    const ana = server.join("Ana");
    const bo = server.join("Bo");
    await ready(server);
    ana.edit((map) => updateThing(map, "imp-1", { x: 800 }));
    bo.edit((map) => updateSector(map, "sector-3", { light: 90 }));
    server.run();
    for (const editor of [ana, bo]) {
      expect(strip(editor.map)).toEqual(strip(server.map));
    }
    expect(server.map.things[3].x).toBe(800);
    expect(server.map.sectors[2].light).toBe(90);
    expect(ana.live.idle).toBe(true);
    expect(ana.seen.idle.at(-1)).toBe(3);
  });

  it("ends up as the server orders two edits to one field", async () => {
    const server = fakeServer(testMap);
    const ana = server.join("Ana");
    const bo = server.join("Bo");
    await ready(server);
    ana.edit((map) => updateThing(map, "imp-1", { x: 100 }));
    bo.edit((map) => updateThing(map, "imp-1", { x: 200 }));
    server.run();
    for (const map of [server.map, ana.map, bo.map]) {
      expect(map.things[3].x).toBe(200);
    }
  });

  it("keeps changes to different fields of one thing, and a removal", async () => {
    const server = fakeServer(testMap);
    const ana = server.join("Ana");
    const bo = server.join("Bo");
    await ready(server);
    ana.edit((map) => updateThing(map, "imp-1", { x: 300 }));
    bo.edit((map) => updateThing(map, "imp-1", { angle: 90 }));
    server.run();
    for (const map of [server.map, ana.map, bo.map]) {
      expect(map.things[3]).toMatchObject({ x: 300, angle: 90 });
    }
    ana.edit((map) => ({
      ...map,
      things: map.things.filter((thing) => thing.id !== "zombieman-1"),
    }));
    bo.edit((map) => updateThing(map, "zombieman-1", { x: 1 }));
    server.run();
    for (const map of [server.map, ana.map, bo.map]) {
      expect(map.things.some((thing) => thing.id === "zombieman-1")).toBe(
        false,
      );
    }
  });

  it("starts from the server's map when others edited before it joined", async () => {
    const server = fakeServer(testMap);
    const ana = server.join("Ana");
    await ready(server);
    // Bo read the map earlier, then Ana changed it before Bo's link opened.
    ana.edit((map) => updateSector(map, "sector-1", { light: 20 }));
    server.run();
    const bo = server.join("Bo", testMap);
    bo.edit((map) => updateThing(map, "imp-1", { angle: 45 }));
    await ready(server);
    for (const map of [server.map, ana.map, bo.map]) {
      expect(map.sectors[0].light).toBe(20);
      expect(map.things[3].angle).toBe(45);
    }
  });

  it("sends again after a drop what the server never got", async () => {
    const server = fakeServer(testMap);
    const ana = server.join("Ana");
    await ready(server);
    ana.edit((map) => updateThing(map, "imp-1", { x: 5 }));
    server.lose();
    ana.drop();
    expect(ana.live.idle).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    await ready(server);
    expect(server.map.things[3].x).toBe(5);
    expect(ana.live.idle).toBe(true);
  });

  it("doesn't put back an edit the server took before a drop", async () => {
    const server = fakeServer(testMap);
    const ana = server.join("Ana");
    const bo = server.join("Bo");
    await ready(server);
    // The server takes Ana's edit, but the drop loses its echo to her.
    ana.drop();
    ana.edit((map) => updateThing(map, "imp-1", { x: 5 }));
    await vi.advanceTimersByTimeAsync(1000);
    await ready(server);
    bo.edit((map) => updateThing(map, "imp-1", { x: 9 }));
    ana.edit((map) => updateSector(map, "sector-3", { light: 40 }));
    server.run();
    ana.drop();
    await vi.advanceTimersByTimeAsync(1000);
    await ready(server);
    for (const map of [server.map, ana.map, bo.map]) {
      expect(map.things[3].x).toBe(9);
      expect(map.sectors[2].light).toBe(40);
    }
  });

  it("keeps edits made while it reconnects, with others' edits to other fields", async () => {
    const server = fakeServer(testMap);
    const ana = server.join("Ana");
    const bo = server.join("Bo");
    await ready(server);
    ana.drop();
    ana.edit((map) => updateSector(map, "sector-3", { light: 30 }));
    bo.edit((map) => updateSector(map, "sector-3", { floor: 8 }));
    server.run();
    await vi.advanceTimersByTimeAsync(1000);
    await ready(server);
    for (const map of [server.map, ana.map, bo.map]) {
      expect(map.sectors[2]).toMatchObject({ light: 30, floor: 8 });
    }
  });

  it("renames the map for everyone, even across a drop", async () => {
    const server = fakeServer(testMap);
    const ana = server.join("Ana");
    const bo = server.join("Bo");
    await ready(server);
    ana.drop();
    ana.live.rename("Hangar");
    await vi.advanceTimersByTimeAsync(1000);
    await ready(server);
    expect(server.map.name).toBe("Hangar");
    expect(bo.map.name).toBe("Hangar");
  });

  it("takes back an edit the server turned away", async () => {
    const server = fakeServer(testMap);
    const ana = server.join("Ana");
    await ready(server);
    server.refuseWith("too-big");
    ana.edit((map) => updateThing(map, "imp-1", { x: 5 }));
    server.run();
    expect(ana.map.things[3].x).toBe(testMap.things[3].x);
    expect(ana.seen.dropped).toEqual(["too-big"]);
    expect(ana.live.idle).toBe(true);
  });

  it("passes pointers on to the others", async () => {
    vi.useRealTimers();
    const server = fakeServer(testMap);
    const ana = server.join("Ana");
    const bo = server.join("Bo");
    await ready(server);
    expect(ana.seen.peers).toEqual([{ peer: 2, name: "Bo", at: null }]);
    ana.live.cursor({ x: 3, y: 4 });
    await new Promise((done) => setTimeout(done, 150));
    server.run();
    expect(bo.seen.peers[0].at).toEqual({ x: 3, y: 4 });
    await settle();
  });

  it("reaches a map's live address", () => {
    expect(liveUrl("https://rooms.example.com", "abc")).toBe(
      "wss://rooms.example.com/maps/abc/live",
    );
  });
});

// Stands in for a map's Durable Object. It takes messages off a queue one at
// a time, like the real one's input gate, applies edits in that order, and
// skips an edit a browser sends again.
function fakeServer(start: GameMap) {
  let map = start;
  let revision = 1;
  const sockets: FakeSocket[] = [];
  const queue: [FakeSocket, Record<string, unknown>][] = [];
  const seen = new Map<string, number>();
  const patches: MapPatch[] = [];
  let refuse = "";

  class FakeSocket extends EventTarget {
    readyState: number = WebSocket.CONNECTING;
    peer = 0;
    client = "";
    send(text: string) {
      if (this.readyState !== WebSocket.OPEN) throw new Error("Not open.");
      queue.push([this, JSON.parse(text) as Record<string, unknown>]);
    }
    close(code = 1000) {
      if (this.readyState === WebSocket.CLOSED) return;
      this.readyState = WebSocket.CLOSED;
      const at = sockets.indexOf(this);
      if (at >= 0) sockets.splice(at, 1);
      this.dispatchEvent(Object.assign(new Event("close"), { code }));
    }
    hear(message: object) {
      this.dispatchEvent(
        Object.assign(new Event("message"), { data: JSON.stringify(message) }),
      );
    }
  }

  const run = () => {
    while (queue.length > 0) {
      const [from, data] = queue.shift() as [
        FakeSocket,
        Record<string, unknown>,
      ];
      if (from.readyState !== WebSocket.OPEN) continue;
      if (data.type === "hello") {
        from.peer = Math.max(0, ...sockets.map((socket) => socket.peer)) + 1;
        from.client = String(data.client);
        const peers = sockets.map((socket) => ({
          peer: socket.peer,
          name: "",
        }));
        for (const socket of sockets) {
          socket.hear({ type: "join", peer: from.peer, name: data.name });
        }
        sockets.push(from);
        from.hear({ type: "welcome", peer: from.peer, revision, map, peers });
      } else if (data.type === "patch") {
        const id = Number(data.id);
        if (refuse) {
          from.hear({ type: "refused", id, error: refuse });
          continue;
        }
        if (id <= (seen.get(from.client) ?? 0)) {
          from.hear({ type: "ack", id, revision });
          continue;
        }
        seen.set(from.client, id);
        patches.push(data.patch as MapPatch);
        map = applyPatch(map, data.patch as MapPatch);
        revision += 1;
        for (const socket of sockets) {
          socket.hear({
            ...data,
            revision,
            peer: from.peer,
            client: from.client,
          });
        }
      } else if (data.type === "cursor") {
        for (const socket of sockets) {
          if (socket === from) continue;
          socket.hear({
            type: "cursor",
            peer: from.peer,
            at: { x: data.x, y: data.y },
          });
        }
      }
    }
  };

  // A browser editing the map, with the map its editor shows.
  const join = (name: string, from = start) => {
    let local = from;
    let current: FakeSocket | null = null;
    const seenBy = {
      peers: [] as LivePeer[],
      idle: [] as number[],
      dropped: [] as string[],
    };
    const live = openLiveMap({
      url: "ws://rooms.test/maps/x/live",
      secret: "s",
      name,
      map: from,
      connect: () => {
        const socket = new FakeSocket();
        current = socket;
        // Opens on the next turn, like a real socket.
        queueMicrotask(() => {
          socket.readyState = WebSocket.OPEN;
          socket.dispatchEvent(new Event("open"));
        });
        return socket as unknown as WebSocket;
      },
      onChange: (patch) => {
        local = applyPatch(local, patch);
      },
      onPeers: (peers) => {
        seenBy.peers = peers.map((peer) => ({ ...peer }));
      },
      onIdle: (at) => seenBy.idle.push(at),
      onRefused: () => {},
      onConnected: () => {},
      onDropped: (reason) => seenBy.dropped.push(reason),
    });
    return {
      live,
      seen: seenBy,
      edit(change: (map: GameMap) => GameMap) {
        local = change(local);
        live.send(local);
      },
      drop() {
        current?.close(1006);
      },
      get map() {
        return local;
      },
    };
  };

  return {
    join,
    run,
    patches,
    refuseWith(reason: string) {
      refuse = reason;
    },
    // Drops everything waiting, as when a connection fails mid-flight.
    lose() {
      queue.length = 0;
    },
    get map() {
      return map;
    },
  };
}
