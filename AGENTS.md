# Agents

## Comments

Default to no comment. Write one only for a constraint, an external quirk, or an invariant the code can't show, in one line where you can and four at most. Don't restate names, narrate steps, record history, or explain the fix you just made; the PR carries that.

- Full sentences ending with a full stop, including notes after code on the same line.
- No required verb form, and no "we" or "our".
- JSDoc only on the public API (props, options, hooks and functions users import): one sentence, no types, no empty `@param` or `@returns`. Components and parts get none, and neither do internal helpers, even ones another file imports.
- A `TODO:` links the issue that tracks it. No bare `#123`.
- No section dividers, commented-out code, or test step labels.

`wadsmith/comment-style` in `lint/comment-style.ts` enforces the mechanical parts.

## Project

Wadsmith is a Doom map editor built with Next.js, Tailwind CSS and UI SDK. It compiles maps to real WAD files and plays them in Woof, built for WebAssembly and run in its vanilla Doom compatibility mode.

- `src/app`: Next.js routes, metadata images and global styles. Read the guides in `node_modules/next/dist/docs/` before changing Next.js code. The design tokens are in `globals.css`; new UI should use Tailwind utilities.
- `src/map`: the map model, edits and validation. No UI code.
- `src/wad`: the WAD compiler, including the BSP and blockmap builders.
- `src/editor`: the `map-editor` primitive and inspector.
- `src/preview`: the editable 3D view and its software renderer. It is not the game renderer.
- `src/engine`: the game runs in `doom-worker.ts`, `game-client.ts` connects it to the page and an AudioWorklet, and `mouse-capture.ts` holds the pointer lock rules.
- `engine/woof.patch`: every change to Woof, including the browser frame loop, the audio mixer and Wadsmith's exports. To change it, edit `.cache/woof`, then run `git add -AN && git diff > ../../engine/woof.patch` there.

Editor coordinates are y-down. `toDoom` in `src/wad/compile.ts` is the only place that flips them for the engine.

Run `pnpm setup:engine` once after cloning, and again when `engine/` or `scripts/setup-engine.mjs` changes. It needs Emscripten, git, curl and unzip, and it writes the engine, Freedoom and their licenses to `public/engine`, which stays out of git.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
