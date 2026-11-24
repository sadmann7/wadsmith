// The wadsmith MCP server: lets an agent outside the page build a map with
// the editor's own actions, over standard input and output.
//   node --experimental-transform-types scripts/wadsmith-mcp.mjs [--map file]
//     [--mod file]...
// With --map, the file is opened when it exists and saved after every edit.
// Each --mod adds a WAD or DEHACKED patch whose numbered things the map can
// place, and a built WAD carries the ones it uses.
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
const { readWadAssets } = await import("@/lib/wad/assets");
const { defaultGame } = await import("@/lib/engine/game");
const { packWad } = await import("@/lib/wad/pack");
const { getIsWad } = await import("@/lib/wad/inspect");

const flag = process.argv.indexOf("--map");
const autosave = flag > 0 ? process.argv[flag + 1] : undefined;

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

// Freedoom's textures, once pnpm setup:engine has fetched it, so the map
// uses only names the game has.
const iwadPath = resolve(root, "public/engine/freedoom2.wad");
const iwad = existsSync(iwadPath)
  ? new Uint8Array(readFileSync(iwadPath))
  : undefined;

const modPaths = process.argv.flatMap((arg, index) =>
  arg === "--mod" ? [process.argv[index + 1]] : [],
);
// A mod's textures replace the game's own list, so a build needs the IWAD.
if (modPaths.length > 0 && !iwad) {
  fail("--mod needs Freedoom. Run pnpm setup:engine first.");
}
const mods = modPaths.map((path) => {
  if (!path || !existsSync(resolve(path))) fail(`--mod: no file ${path ?? ""}`);
  const data = new Uint8Array(readFileSync(resolve(path)));
  if (/\.(deh|bex)$/i.test(path)) {
    return packWad([{ name: "DEHACKED", data }]);
  }
  if (!getIsWad(data)) fail(`--mod: ${path} isn't a WAD or DEHACKED patch.`);
  return data;
});
const context = iwad
  ? { game: defaultGame, names: readWadAssets(iwad, mods).names }
  : {};
const textures =
  iwad && mods.length > 0 ? { iwad, resources: mods } : undefined;
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
  context,
  textures,
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
