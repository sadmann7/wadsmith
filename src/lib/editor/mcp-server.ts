import type { GameMap } from "@/lib/map/types";

import { parseMapFile, serializeMap } from "@/lib/map/storage";
import { type CheckContext, doorDepth, validateMap } from "@/lib/map/validate";
import { compileMap } from "@/lib/wad/compile";

import {
  agentActions,
  agentInputSchema,
  type AgentParam,
  runAgentAction,
} from "./agent-actions";

// How the server reaches the disk, so tests can stand in for it.
export interface McpFiles {
  read: (path: string) => string;
  write: (path: string, data: string | Uint8Array) => void;
}

export interface McpServerOptions {
  files: McpFiles;
  map?: GameMap;
  // The game the map is for and its texture names, checked on every edit.
  context?: CheckContext;
  // A file the map is written to after every edit.
  autosave?: string;
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

const fileTools = [
  {
    name: "newMap",
    description: "Starts over with an empty map.",
    params: [],
  },
  {
    name: "openMap",
    description: "Loads a map file saved by Wadsmith in place of this one.",
    params: [path],
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
  context = {},
}: McpServerOptions) {
  let current = map ?? blankMap;

  const change = (next: GameMap) => {
    current = next;
    if (autosave) files.write(autosave, serializeMap(next));
  };

  const fileTool = (name: string, args: Record<string, unknown>) => {
    if (name === "newMap") {
      change(blankMap);
      return "Started an empty map.";
    }
    const target = args.path;
    if (typeof target !== "string" || !target.trim()) {
      throw new Error(`${name} needs "path": ${path.description}`);
    }
    if (name === "openMap") {
      change(parseMapFile(files.read(target)));
      return `Opened ${target}: ${current.sectors.length} rooms and ${current.things.length} things.`;
    }
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
    const wad = compileMap(current);
    files.write(target, wad);
    return `Built ${target}, ${wad.length} bytes. It plays as MAP01.`;
  };

  const call = (name: string, args: Record<string, unknown>) => {
    if (fileTools.some((tool) => tool.name === name)) {
      return fileTool(name, args);
    }
    const before = current;
    const { map: next, ...outcome } = runAgentAction(
      before,
      name,
      args,
      context,
    );
    if (next === before) return outcome.result;
    change(next);
    return outcome;
  };

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
      return { content: [{ type: "text", text: textOf(call(name, args)) }] };
    } catch (error) {
      // A refused edit is the tool's answer, not a failure of the protocol.
      return {
        content: [{ type: "text", text: (error as Error).message }],
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

  return { handle, map: () => current };
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

function textOf(value: unknown) {
  return typeof value === "string"
    ? value
    : JSON.stringify(value ?? null, null, 2);
}

function getIsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
