import { applyPatch, type MapPatch } from "@rooms/map-patch";
import { describe, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";

import { updateSector, updateThing } from "@/lib/map/edit";
import { testMap } from "@/lib/map/test-map";

import { type LivePeer, liveUrl, openLiveMap } from "./live";

describe("live editing in the browser", () => {
  it("brings two editors' edits together", () => {
    const server = fakeServer(testMap);
    const ana = server.join("Ana");
    const bo = server.join("Bo");
    server.run();
    ana.edit((map) => updateThing(map, "imp-1", { x: 800 }));
    bo.edit((map) => updateSector(map, "sector-3", { light: 90 }));
    server.run();
    for (const editor of [ana, bo]) {
      expect(editor.map.things[3].x).toBe(800);
      expect(editor.map.sectors[2].light).toBe(90);
    }
    expect(ana.map).toEqual(server.map);
    expect(ana.live.idle).toBe(true);
    expect(ana.seen.idle.at(-1)).toBe(3);
  });

  it("ends up the same when two editors change one thing at once", () => {
    const server = fakeServer(testMap);
    const ana = server.join("Ana");
    const bo = server.join("Bo");
    server.run();
    // Both edit the imp before either hears of the other's edit. The server
    // takes Ana's first, so Bo's wins.
    ana.edit((map) => updateThing(map, "imp-1", { x: 100 }));
    bo.edit((map) => updateThing(map, "imp-1", { x: 200 }));
    server.run();
    expect(server.map.things[3].x).toBe(200);
    expect(ana.map.things[3].x).toBe(200);
    expect(bo.map.things[3].x).toBe(200);
  });

  it("sends only one's own edit after taking someone else's", () => {
    const server = fakeServer(testMap);
    const ana = server.join("Ana");
    const bo = server.join("Bo");
    server.run();
    bo.edit((map) => updateSector(map, "sector-1", { light: 10 }));
    server.run();
    expect(ana.map.sectors[0].light).toBe(10);
    ana.edit((map) => updateThing(map, "imp-1", { x: 5 }));
    server.run();
    expect(server.patches.at(-1)).toEqual({
      merge: { things: { "imp-1": { x: 5 } } },
    });
    // Nothing more to send once the map is what it was sent as.
    expect(ana.live.send(ana.map)).toBe(false);
  });

  it("holds edits made before the server welcomes the link", () => {
    const server = fakeServer(testMap);
    const ana = server.join("Ana");
    // The hello is still queued at the server when Ana edits.
    ana.edit((map) => updateThing(map, "imp-1", { x: 9 }));
    server.run();
    // The edit went out after the welcome, so the server took it.
    expect(server.patches).toHaveLength(1);
    expect(server.map.things[3].x).toBe(9);
    expect(ana.live.idle).toBe(true);
  });

  it("passes pointers on to the others", async () => {
    const server = fakeServer(testMap);
    const ana = server.join("Ana");
    const bo = server.join("Bo");
    server.run();
    expect(ana.seen.peers).toEqual([{ peer: 2, name: "Bo", at: null }]);
    expect(bo.seen.peers).toEqual([{ peer: 1, name: "", at: null }]);
    ana.live.cursor({ x: 3, y: 4 });
    await new Promise((done) => setTimeout(done, 150));
    server.run();
    expect(bo.seen.peers[0].at).toEqual({ x: 3, y: 4 });
  });

  it("reaches a map's live address", () => {
    expect(liveUrl("https://rooms.example.com", "abc")).toBe(
      "wss://rooms.example.com/maps/abc/live",
    );
    expect(liveUrl("http://localhost:8787", "abc")).toBe(
      "ws://localhost:8787/maps/abc/live",
    );
  });
});

// Stands in for a map's Durable Object: it applies patches in the order it
// takes them off its queue and hands each to every editor.
function fakeServer(start: GameMap) {
  let map = start;
  let revision = 1;
  const sockets: FakeSocket[] = [];
  const queue: [FakeSocket, Record<string, unknown>][] = [];
  const patches: MapPatch[] = [];

  class FakeSocket extends EventTarget {
    readyState: number = WebSocket.OPEN;
    peer = 0;
    send(text: string) {
      queue.push([this, JSON.parse(text) as Record<string, unknown>]);
    }
    close() {
      this.readyState = WebSocket.CLOSED;
      this.dispatchEvent(Object.assign(new Event("close"), { code: 1000 }));
    }
    hear(message: object) {
      this.dispatchEvent(
        Object.assign(new Event("message"), { data: JSON.stringify(message) }),
      );
    }
  }

  // Delivers queued messages one at a time, like a server's input gate.
  const run = () => {
    while (queue.length > 0) {
      const [from, data] = queue.shift() as [
        FakeSocket,
        Record<string, unknown>,
      ];
      if (data.type === "hello") {
        from.peer = sockets.length + 1;
        const peers = sockets.map((socket) => ({
          peer: socket.peer,
          name: "",
        }));
        for (const socket of sockets) {
          socket.hear({ type: "join", peer: from.peer, name: data.name });
        }
        sockets.push(from);
        from.hear({ type: "welcome", peer: from.peer, revision, peers });
      } else if (data.type === "patch") {
        patches.push(data.patch as MapPatch);
        map = applyPatch(map, data.patch as MapPatch);
        revision += 1;
        for (const socket of sockets) {
          socket.hear({ ...data, revision, peer: from.peer });
        }
      } else if (data.type === "cursor") {
        for (const socket of sockets) {
          if (socket !== from) {
            socket.hear({
              type: "cursor",
              peer: from.peer,
              at: { x: data.x, y: data.y },
            });
          }
        }
      }
    }
  };

  const join = (name: string) => {
    const socket = new FakeSocket();
    let local = start;
    const seen: { peers: LivePeer[]; idle: number[] } = { peers: [], idle: [] };
    const live = openLiveMap({
      url: "ws://rooms.test/maps/x/live",
      secret: "s",
      name,
      map: start,
      connect: () => socket as unknown as WebSocket,
      onRemote: (patch) => {
        local = applyPatch(local, patch);
      },
      onReload: () => {},
      onPeers: (peers) => {
        seen.peers = peers.map((peer) => ({ ...peer }));
      },
      onIdle: (at) => seen.idle.push(at),
      onClosed: () => {},
    });
    socket.dispatchEvent(new Event("open"));
    return {
      live,
      seen,
      edit(change: (map: GameMap) => GameMap) {
        local = change(local);
        live.send(local);
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
    get map() {
      return map;
    },
  };
}
