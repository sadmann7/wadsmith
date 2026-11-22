import { describe, expect, it } from "vitest";

import { parseMapFile } from "@/lib/map/storage";
import { testMap } from "@/lib/map/test-map";

import { agentActionNames } from "./agent-actions";
import { createMcpServer } from "./mcp-server";

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

  it("saves after every edit when given a file to keep", () => {
    const { call, disk } = start(testMap, "kept.json");
    expect(disk.has("kept.json")).toBe(false);
    call("listRooms");
    expect(disk.has("kept.json")).toBe(false);
    call("updateRoom", { room: "Arena", light: 96 });
    const kept = parseMapFile(disk.get("kept.json") as string);
    expect(kept.sectors[2].light).toBe(96);
  });
});

function start(map?: typeof testMap, autosave?: string) {
  const disk = new Map<string, string | Uint8Array>();
  const server = createMcpServer({
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
