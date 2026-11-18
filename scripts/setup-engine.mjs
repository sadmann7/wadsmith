import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cache = join(root, ".cache");
const source = join(cache, "doom-wasm");
const output = join(root, "public", "engine");

const engineCommit = "65e0d3ae2ffa604155eebd96ed40da6567bd08f4";
const freedoomVersion = "0.13.0";
const freedoomSha256 =
  "3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59";
const freedoomUrl = `https://github.com/freedoom/freedoom/releases/download/v${freedoomVersion}/freedoom-${freedoomVersion}.zip`;

const env = {
  ...process.env,
  EM_CACHE: process.env.EM_CACHE ?? join(homedir(), ".cache", "emscripten"),
  ac_cv_exeext: ".html",
};

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, env, stdio: "inherit" });
}

function hasEngineCommit() {
  try {
    execFileSync("git", ["cat-file", "-e", `${engineCommit}^{commit}`], {
      cwd: source,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function prepareSource() {
  if (!existsSync(join(source, ".git"))) {
    mkdirSync(source, { recursive: true });
    run("git", ["init", "-q"], source);
  }
  if (!hasEngineCommit()) {
    run(
      "git",
      [
        "fetch",
        "-q",
        "--depth=1",
        "https://github.com/cloudflare/doom-wasm",
        engineCommit,
      ],
      source,
    );
  }
  run("git", ["checkout", "-q", "--force", engineCommit], source);
  run("git", ["clean", "-qfdx"], source);
  for (const patch of ["doom-wasm.patch", "wadsmith.patch"]) {
    run("git", ["apply", join(root, "engine", patch)], source);
  }

  copyFileSync(
    join(root, "engine", "wadsmith-exports.c"),
    join(source, "src", "doom", "wadsmith-exports.c"),
  );
  appendFileSync(
    join(source, "src", "doom", "g_game.c"),
    '\n#include "wadsmith-exports.c"\n',
  );

  const configure = join(source, "configure.ac");
  writeFileSync(
    configure,
    readFileSync(configure, "utf8")
      .replace("-s INVOKE_RUN=1", "-s INVOKE_RUN=0")
      .replace("-s ALLOW_MEMORY_GROWTH=0", "-s ALLOW_MEMORY_GROWTH=1"),
  );
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
  run("emconfigure", ["autoreconf", "-fi"], source);
  run("emconfigure", ["./configure", "--host=none-none-none"], source);
  run("emmake", ["make", "-j8"], source);
  for (const file of ["websockets-doom.js", "websockets-doom.wasm"]) {
    copyFileSync(join(source, "src", file), join(output, file));
  }
  copyFileSync(join(source, "COPYING.md"), join(output, "ENGINE-LICENSE.md"));
}

mkdirSync(cache, { recursive: true });
mkdirSync(output, { recursive: true });
for (const stale of ["doom.js", "doom.wasm", "ENGINE-LICENSE.txt"]) {
  rmSync(join(output, stale), { force: true });
}
prepareSource();
fetchFreedoom();
buildEngine();
console.log(`Engine and Freedoom are ready in ${output}.`);
