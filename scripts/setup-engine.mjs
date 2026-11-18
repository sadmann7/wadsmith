import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cache = join(root, ".cache");
const source = join(cache, "doomgeneric");
const objects = join(cache, "objects");
const output = join(root, "public", "engine");

const engineCommit = "e257a09527062bfb986b6e5e0780839b6cbd5b71";
const freedoomVersion = "0.13.0";
const freedoomSha256 =
  "3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59";
const freedoomUrl = `https://github.com/freedoom/freedoom/releases/download/v${freedoomVersion}/freedoom-${freedoomVersion}.zip`;

const excluded = new Set([
  "doomgeneric_emscripten.o",
  "i_sdlmusic.o",
  "i_sdlsound.o",
]);

const env = {
  ...process.env,
  EM_CACHE: process.env.EM_CACHE ?? join(homedir(), ".cache", "emscripten"),
};

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, env, stdio: "inherit" });
}

function fetchEngine() {
  if (!existsSync(join(source, ".git"))) {
    mkdirSync(source, { recursive: true });
    run("git", ["init", "-q"], source);
    run(
      "git",
      [
        "fetch",
        "-q",
        "--depth=1",
        "https://github.com/ozkl/doomgeneric",
        engineCommit,
      ],
      source,
    );
    run("git", ["checkout", "-q", "FETCH_HEAD"], source);
  }
}

function fetchFreedoom() {
  const wad = join(output, "freedoom2.wad");
  if (existsSync(wad)) return;
  const zip = join(cache, `freedoom-${freedoomVersion}.zip`);
  if (!existsSync(zip)) {
    run("curl", ["-fsSL", "-o", zip, freedoomUrl]);
  }
  const digest = createHash("sha256").update(readFileSync(zip)).digest("hex");
  if (digest !== freedoomSha256) {
    throw new Error(`Freedoom checksum mismatch: ${digest}`);
  }
  const data = execFileSync(
    "unzip",
    ["-p", zip, `freedoom-${freedoomVersion}/freedoom2.wad`],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  writeFileSync(wad, data);
}

function buildEngine() {
  const directory = join(source, "doomgeneric");
  const makefile = readFileSync(join(directory, "Makefile.emscripten"), "utf8");
  const list = /^SRC_DOOM = (.+)$/m.exec(makefile)?.[1];
  if (!list) throw new Error("Could not read the engine's source list.");
  const flags = [
    "-O2",
    "-std=gnu11",
    "-w",
    `-I${directory}`,
    "-DDOOMGENERIC_RESX=640",
    "-DDOOMGENERIC_RESY=400",
  ];
  const inputs = list
    .trim()
    .split(/\s+/)
    .filter((name) => !excluded.has(name))
    .map((name) => [join(directory, name.replace(/\.o$/, ".c")), name]);
  inputs.push([join(root, "engine", "platform.c"), "platform.o"]);

  mkdirSync(objects, { recursive: true });
  const built = inputs.map(([file, name]) => {
    const object = join(objects, name);
    run("emcc", [...flags, "-c", file, "-o", object]);
    return object;
  });

  run("emcc", [
    ...flags,
    ...built,
    "-o",
    join(output, "doom.js"),
    "-sMODULARIZE=1",
    "-sEXPORT_ES6=1",
    "-sEXPORT_NAME=createDoom",
    "-sENVIRONMENT=web,node",
    "-sINVOKE_RUN=0",
    "-sEXIT_RUNTIME=0",
    "-sFORCE_FILESYSTEM=1",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sINITIAL_MEMORY=67108864",
    "-sSTACK_SIZE=1048576",
    "-sEMULATE_FUNCTION_POINTER_CASTS=1",
    "-sEXPORTED_RUNTIME_METHODS=FS,callMain,HEAPU8",
    "-sEXPORTED_FUNCTIONS=_main,_malloc,_free",
  ]);
  copyFileSync(join(source, "LICENSE"), join(output, "ENGINE-LICENSE.txt"));
}

mkdirSync(cache, { recursive: true });
mkdirSync(output, { recursive: true });
fetchEngine();
fetchFreedoom();
buildEngine();
console.log(`Engine and Freedoom are ready in ${output}.`);
