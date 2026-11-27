// The wadsmith MCP server: lets an agent outside the page build a map with
// the editor's own actions, over standard input and output.
//   node --experimental-transform-types scripts/wadsmith-mcp.mjs [--map file]
//     [--live edit-link [--rooms url] [--name name]] [--mod file]...
// With --map, the file is opened when it exists and saved after every edit.
// Several servers can share one file, each building on the others' edits.
// With --live, the server edits an online map through its edit link, live
// with everyone else who has it open. --rooms names the rooms server, or
// NEXT_PUBLIC_ROOMS_URL does. Each --mod adds a WAD or DEHACKED patch whose
// numbered things the map can place, and a built WAD carries the ones it uses.
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
      : specifier.startsWith("@rooms/")
        ? pathToFileURL(resolve(root, "rooms/src", specifier.slice(7))).href
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
const { joinLiveMap } = await import("@/lib/editor/mcp-live");
const { parseMapFile } = await import("@/lib/map/storage");
const { readWadAssets } = await import("@/lib/wad/assets");
const { defaultGame } = await import("@/lib/engine/game");
const { packWad } = await import("@/lib/wad/pack");
const { readLumps } = await import("@/lib/wad/inspect");

const option = (name) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const autosave = option("--map");
const editLink = option("--live");

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
  try {
    readLumps({ name: path, data });
  } catch (error) {
    fail(`--mod: ${error.message}`);
  }
  return data;
});
const context = iwad
  ? { game: defaultGame, names: readWadAssets(iwad, mods).names }
  : {};
const textures =
  iwad && mods.length > 0 ? { iwad, resources: mods } : undefined;
if (autosave && editLink) fail("Use --map or --live, not both.");

const pause = new Int32Array(new SharedArrayBuffer(4));
const lock = (path, run) => {
  const held = `${resolve(path)}.lock`;
  const token = `${process.pid} ${Math.random()}`;
  mkdirSync(dirname(held), { recursive: true });
  for (let tries = 0; ; tries += 1) {
    try {
      writeFileSync(held, token, { flag: "wx" });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      takeOverStale(held);
      if (tries > 2000) {
        throw new Error(`${path} stayed locked.`, { cause: error });
      }
      Atomics.wait(pause, 0, 0, 5);
    }
  }
  try {
    return run();
  } finally {
    // A server that ran past the stale limit may have lost the lock, and
    // leaves the new owner's in place.
    try {
      if (readFileSync(held, "utf8") === token) unlinkSync(held);
    } catch {}
  }
};

// A lock a crashed server left behind is taken over after this long.
const staleLockMs = 10_000;

// Moves a stale lock aside before removing it, so two servers that both saw
// it stale can't remove a fresh lock one of them just took. A fresh one moved
// aside by mistake goes back, unless someone took the lock meanwhile.
function takeOverStale(held) {
  try {
    if (Date.now() - statSync(held).mtimeMs <= staleLockMs) return;
    const aside = `${held}.${process.pid}.stale`;
    renameSync(held, aside);
    if (Date.now() - statSync(aside).mtimeMs <= staleLockMs) {
      try {
        linkSync(aside, held);
      } catch {}
    }
    unlinkSync(aside);
  } catch {}
}

const files = {
  read: (path) => readFileSync(resolve(path), "utf8"),
  // Written whole under another name first, so a server reading the file
  // never sees half of it.
  write: (path, data) => {
    const full = resolve(path);
    mkdirSync(dirname(full), { recursive: true });
    const part = `${full}.${process.pid}.part`;
    writeFileSync(part, data);
    renameSync(part, full);
  },
  lock,
};

let live;
if (editLink) {
  const roomsUrl = option("--rooms") ?? process.env.NEXT_PUBLIC_ROOMS_URL;
  if (!roomsUrl) {
    fail("--live needs the rooms server: add --rooms ws://host:port.");
  }
  // The rooms server lets in only the app's own pages, so the link says it
  // comes from the page the edit link opens.
  let origin;
  try {
    origin = new URL(editLink).origin;
  } catch {
    fail(`--live: ${editLink} isn't a link.`);
  }
  try {
    live = await joinLiveMap({
      editLink,
      roomsUrl,
      name: option("--name") ?? "Agent",
      connect: (url) => new WebSocket(url, { headers: { Origin: origin } }),
    });
  } catch (error) {
    fail(`--live: ${error.message}`);
  }
}

const server = createMcpServer({
  files,
  autosave,
  context,
  textures,
  store: live?.store,
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
await live?.close();
