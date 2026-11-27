import { describe, expect, it } from "vitest";

import type { TextureSource } from "@/lib/wad/resources";

import { parseMapFile, serializeMap } from "@/lib/map/storage";
import { testMap } from "@/lib/map/test-map";
import { readLumps } from "@/lib/wad/inspect";
import { packWad } from "@/lib/wad/pack";

import { agentActionNames } from "./agent-actions";
import {
  createMcpServer,
  type McpServerOptions,
  memoryStore,
} from "./mcp-server";

describe("the wadsmith MCP server", () => {
  it("introduces itself and lists every action as a tool", () => {
    const { ask, server } = start();
    const hello = ask("initialize", { protocolVersion: "2025-03-26" });
    expect(hello.result).toMatchObject({
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "wadsmith" },
    });
    // A version the server doesn't know gets the newest it does.
    expect(
      ask("initialize", { protocolVersion: "1999-01-01" }).result,
    ).toMatchObject({ protocolVersion: "2025-06-18" });
    expect(
      server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }),
    ).toBeNull();
    expect(ask("ping").result).toEqual({});

    const tools = ask("tools/list").result?.tools as {
      name: string;
      inputSchema: { properties: object; required: string[] };
      annotations: { readOnlyHint: boolean };
    }[];
    expect(tools.map((tool) => tool.name)).toEqual([
      ...agentActionNames,
      "newMap",
      "openMap",
      "importMap",
      "saveMap",
      "exportWad",
    ]);
    const addRoom = tools.find((tool) => tool.name === "addRoom");
    expect(addRoom?.inputSchema.required).toEqual(["corners"]);
    expect(addRoom?.inputSchema.properties).toMatchObject({
      corners: { type: "array", items: { required: ["x", "y"] } },
      light: { type: "number" },
    });
    expect(addRoom?.annotations.readOnlyHint).toBe(false);
    expect(
      tools.find((tool) => tool.name === "checkMap")?.annotations.readOnlyHint,
    ).toBe(true);
  });

  it("runs edits on its map and answers with what happened", () => {
    const { call, server } = start(testMap);
    const added = call("placeThing", { kind: "medikit", room: "Arena" });
    expect(added.failed).toBe(false);
    expect(JSON.parse(added.text)).toEqual({
      result: "medikit-1",
      fixed: [],
      todo: [],
    });
    expect(server.map().things.at(-1)).toMatchObject({ kind: "medikit" });
    // A read answers with what it found, and leaves the map alone.
    const before = server.map();
    const rooms = JSON.parse(call("listRooms").text) as {
      items: { id: string }[];
    };
    expect(rooms.items.map((room) => room.id)).toEqual([
      "sector-1",
      "sector-2",
      "sector-3",
      "sector-4",
    ]);
    expect(server.map()).toBe(before);
  });

  it("answers a refused edit as the tool's error and keeps the map", () => {
    const { call, server, ask } = start(testMap);
    const refused = call("addThing", { kind: "imp", x: -900, y: -900 });
    expect(refused).toEqual({
      text: "-900, -900 is outside every room.",
      failed: true,
    });
    expect(server.map()).toBe(testMap);
    expect(call("teleport").text).toMatch(/No action "teleport"/);
    expect(ask("tools/call", { arguments: {} }).error).toMatchObject({
      code: -32602,
    });
    expect(ask("resources/list").error).toMatchObject({ code: -32601 });
    expect(server.handle({ id: 9, method: "ping" })).toMatchObject({
      error: { code: -32600 },
    });
    expect(server.handle("hello")).toMatchObject({ error: { code: -32600 } });
  });

  it("opens, saves and builds map files", () => {
    const { call, disk, server } = start(testMap);
    expect(call("saveMap", { path: "out/map.json" }).failed).toBe(false);
    expect(parseMapFile(disk.get("out/map.json") as string)).toEqual(testMap);
    expect(call("exportWad", { path: "out/map.wad" }).text).toMatch(
      /Built out\/map\.wad, \d+ bytes/,
    );
    const wad = disk.get("out/map.wad") as Uint8Array;
    expect(new TextDecoder().decode(wad.slice(0, 4))).toBe("PWAD");

    expect(call("newMap").text).toBe("Started an empty map.");
    expect(server.map().sectors).toEqual([]);
    // An empty map has errors, so it builds no WAD.
    const empty = call("exportWad", { path: "out/empty.wad" });
    expect(empty.failed).toBe(true);
    expect(empty.text).toMatch(/Draw at least one room/);
    expect(disk.has("out/empty.wad")).toBe(false);

    expect(call("openMap", { path: "out/map.json" }).text).toMatch(
      /4 rooms and 4 things/,
    );
    expect(server.map()).toEqual(testMap);
    expect(call("openMap", { path: "nowhere.json" }).failed).toBe(true);
    expect(call("saveMap").text).toMatch(/saveMap needs "path"/);
  });

  it("places a mod's things and builds its patch into the WAD", () => {
    const mod = packWad([
      {
        name: "DEHACKED",
        data: new TextEncoder().encode(
          "Thing 151 (Plasma Zombie)\nID # = 20001\nBits = COUNTKILL\n",
        ),
      },
    ]);
    const textures: TextureSource = { iwad: packWad([]), resources: [mod] };
    const { call, disk } = start(testMap, undefined, { textures });
    expect(
      call("placeThing", { kind: "custom", type: 20001, room: "Arena" }).failed,
    ).toBe(false);
    expect(call("listThings", { kind: "custom" }).text).toMatch(
      /"label": "Plasma Zombie"/,
    );
    expect(call("checkMap").text).not.toMatch(/custom-unknown/);
    call("exportWad", { path: "out/mod.wad" });
    const names = readLumps({
      name: "mod.wad",
      data: disk.get("out/mod.wad") as Uint8Array,
    }).map((lump) => lump.name);
    expect(names).toContain("DEHACKED");

    const bare = start(testMap);
    bare.call("placeThing", { kind: "custom", type: 20001, room: "Arena" });
    expect(bare.call("checkMap").text).toMatch(/custom-unknown:20001/);
  });

  it("saves after every edit when given a file to keep", () => {
    const { call, disk } = start(testMap, "kept.json");
    expect(disk.has("kept.json")).toBe(false);
    call("listRooms");
    expect(disk.has("kept.json")).toBe(false);
    call("updateRoom", { room: "Arena", light: 96 });
    const kept = parseMapFile(disk.get("kept.json") as string);
    expect(kept.sectors[2].light).toBe(96);
  });

  it("builds on another server's edits to a shared file", () => {
    const disk = new Map<string, string | Uint8Array>();
    const ana = start(testMap, "shared.json", {}, disk);
    const bo = start(undefined, "shared.json", {}, disk);
    ana.call("placeThing", { kind: "medikit", room: "Arena" });
    // Bo's server opened before the file existed, and still sees Ana's edit.
    const added = JSON.parse(
      bo.call("placeThing", { kind: "medikit", room: "Arena" }).text,
    ) as { result: string };
    expect(added.result).toBe("medikit-2");
    ana.call("updateRoom", { room: "Arena", light: 96 });
    const kept = parseMapFile(disk.get("shared.json") as string);
    expect(
      kept.things.filter((thing) => thing.kind === "medikit"),
    ).toHaveLength(2);
    expect(kept.sectors[2].light).toBe(96);
    expect(bo.server.map()).toEqual(kept);
  });

  it("imports another map file's rooms where they stand", () => {
    const { call, disk, server } = start(testMap);
    call("saveMap", { path: "part.json" });
    const imported = call("importMap", { path: "part.json", x: 2048 });
    expect(imported.failed).toBe(false);
    expect(JSON.parse(imported.text)).toMatchObject({
      result: "Added 4 rooms and 3 things.",
    });
    const map = server.map();
    expect(map.sectors).toHaveLength(8);
    expect(new Set(map.sectors.map((sector) => sector.id)).size).toBe(8);
    // The map keeps its own player start.
    expect(map.things.filter((thing) => thing.kind === "player")).toHaveLength(
      1,
    );
    const moved = map.things.at(-1);
    const source = testMap.things.at(-1);
    expect(moved?.x).toBe((source?.x ?? 0) + 2048);
    expect(call("importMap", { path: "nowhere.json" }).failed).toBe(true);
    disk.set(
      "empty.json",
      serializeMap({ vertices: {}, sectors: [], things: [], switches: [] }),
    );
    expect(call("importMap", { path: "empty.json" }).text).toBe(
      "That map is empty.",
    );
  });

  it("imports a part whose corners all meet rooms already there in place", () => {
    const doorway = { ...testMap.sectors[3], door: undefined };
    const base = {
      ...testMap,
      sectors: testMap.sectors.slice(0, 3),
      switches: [],
    };
    const part = {
      vertices: Object.fromEntries(
        doorway.vertices.map((id) => [id, testMap.vertices[id]]),
      ),
      sectors: [doorway],
      things: [],
      switches: [],
    };
    const { call, disk, server } = start(base);
    disk.set("doorway.json", serializeMap(part));
    expect(call("importMap", { path: "doorway.json" }).failed).toBe(false);
    const added = server.map().sectors.at(-1);
    expect(added?.vertices).toEqual(doorway.vertices);
  });

  it("asks before newMap or openMap erase a map others share", () => {
    const { call, server } = start(testMap, "shared.json");
    call("saveMap", { path: "copy.json" });
    expect(call("newMap").text).toMatch(/would erase their work/);
    expect(call("openMap", { path: "copy.json" }).failed).toBe(true);
    expect(server.map().sectors).toHaveLength(4);
    expect(call("newMap", { replace: true }).failed).toBe(false);
    expect(server.map().sectors).toHaveLength(0);
    expect(call("openMap", { path: "copy.json" }).failed).toBe(false);
  });

  it("passes on what its store has to say", () => {
    const notices = ["The live link dropped."];
    const { call } = start(undefined, undefined, {
      store: { ...memoryStore(testMap), notices: () => notices.splice(0) },
    });
    expect(call("listRooms").text).toMatch(/\n\nThe live link dropped\.$/);
    expect(call("listRooms").text).not.toMatch(/live link/);
  });
});

function start(
  map?: typeof testMap,
  autosave?: string,
  options: Partial<McpServerOptions> = {},
  disk = new Map<string, string | Uint8Array>(),
) {
  const server = createMcpServer({
    ...options,
    map,
    autosave,
    files: {
      read: (path) => {
        const data = disk.get(path);
        if (typeof data !== "string") throw new Error(`No file ${path}.`);
        return data;
      },
      write: (path, data) => disk.set(path, data),
    },
  });
  let id = 0;
  const ask = (method: string, params?: unknown) =>
    server.handle({ jsonrpc: "2.0", id: (id += 1), method, params }) as {
      result?: Record<string, unknown>;
      error?: { code: number; message: string };
    };
  const call = (name: string, args: object = {}) => {
    const { result } = ask("tools/call", { name, arguments: args });
    const content = (result?.content ?? []) as { text: string }[];
    return { text: content[0]?.text ?? "", failed: result?.isError === true };
  };
  return { server, disk, ask, call };
}
