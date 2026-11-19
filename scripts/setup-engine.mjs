import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { deflateRawSync, gzipSync } from "node:zlib";

import {
  checkOutPinned,
  ensureVerifiedFile,
  gitIn,
  licenseComment,
  objectKey,
  replaceDirectory,
  unlicensedArchives,
} from "./engine-files.mjs";

const root = resolve(import.meta.dirname, "..");
const cache = join(root, ".cache");
const source = join(cache, "woof");
const objects = join(cache, "woof-objects");
const output = join(root, "public", "engine");
const staging = join(cache, "engine-staging");
const linkMap = join(cache, "woof-link.map");
const patch = join(root, "engine", "woof.patch");

const woofRepository = "https://github.com/fabiangreffrath/woof";
const woofCommit = "f28403885a48cfd90cfb9e1f92aaabb16361df8a";
const woofVersion = "16.0.0";
const freedoomVersion = "0.13.0";
const freedoomSha256 =
  "3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59";
const freedoomUrl = `https://github.com/freedoom/freedoom/releases/download/v${freedoomVersion}/freedoom-${freedoomVersion}.zip`;

// Audio goes through src/wadsmith_audio.c, and these need OpenAL, a desktop
// MIDI device or sockets.
const skippedSources = new Set([
  "i_clapmusic.c",
  "i_endoom.c",
  "i_flmusic.c",
  "i_minimp3.c",
  "i_nativemusic.c",
  "i_oalequalizer.c",
  "i_oalmusic.c",
  "i_oalsound.c",
  "i_pcsound.c",
  "i_rumble.c",
  "i_sndfile.c",
  "i_xmp.c",
  "nw_sdl.c",
]);
const addedSources = [
  "src/wadsmith.c",
  "src/wadsmith_audio.c",
  "src/wadsmith_net.c",
  "src/wadsmith_unused.c",
];
const oplSources = ["opl.c", "opl3.c", "opl_emu.c", "opl_queue.c"];
const thirdParty = [
  ["base64/base64.c"],
  ["md5/md5.c"],
  ["sha1/sha1.c"],
  ["miniz/miniz.c", "-DMINIZ_NO_TIME"],
  ["spng/spng.c", "-DSPNG_USE_MINIZ"],
  ["yyjson/yyjson.c", "-DYYJSON_DISABLE_UTILS=1"],
];
const exportedRuntime = "FS,callMain,ccall,HEAPU8,HEAPF32";

const emCache = process.env.EM_CACHE ?? join(homedir(), ".cache", "emscripten");
const env = { ...process.env, EM_CACHE: emCache };
const execFileAsync = promisify(execFile);

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, env, stdio: "inherit" });
}

function prepareSource() {
  checkOutPinned({
    directory: source,
    repository: woofRepository,
    commit: woofCommit,
  });
  gitIn(source, ["apply", patch]);
}

function fetchFreedoom() {
  const zip = join(cache, `freedoom-${freedoomVersion}.zip`);
  ensureVerifiedFile({
    path: zip,
    expectedSha256: freedoomSha256,
    // GitHub's release host can stall on HTTP/2 connections.
    download: (partial) =>
      run("curl", [
        "-fsSL",
        "--http1.1",
        "--retry",
        "3",
        "-o",
        partial,
        freedoomUrl,
      ]),
  });
  const extract = (name) =>
    execFileSync("unzip", ["-p", zip, `freedoom-${freedoomVersion}/${name}`], {
      maxBuffer: 64 * 1024 * 1024,
    });
  const wad = extract("freedoom2.wad");
  writeFileSync(join(staging, "freedoom2.wad"), wad);
  writeFileSync(
    join(staging, `freedoom-${freedoomVersion}.wad.gz`),
    gzipSync(wad, { level: 9 }),
  );
  writeFileSync(join(staging, "FREEDOOM-LICENSE.txt"), extract("COPYING.txt"));
}

function cmakeList(file, start) {
  const text = readFileSync(join(source, file), "utf8");
  const from = text.indexOf(start);
  return text.slice(from + start.length, text.indexOf(")", from));
}

function engineSources() {
  const listed = cmakeList("src/CMakeLists.txt", "set(WOOF_SOURCES")
    .match(/[\w-]+\.c\b/g)
    .filter((name) => !skippedSources.has(name))
    .map((name) => [`src/${name}`]);
  return [
    ...listed,
    ...addedSources.map((name) => [name]),
    ...oplSources.map((name) => [`opl/${name}`]),
    ...thirdParty.map(([name, ...flags]) => [`third-party/${name}`, ...flags]),
  ];
}

function writeConfig(directory) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "config.h"),
    [
      `#define PROJECT_NAME "Woof"`,
      `#define PROJECT_VERSION "${woofVersion}"`,
      `#define PROJECT_STRING "Woof ${woofVersion}"`,
      `#define PROJECT_SHORTNAME "woof"`,
      `#define PROJECT_APPID "io.github.fabiangreffrath.woof"`,
      "#define HAVE_LIBM",
      "#define HAVE_DECL_STRCASECMP 1",
      "#define HAVE_DECL_STRNCASECMP 1",
      "#define HAVE_EXT_VECTOR_TYPE",
      "",
    ].join("\n"),
  );
}

function headerDigest() {
  const hash = createHash("sha256");
  const visit = (directory) => {
    for (const entry of readdirSync(directory, {
      withFileTypes: true,
    }).toSorted((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== ".git") visit(path);
      } else if (/\.(h|inc)$/.test(entry.name) || entry.name === "icon.c") {
        hash.update(entry.name).update(readFileSync(path));
      }
    }
  };
  visit(source);
  return hash.digest("hex");
}

async function compileAll() {
  const generated = join(cache, "woof-generated");
  writeConfig(generated);
  mkdirSync(objects, { recursive: true });
  const al = join(emCache, "sysroot", "include", "AL");
  const includes = [
    generated,
    al,
    "src",
    "opl",
    "third-party",
    "third-party/base64",
    "third-party/md5",
    "third-party/miniz",
    "third-party/minimp3",
    "third-party/sha1",
    "third-party/spng",
    "third-party/yyjson",
  ].map((directory) => `-I${directory}`);
  const flags = [
    "-std=gnu17",
    "-O3",
    "-g0",
    "-flto",
    "-sUSE_SDL=3",
    "-DSPNG_STATIC",
    "-DTHREADLOCAL=",
    "-Wno-everything",
    "-Werror=implicit-function-declaration",
    ...includes,
  ];
  const headers = headerDigest();
  const config = readFileSync(join(generated, "config.h"), "utf8");
  const compiler = execFileSync("emcc", ["--version"], {
    env,
    encoding: "utf8",
  });
  const queue = engineSources();
  const built = [];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [file, ...own] = next;
      const args = [...flags, ...own];
      const key = objectKey({
        source: readFileSync(join(source, file)),
        headers,
        config,
        compiler,
        flags: args,
      });
      const object = join(objects, `${key}.o`);
      built.push(object);
      if (!existsSync(object)) {
        const partial = `${object}.${process.pid}.tmp`;
        await execFileAsync("emcc", ["-c", file, "-o", partial, ...args], {
          cwd: source,
          env,
        });
        renameSync(partial, object);
      }
    }
  };
  // SDL is shared by every file, so it has to exist before they run in parallel.
  // A new Emscripten cache has no sysroot, and the SDL3 port can't install into it.
  run("embuilder", ["build", "sysroot", "sdl3"]);
  await Promise.all(Array.from({ length: availableParallelism() }, worker));
  return built;
}

function link(built) {
  const list = join(cache, "woof-objects.rsp");
  writeFileSync(list, built.map((file) => `"${file}"`).join("\n"));
  run("emcc", [
    `@${list}`,
    "-o",
    join(staging, "woof.js"),
    "-O3",
    "-g0",
    "-flto",
    "-sUSE_SDL=3",
    "-sEMULATE_FUNCTION_POINTER_CASTS=1",
    "-sSTACK_SIZE=5MB",
    "-sINITIAL_MEMORY=64MB",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sMODULARIZE=1",
    "-sEXPORT_ES6=1",
    "-sENVIRONMENT=web,worker,node",
    "-sINVOKE_RUN=0",
    "-sFORCE_FILESYSTEM=1",
    `-sEXPORTED_RUNTIME_METHODS=${exportedRuntime}`,
    "-sEXPORTED_FUNCTIONS=_main",
    `-Wl,-Map=${linkMap}`,
  ]);
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zipArchive(files) {
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const [name, data] of files) {
    const path = Buffer.from(name);
    const packed = deflateRawSync(data, { level: 9 });
    const header = Buffer.alloc(26);
    header.writeUInt16LE(20, 0);
    header.writeUInt16LE(0x0800, 2);
    header.writeUInt16LE(8, 4);
    header.writeUInt16LE(0x21, 8);
    header.writeUInt32LE(crc32(data), 10);
    header.writeUInt32LE(packed.length, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt16LE(path.length, 22);
    const local = Buffer.from([0x50, 0x4b, 3, 4]);
    parts.push(local, header, path, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    header.copy(central, 6, 0, 26);
    central.writeUInt32LE(offset, 42);
    directory.push(central, path);
    offset += 4 + header.length + path.length + packed.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, central, end]);
}

function writeBaseFile() {
  const names = cmakeList("base/CMakeLists.txt", "set(BASE_SOURCES")
    .split(/\s+/)
    .filter(Boolean)
    .toSorted();
  const files = names.map((name) => [
    name,
    readFileSync(join(source, "base", name)),
  ]);
  writeFileSync(join(staging, "woof.pk3"), zipArchive(files));
}

function emscriptenRoot() {
  return execFileSync("em-config", ["EMSCRIPTEN_ROOT"], {
    env,
    encoding: "utf8",
  }).trim();
}

function sdlSource() {
  const ports = join(emCache, "ports", "sdl3");
  const name = readdirSync(ports).find((entry) => entry.startsWith("SDL-"));
  if (!name) throw new Error("The SDL3 port is missing.");
  return join(ports, name);
}

// Homebrew keeps the license beside its copy of Emscripten, not inside it.
function emscriptenLicense(emscripten) {
  const file = [emscripten, dirname(emscripten)]
    .map((directory) => join(directory, "LICENSE"))
    .find((candidate) => existsSync(candidate));
  if (!file) throw new Error("Emscripten's licence is missing.");
  return file;
}

function writeLicenses() {
  const unknown = unlicensedArchives(readFileSync(linkMap, "utf8"));
  if (unknown.length > 0) {
    throw new Error(`No licence is known for: ${unknown.join(", ")}`);
  }
  const directory = join(staging, "licenses");
  mkdirSync(directory);
  const emscripten = emscriptenRoot();
  const sdl = sdlSource();
  const copies = [
    ["miniz.txt", join(source, "third-party/miniz/LICENSE")],
    ["spng.txt", join(source, "third-party/spng/LICENSE")],
    ["yyjson.txt", join(source, "third-party/yyjson/LICENSE")],
    ["base64.txt", join(source, "third-party/base64/README")],
    ["sdl3.txt", join(sdl, "LICENSE.txt")],
    ["sdl3-yuv2rgb.txt", join(sdl, "src/video/yuv2rgb/LICENSE")],
    ["emscripten.txt", emscriptenLicense(emscripten)],
    ["musl.txt", join(emscripten, "system/lib/libc/musl/COPYRIGHT")],
    ["compiler-rt.txt", join(emscripten, "system/lib/compiler-rt/LICENSE.TXT")],
  ];
  for (const [name, file] of copies) {
    copyFileSync(file, join(directory, name));
  }
  const notices = [
    ["md5.txt", join(source, "third-party/md5/md5.c")],
    ["sha1.txt", join(source, "third-party/sha1/sha1.c")],
    ["nuked-opl3.txt", join(source, "opl/opl3.c")],
    ["flick-stick.txt", join(source, "src/i_flickstick.c")],
    ["gyro.txt", join(source, "src/i_gyro.c")],
    ["nano-bsp.txt", join(source, "src/nano_bsp.c")],
    ["dlmalloc.txt", join(emscripten, "system/lib/dlmalloc.c"), "Doug Lea"],
  ];
  for (const [name, file, marker] of notices) {
    writeFileSync(
      join(directory, name),
      licenseComment(readFileSync(file, "utf8"), marker),
    );
  }
  writeFileSync(
    join(directory, "README.txt"),
    [
      "Licences and notices for the code linked into woof.wasm and woof.js.",
      "Woof itself is under WOOF-LICENSE.txt, one level up.",
      "",
      ...[...copies, ...notices].map(
        ([name, file]) =>
          `${name}: ${basename(dirname(file))}/${basename(file)}`,
      ),
      "",
    ].join("\n"),
  );
}

mkdirSync(cache, { recursive: true });
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
mkdirSync(dirname(output), { recursive: true });
prepareSource();
fetchFreedoom();
link(await compileAll());
writeBaseFile();
copyFileSync(join(source, "COPYING"), join(staging, "WOOF-LICENSE.txt"));
writeLicenses();
replaceDirectory(staging, output);
console.log(`Woof and Freedoom are ready in ${output}.`);
