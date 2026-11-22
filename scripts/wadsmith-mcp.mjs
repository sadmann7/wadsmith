// The wadsmith MCP server: lets an agent outside the page build a map with
// the editor's own actions, over standard input and output.
//   node --experimental-transform-types scripts/wadsmith-mcp.mjs [--map file]
// With --map, the file is opened when it exists and saved after every edit.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The app's modules import each other without extensions and through "@/",
// which the bundler resolves and Node doesn't.
registerHooks({
  resolve(specifier, context, next) {
    const target = specifier.startsWith("@/")
      ? pathToFileURL(resolve(root, "src", specifier.slice(2))).href
      : specifier;
    try {
      return next(target, context);
    } catch (error) {
      if (!target.startsWith(".") && !target.startsWith("file:")) throw error;
      return next(`${target}.ts`, context);
    }
  },
});

const { createMcpServer } = await import("@/lib/editor/mcp-server");
const { parseMapFile } = await import("@/lib/map/storage");

const flag = process.argv.indexOf("--map");
const autosave = flag > 0 ? process.argv[flag + 1] : undefined;
const files = {
  read: (path) => readFileSync(resolve(path), "utf8"),
  write: (path, data) => {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    writeFileSync(resolve(path), data);
  },
};
const server = createMcpServer({
  files,
  autosave,
  map:
    autosave && existsSync(resolve(autosave))
      ? parseMapFile(files.read(autosave))
      : undefined,
});

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error." },
    });
    continue;
  }
  const reply = server.handle(message);
  if (reply) send(reply);
}
