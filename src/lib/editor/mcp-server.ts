import type { GameMap } from "@/lib/map/types";
import type { TextureSource } from "@/lib/wad/resources";

import { parseMapFile, serializeMap } from "@/lib/map/storage";
import { type CheckContext, doorDepth, validateMap } from "@/lib/map/validate";
import { compileMap } from "@/lib/wad/compile";
import { customThingsOf } from "@/lib/wad/custom-things";

import {
  agentActions,
  agentInputSchema,
  type AgentParam,
  importMapPart,
  runAgentAction,
} from "./agent-actions";

// How the server reaches the disk, so tests can stand in for it.
export interface McpFiles {
  read: (path: string) => string;
  write: (path: string, data: string | Uint8Array) => void;
  // Runs a read, edit and write of a file while no other server touches it.
  lock?: <T>(path: string, run: () => T) => T;
}

// Where the map lives between tool calls. Each call runs on the latest map
// and keeps what it returns, so servers sharing a file or an online map build
// on each other's edits.
export interface McpMapStore {
  update: <T>(step: (map: GameMap) => { map: GameMap; value: T }) => T;
  // What to pass on with the next answer, like an edit someone turned away.
  notices?: () => string[];
}

export interface McpServerOptions {
  files: McpFiles;
  map?: GameMap;
  // The game the map is for and its texture names, checked on every edit.
  context?: CheckContext;
  // The game's IWAD and the mods whose numbered things the map can place. A
  // built WAD carries the patches, sprites and sounds of the ones it uses.
  textures?: TextureSource;
  // A file the map is written to after every edit, and read again before
  // each call when another server changed it.
  autosave?: string;
  // Keeps the map somewhere else, like an online map's live link.
  store?: McpMapStore;
}

interface Request {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

const protocolVersions = ["2025-06-18", "2025-03-26", "2024-11-05"];
const methodNotFound = -32601;
const invalidRequest = -32600;
const invalidParams = -32602;

const instructions = [
  "Build a Doom map room by room, then save it for the Wadsmith editor or as a WAD.",
  "Coordinates are map units: x runs east and y runs south. A player is 32 wide and 56 tall, and climbs steps up to 24.",
  `Rooms that share a wall open onto each other. A door is a thin room, ${doorDepth.min} to ${doorDepth.max} deep, between two rooms, made with makeDoor.`,
  "Every map needs a player start (addThing with kind player) and an exit (setLineAction with kind exit on a solid wall, trigger switch).",
  "An edit that would break the map is refused and changes nothing. Each edit answers with what was fixed for you and what the map still needs.",
  "Start with describeMap, look names up with listCatalog, and finish with checkMap before saveMap or exportWad.",
].join(" ");

const path: AgentParam = {
  name: "path",
  type: "string",
  description: "A file path, from the folder the server runs in.",
};

const replace: AgentParam = {
  name: "replace",
  type: "boolean",
  description:
    "Needed when other agents or people share this map, as with a shared --map file or --live, since their work goes too. Prefer importMap to add a file.",
  optional: true,
};

const fileTools: { name: string; description: string; params: AgentParam[] }[] =
  [
    {
      name: "newMap",
      description: "Starts over with an empty map.",
      params: [replace],
    },
    {
      name: "openMap",
      description: "Loads a map file saved by Wadsmith in place of this one.",
      params: [path, replace],
    },
    {
      name: "importMap",
      description:
        "Adds the rooms, things and switches of another Wadsmith map file to this one, where they stand, as when several agents each built a part. Corners that meet join, and its player starts are left out when this map has its own.",
      params: [
        path,
        {
          name: "x",
          type: "number",
          description:
            "How far to move the imported part across. 0 when left out.",
          optional: true,
        },
        {
          name: "y",
          type: "number",
          description: "How far to move it down. 0 when left out.",
          optional: true,
        },
      ],
    },
    {
      name: "saveMap",
      description:
        "Saves the map as a file the Wadsmith editor opens with File, Open.",
      params: [path],
    },
    {
      name: "exportWad",
      description:
        "Builds the map into a WAD for any Doom engine. The map can't have errors.",
      params: [path],
    },
  ];

const blankMap: GameMap = {
  vertices: {},
  sectors: [],
  things: [],
  switches: [],
};

// A Model Context Protocol server that holds one map and offers every agent
// action as a tool, with tools to open, save and build the map as files. It
// answers one JSON-RPC message at a time and knows nothing of its transport.
export function createMcpServer({
  files,
  map,
  autosave,
  store: given,
  context: checks = {},
  textures,
}: McpServerOptions) {
  const context: CheckContext = {
    ...checks,
    custom: checks.custom ?? customThingsOf(textures?.resources ?? []),
  };
  const store =
    given ??
    (autosave
      ? fileStore(files, autosave, map ?? blankMap)
      : memoryStore(map ?? blankMap));
  const read = () =>
    store.update((current) => ({ map: current, value: current }));

  const fileTool = (name: string, args: Record<string, unknown>) => {
    if (
      (name === "newMap" || name === "openMap") &&
      (given || autosave) &&
      args.replace !== true &&
      getHasWork(read())
    ) {
      throw new Error(
        `This map is kept in a file or online that other agents or people may share, so ${name} would erase their work too. Call it with "replace": true to do it anyway, or use importMap to add a file.`,
      );
    }
    if (name === "newMap") {
      store.update(() => ({ map: blankMap, value: null }));
      return "Started an empty map.";
    }
    const target = args.path;
    if (typeof target !== "string" || !target.trim()) {
      throw new Error(`${name} needs "path": ${path.description}`);
    }
    if (name === "openMap") {
      const opened = parseMapFile(files.read(target));
      store.update(() => ({ map: opened, value: null }));
      return `Opened ${target}: ${opened.sectors.length} rooms and ${opened.things.length} things.`;
    }
    if (name === "importMap") {
      const part = parseMapFile(files.read(target));
      const offset = {
        x: typeof args.x === "number" ? args.x : 0,
        y: typeof args.y === "number" ? args.y : 0,
      };
      return store.update((current) => {
        const { map: next, ...outcome } = importMapPart(
          current,
          part,
          offset,
          context,
        );
        return { map: next, value: outcome };
      });
    }
    const current = read();
    if (name === "saveMap") {
      files.write(target, serializeMap(current));
      return `Saved the map to ${target}.`;
    }
    const errors = validateMap(current, context);
    if (errors.length > 0) {
      throw new Error(
        `The map has errors, so no WAD was built. ${errors.map((issue) => issue.message).join(" ")}`,
      );
    }
    const wad = compileMap(current, undefined, {}, textures);
    files.write(target, wad);
    return `Built ${target}, ${wad.length} bytes. It plays as MAP01.`;
  };

  const call = (name: string, args: Record<string, unknown>) => {
    if (fileTools.some((tool) => tool.name === name)) {
      return fileTool(name, args);
    }
    return store.update<unknown>((current) => {
      const { map: next, ...outcome } = runAgentAction(
        current,
        name,
        args,
        context,
      );
      return next === current
        ? { map: current, value: outcome.result }
        : { map: next, value: outcome };
    });
  };

  const notices = () => store.notices?.() ?? [];

  const answer = (method: string, params: unknown) => {
    if (method === "initialize") {
      const asked = getIsRecord(params) ? params.protocolVersion : undefined;
      return {
        protocolVersion: protocolVersions.includes(asked as string)
          ? asked
          : protocolVersions[0],
        capabilities: { tools: {} },
        serverInfo: { name: "wadsmith", version: "1.0.0" },
        instructions,
      };
    }
    if (method === "ping") return {};
    if (method === "tools/list") return { tools };
    if (method !== "tools/call") return undefined;
    const { name, arguments: args = {} } = getIsRecord(params) ? params : {};
    if (typeof name !== "string" || !getIsRecord(args)) {
      throw new RpcError(invalidParams, "A tool call needs a name.");
    }
    try {
      const text = textOf(call(name, args));
      return {
        content: [{ type: "text", text: withNotices(text, notices()) }],
      };
    } catch (error) {
      // A refused edit is the tool's answer, not a failure of the protocol.
      return {
        content: [
          {
            type: "text",
            text: withNotices((error as Error).message, notices()),
          },
        ],
        isError: true,
      };
    }
  };

  // The reply to a message, or null for a notification, which takes none.
  const handle = (message: unknown) => {
    const { jsonrpc, id, method, params }: Request = getIsRecord(message)
      ? message
      : {};
    const reply = (body: object) => ({
      jsonrpc: "2.0",
      id: id ?? null,
      ...body,
    });
    if (jsonrpc !== "2.0" || typeof method !== "string") {
      return reply({
        error: { code: invalidRequest, message: "Not a JSON-RPC 2.0 request." },
      });
    }
    if (id === undefined) return null;
    try {
      const result = answer(method, params);
      return result === undefined
        ? reply({
            error: { code: methodNotFound, message: `No method ${method}.` },
          })
        : reply({ result });
    } catch (error) {
      const code = error instanceof RpcError ? error.code : invalidParams;
      return reply({ error: { code, message: (error as Error).message } });
    }
  };

  return { handle, map: read };
}

export function memoryStore(start: GameMap): McpMapStore {
  let current = start;
  return {
    update(step) {
      const { map, value } = step(current);
      current = map;
      return value;
    },
  };
}

// A map file several servers can share. Each call reads the file again when
// another server wrote it since, and holds the file's lock until its edit is
// written, so no server's edit lands on a stale copy.
export function fileStore(
  files: McpFiles,
  file: string,
  start: GameMap,
): McpMapStore {
  let current = start;
  let known: string | null = null;
  const locked = files.lock ?? ((_: string, run) => run());
  return {
    update: (step) =>
      locked(file, () => {
        let text: string | null = null;
        try {
          text = files.read(file);
        } catch {
          text = null;
        }
        if (text !== null && text !== known) {
          current = parseMapFile(text);
          known = text;
        }
        const { map, value } = step(current);
        if (map !== current) {
          known = serializeMap(map);
          files.write(file, known);
          current = map;
        }
        return value;
      }),
  };
}

class RpcError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const tools = [
  ...agentActions.map(({ name, description, params, reads }) => ({
    name,
    description,
    inputSchema: agentInputSchema(params),
    annotations: { readOnlyHint: Boolean(reads) },
  })),
  ...fileTools.map(({ name, description, params }) => ({
    name,
    description,
    inputSchema: agentInputSchema(params),
    annotations: { readOnlyHint: false },
  })),
];

function getHasWork(map: GameMap) {
  return map.sectors.length > 0 || map.things.length > 0;
}

function withNotices(text: string, notices: string[]) {
  return notices.length > 0 ? [text, ...notices].join("\n\n") : text;
}

function textOf(value: unknown) {
  return typeof value === "string"
    ? value
    : JSON.stringify(value ?? null, null, 2);
}

function getIsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
