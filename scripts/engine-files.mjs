import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname } from "node:path";

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

// A file only reaches its final name after its checksum passes, so neither a
// failed download nor a damaged cache entry is ever trusted.
function ensureVerifiedFile({ path, expectedSha256, download }) {
  if (existsSync(path)) {
    if (sha256(readFileSync(path)) === expectedSha256) return;
    rmSync(path);
  }
  const partial = `${path}.part`;
  rmSync(partial, { force: true });
  try {
    download(partial);
    const digest = sha256(readFileSync(partial));
    if (digest !== expectedSha256) {
      throw new Error(`Checksum mismatch for ${path}: ${digest}`);
    }
    renameSync(partial, path);
  } finally {
    rmSync(partial, { force: true });
  }
}

function replaceDirectory(staging, target) {
  const previous = `${target}.previous`;
  rmSync(previous, { recursive: true, force: true });
  const hadTarget = existsSync(target);
  if (hadTarget) renameSync(target, previous);
  try {
    renameSync(staging, target);
  } catch (error) {
    if (hadTarget) renameSync(previous, target);
    throw error;
  }
  rmSync(previous, { recursive: true, force: true });
}

function objectKey({ source, headers, config, compiler, flags }) {
  const hash = createHash("sha256");
  for (const part of [source, headers, config, compiler, flags.join("\0")]) {
    hash.update(part).update("\0");
  }
  return hash.digest("hex");
}

function licenseComment(text, marker = "") {
  const comments = text.match(/\/\*[\s\S]*?\*\/|(?:^[ \t]*\/\/.*\r?\n)+/gm);
  const notice = comments?.find((comment) => comment.includes(marker));
  if (!notice) throw new Error("The file has no licence comment.");
  return `${notice.trim()}\n`;
}

const allowedArchives = new Set([
  "libc.a",
  "libclang_rt.builtins.a",
  "libdlmalloc.a",
  "libemcc.a",
]);

function unlicensedArchives(linkMap) {
  const found = new Set(linkMap.match(/[\w.+-]+\.a\b/g) ?? []);
  return [...found].filter((name) => !allowedArchives.has(name));
}

// Git searches parent directories and honours repository variables, so a
// stray .git or environment setting would otherwise point it at another repo.
function gitIn(directory, args, options = {}) {
  const env = { ...process.env };
  const localNames = execFileSync("git", ["rev-parse", "--local-env-vars"], {
    encoding: "utf8",
  });
  for (const name of localNames.split("\n").filter(Boolean)) {
    delete env[name];
  }
  env.GIT_CEILING_DIRECTORIES = realpathSync(dirname(directory));
  return execFileSync("git", args, {
    cwd: directory,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

// The checkout is always rebuilt from nothing, so whatever sits at the path,
// including a symlink to someone's own clone, is removed rather than reused.
function checkOutPinned({ directory, repository, commit }) {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  gitIn(directory, ["init", "-q"]);
  gitIn(directory, ["fetch", "-q", "--depth=1", repository, commit]);
  gitIn(directory, ["checkout", "-q", commit]);
  const head = gitIn(directory, ["rev-parse", "HEAD"]).trim();
  if (head !== commit) throw new Error(`${directory} is not at ${commit}.`);
}

export {
  checkOutPinned,
  gitIn,
  ensureVerifiedFile,
  licenseComment,
  objectKey,
  replaceDirectory,
  sha256,
  unlicensedArchives,
};
