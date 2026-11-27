import { applyPatch, diffMaps, type MapPatch } from "@rooms/map-patch";
import { describe, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";

import { updateSector } from "@/lib/map/edit";
import { testMap } from "@/lib/map/test-map";

import { joinLiveMap } from "./mcp-live";
import { createMcpServer } from "./mcp-server";

const secret = "ab".repeat(24);
const editLink = `https://wadsmith.test/shared/abcdefgh12345678#${secret}`;

describe("an MCP server on an online map's live link", () => {
  it("edits the map with everyone else on the link", async () => {
    const rooms = fakeRooms({ ...testMap, name: "Shared" });
    const live = await joinLiveMap({
      editLink,
      roomsUrl: "ws://rooms.test",
      name: "Agent",
      connect: rooms.connect,
    });
    expect(rooms.urls).toEqual(["ws://rooms.test/maps/abcdefgh12345678/live"]);
    const server = createMcpServer({ files: noFiles, store: live.store });
    expect(server.map().name).toBe("Shared");

    call(server, "updateRoom", { room: "Arena", light: 96 });
    await settle();
    expect(rooms.map.sectors[2].light).toBe(96);
    // The others see the agent's pointer where it worked.
    expect(rooms.cursors.at(-1)).toMatchObject({ x: expect.any(Number) });

    rooms.edit((map) => updateSector(map, "sector-1", { light: 40 }));
    await settle();
    expect(server.map().sectors[0].light).toBe(40);
    expect(server.map().sectors[2].light).toBe(96);

    call(server, "setMapDetails", { name: "Renamed" });
    await settle();
    expect(rooms.map.name).toBe("Renamed");

    rooms.refuse("missing-corners");
    call(server, "updateRoom", { room: "Arena", light: 200 });
    await settle();
    expect(server.map().sectors[2].light).toBe(96);
    expect(call(server, "listRooms")).toMatch(/taken back/);
    await live.close();
  });

  it("refuses a link that isn't an edit link, or that the server turns away", async () => {
    await expect(
      joinLiveMap({
        editLink: "https://wadsmith.test/shared/abcdefgh12345678",
        roomsUrl: "ws://rooms.test",
        name: "Agent",
        connect: fakeRooms(testMap).connect,
      }),
    ).rejects.toThrow(/isn't an edit link/);
    const rooms = fakeRooms(testMap, { secret: "cd".repeat(24) });
    await expect(
      joinLiveMap({
        editLink,
        roomsUrl: "ws://rooms.test",
        name: "Agent",
        connect: rooms.connect,
      }),
    ).rejects.toThrow(/refused the edit link/);
  });
});

const noFiles = {
  read: () => {
    throw new Error("No files.");
  },
  write: () => {},
};

function call(
  server: ReturnType<typeof createMcpServer>,
  name: string,
  args: object = {},
) {
  const reply = server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  }) as unknown as { result: { content: { text: string }[] } };
  return reply.result.content[0].text;
}

const settle = () => new Promise((done) => setTimeout(done, 0));

function fakeRooms(start: GameMap, { secret: accepted = secret } = {}) {
  let map = start;
  let revision = 1;
  let refusing = "";
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const cursors: unknown[] = [];

  class FakeSocket extends EventTarget {
    readyState: number = WebSocket.CONNECTING;
    client = "";
    send(text: string) {
      const data = JSON.parse(text) as Record<string, unknown>;
      queueMicrotask(() => hear(this, data));
    }
    close(code = 1000) {
      if (this.readyState === WebSocket.CLOSED) return;
      this.readyState = WebSocket.CLOSED;
      this.dispatchEvent(Object.assign(new Event("close"), { code }));
    }
    tell(message: object) {
      this.dispatchEvent(
        Object.assign(new Event("message"), { data: JSON.stringify(message) }),
      );
    }
  }

  const broadcast = (patch: MapPatch, extra: object) => {
    map = applyPatch(map, patch);
    revision += 1;
    for (const socket of sockets) {
      socket.tell({ type: "patch", patch, revision, ...extra });
    }
  };

  const hear = (from: FakeSocket, data: Record<string, unknown>) => {
    if (data.type === "hello") {
      if (data.secret !== accepted) {
        from.close(4003);
        return;
      }
      from.client = String(data.client);
      sockets.push(from);
      from.tell({ type: "welcome", peer: 1, revision, map, peers: [] });
    } else if (data.type === "patch") {
      if (refusing) {
        from.tell({ type: "refused", id: data.id, error: refusing });
        refusing = "";
        return;
      }
      broadcast(data.patch as MapPatch, {
        peer: 1,
        client: from.client,
        id: data.id,
      });
    } else if (data.type === "cursor") {
      cursors.push({ x: data.x, y: data.y });
    }
  };

  return {
    urls,
    cursors,
    get map() {
      return map;
    },
    connect: (url: string) => {
      urls.push(url);
      const socket = new FakeSocket();
      queueMicrotask(() => {
        socket.readyState = WebSocket.OPEN;
        socket.dispatchEvent(new Event("open"));
      });
      return socket as unknown as WebSocket;
    },
    // Someone else on the link edits the map.
    edit: (change: (map: GameMap) => GameMap) => {
      broadcast(diffMaps(map, change(map)), {
        peer: 2,
        client: "other",
        id: 1,
      });
    },
    refuse: (reason: string) => {
      refusing = reason;
    },
  };
}
