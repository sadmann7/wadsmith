import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";

const folders = [];
const servers = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.kill();
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

describe("the wadsmith MCP server over standard input and output", () => {
  it("builds a map from tool calls and writes it as a map file and a WAD", async () => {
    const { folder, ask, call } = connect(["--map", "kept/map.json"]);
    const hello = await ask("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(hello.result.serverInfo.name).toBe("wadsmith");
    const { tools } = (await ask("tools/list")).result;
    expect(tools.length).toBeGreaterThan(30);

    // What an agent might do for "a start room, a door and an arena with an
    // imp, and an exit switch at the far end".
    const start = await call("addRoom", {
      corners: [
        { x: 0, y: 0 },
        { x: 256, y: 0 },
        { x: 256, y: 256 },
        { x: 0, y: 256 },
      ],
      name: "Start",
    });
    expect(start.todo).toEqual(["Place a player start."]);
    await call("addThing", { kind: "player", x: 64, y: 128 });
    const door = await call("addConnectedRoom", {
      room: "Start",
      side: "east",
      depth: 32,
    });
    await call("makeDoor", { room: door.result });
    const arena = await call("addConnectedRoom", {
      room: door.result,
      side: "east",
      depth: 384,
    });
    await call("updateRoom", {
      room: arena.result,
      name: "Arena",
      ceiling: 192,
    });
    await call("placeThing", { kind: "imp", room: "Arena", angle: 180 });
    const room = await call("describeRoom", { room: "Arena" });
    const { walls, box } = room;
    const corners = Object.fromEntries(
      room.corners.map((item) => [item.id, item]),
    );
    const far = walls.find(({ wall, opensOnto }) => {
      const [a, b] = wall.split("|").map((corner) => corners[corner]);
      return !opensOnto && a.x === box.right && b.x === box.right;
    });
    await call("setLineAction", {
      wall: far.wall,
      kind: "exit",
      trigger: "switch",
    });
    await expect(
      call("addThing", { kind: "imp", x: 5000, y: 5000 }),
    ).rejects.toThrow("outside every room");

    const check = await call("checkMap");
    expect(check.errors).toEqual([]);
    expect(await call("exportWad", { path: "agent.wad" })).toMatch(
      /^Built agent\.wad/,
    );
    const wad = readFileSync(join(folder, "agent.wad"));
    expect(wad.subarray(0, 4).toString()).toBe("PWAD");
    // The map file was kept up to date on the way.
    const kept = JSON.parse(
      readFileSync(join(folder, "kept/map.json"), "utf8"),
    );
    expect(JSON.stringify(kept)).toContain("Arena");
  }, 30_000);
});

const script = resolve(import.meta.dirname, "wadsmith-mcp.mjs");

// Starts the server the way an MCP client does and talks to it in lines.
function connect(args = []) {
  const folder = mkdtempSync(join(tmpdir(), "wadsmith-mcp-"));
  folders.push(folder);
  const server = spawn(
    process.execPath,
    ["--experimental-transform-types", "--no-warnings", script, ...args],
    { cwd: folder, stdio: ["pipe", "pipe", "inherit"] },
  );
  servers.push(server);
  const waiting = new Map();
  createInterface({ input: server.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  });
  let id = 0;
  const ask = (method, params) =>
    new Promise((done) => {
      id += 1;
      waiting.set(id, done);
      server.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  const call = async (name, args = {}) => {
    const { result } = await ask("tools/call", { name, arguments: args });
    const text = result.content[0].text;
    if (result.isError) throw new Error(text);
    return text.startsWith("{") || text.startsWith("[")
      ? JSON.parse(text)
      : text;
  };
  return { folder, ask, call };
}
