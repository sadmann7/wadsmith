import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkOutPinned,
  ensureVerifiedFile,
  licenseComment,
  objectKey,
  replaceDirectory,
  sha256,
  unlicensedArchives,
} from "./engine-files.mjs";

const directories = [];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "engine-files-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("verified downloads", () => {
  const good = "good file";
  const expectedSha256 = sha256(good);

  it("keeps a cached file with the right checksum", () => {
    const path = join(temporaryDirectory(), "file");
    writeFileSync(path, good);
    ensureVerifiedFile({
      path,
      expectedSha256,
      download: () => {
        throw new Error("It should not download.");
      },
    });
    expect(readFileSync(path, "utf8")).toBe(good);
  });

  it("replaces a damaged cached file", () => {
    const path = join(temporaryDirectory(), "file");
    writeFileSync(path, "partial");
    ensureVerifiedFile({
      path,
      expectedSha256,
      download: (partial) => writeFileSync(partial, good),
    });
    expect(readFileSync(path, "utf8")).toBe(good);
  });

  it("leaves nothing behind when a download is bad or interrupted", () => {
    const path = join(temporaryDirectory(), "file");
    expect(() =>
      ensureVerifiedFile({
        path,
        expectedSha256,
        download: (partial) => writeFileSync(partial, "wrong"),
      }),
    ).toThrow("Checksum mismatch");
    expect(() =>
      ensureVerifiedFile({
        path,
        expectedSha256,
        download: (partial) => {
          writeFileSync(partial, "half");
          throw new Error("Connection lost");
        },
      }),
    ).toThrow("Connection lost");
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.part`)).toBe(false);
  });
});

describe("engine directory swap", () => {
  it("replaces the old engine in one step", () => {
    const root = temporaryDirectory();
    const staging = join(root, "staging");
    const target = join(root, "engine");
    mkdirSync(staging);
    mkdirSync(target);
    writeFileSync(join(staging, "new"), "1");
    writeFileSync(join(target, "old"), "1");
    replaceDirectory(staging, target);
    expect(existsSync(join(target, "new"))).toBe(true);
    expect(existsSync(join(target, "old"))).toBe(false);
    expect(existsSync(`${target}.previous`)).toBe(false);
  });

  it("keeps the working engine when the new one is missing", () => {
    const root = temporaryDirectory();
    const target = join(root, "engine");
    mkdirSync(target);
    writeFileSync(join(target, "old"), "1");
    expect(() => replaceDirectory(join(root, "missing"), target)).toThrow();
    expect(existsSync(join(target, "old"))).toBe(true);
  });
});

describe("object cache key", () => {
  const base = {
    source: "source",
    headers: "headers",
    config: "config",
    compiler: "emcc 7",
    flags: ["-O3"],
  };

  it.each([
    ["source", { source: "other" }],
    ["headers", { headers: "other" }],
    ["generated config", { config: "other" }],
    ["compiler version", { compiler: "emcc 8" }],
    ["flags", { flags: ["-O2"] }],
  ])("changes with the %s", (_name, change) => {
    expect(objectKey({ ...base, ...change })).not.toBe(objectKey(base));
  });
});

describe("licence collection", () => {
  it("reads the notice at the top of a source file", () => {
    expect(licenseComment("/* Notice */\nint a;")).toBe("/* Notice */\n");
    expect(licenseComment("// One\n// Two\nint a;")).toBe("// One\n// Two\n");
  });

  it("finds the comment holding a named notice", () => {
    expect(licenseComment("/* note */\n/* By Doug Lea */", "Doug Lea")).toBe(
      "/* By Doug Lea */\n",
    );
    expect(() => licenseComment("int a;")).toThrow("no licence comment");
  });

  it("flags linked libraries without a known licence", () => {
    expect(unlicensedArchives("x/libc.a(y.o)\nz/libnew.a(q.o)")).toEqual([
      "libnew.a",
    ]);
  });
});

function git(directory, ...args) {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function repositories() {
  const root = temporaryDirectory();
  const upstream = join(root, "upstream");
  const parent = join(root, "parent");
  mkdirSync(upstream);
  mkdirSync(parent);
  git(upstream, "init", "-q");
  writeFileSync(join(upstream, "engine.txt"), "engine");
  git(upstream, "add", ".");
  git(upstream, "commit", "-q", "-m", "engine");
  git(parent, "init", "-q");
  writeFileSync(join(parent, "tracked.txt"), "tracked");
  git(parent, "add", ".");
  git(parent, "commit", "-q", "-m", "parent");
  writeFileSync(join(parent, "tracked.txt"), "uncommitted edit");
  return {
    parent,
    directory: join(parent, ".cache", "woof"),
    repository: `file://${upstream}`,
    commit: git(upstream, "rev-parse", "HEAD"),
    parentHead: git(parent, "rev-parse", "HEAD"),
  };
}

describe("pinned source checkout", () => {
  it.each([
    ["an empty .git directory", () => {}],
    [
      "an empty HEAD",
      (gitDirectory) => writeFileSync(join(gitDirectory, "HEAD"), ""),
    ],
  ])("leaves the parent repository alone with %s", (_name, damage) => {
    const { parent, directory, repository, commit, parentHead } =
      repositories();
    const gitDirectory = join(directory, ".git");
    mkdirSync(gitDirectory, { recursive: true });
    damage(gitDirectory);

    checkOutPinned({ directory, repository, commit });

    expect(git(parent, "rev-parse", "HEAD")).toBe(parentHead);
    expect(readFileSync(join(parent, "tracked.txt"), "utf8")).toBe(
      "uncommitted edit",
    );
    expect(git(parent, "status", "--porcelain", "tracked.txt")).toBe(
      "M tracked.txt",
    );
    expect(git(directory, "rev-parse", "HEAD")).toBe(commit);
    expect(readFileSync(join(directory, "engine.txt"), "utf8")).toBe("engine");
  });

  it("replaces a symlink without touching the clone it points to", () => {
    const { directory, repository, commit } = repositories();
    const ownClone = temporaryDirectory();
    git(ownClone, "init", "-q");
    writeFileSync(join(ownClone, "work.txt"), "unsaved work");
    mkdirSync(join(directory, ".."), { recursive: true });
    symlinkSync(ownClone, directory);

    checkOutPinned({ directory, repository, commit });

    expect(lstatSync(directory).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(ownClone, "work.txt"), "utf8")).toBe(
      "unsaved work",
    );
    expect(git(directory, "rev-parse", "HEAD")).toBe(commit);
  });

  it("restores a clone with local changes to the pinned commit", () => {
    const { directory, repository, commit } = repositories();
    checkOutPinned({ directory, repository, commit });
    writeFileSync(join(directory, "engine.txt"), "changed");
    writeFileSync(join(directory, "extra.txt"), "extra");
    checkOutPinned({ directory, repository, commit });
    expect(readFileSync(join(directory, "engine.txt"), "utf8")).toBe("engine");
    expect(existsSync(join(directory, "extra.txt"))).toBe(false);
  });
});
