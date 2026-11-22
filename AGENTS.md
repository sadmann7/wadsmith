# Agents

## Comments

Default to no comment. Write one only for a constraint, an external quirk, or an invariant the code can't show, in one line where you can and four at most. Don't restate names, narrate steps, record history, or explain the fix you just made; the PR carries that.

- Full sentences ending with a full stop, including notes after code on the same line.
- No required verb form, and no "we" or "our".
- JSDoc only on the public API (props, options, hooks and functions users import): one sentence, no types, no empty `@param` or `@returns`. Components and parts get none, and neither do internal helpers, even ones another file imports.
- A `TODO:` links the issue that tracks it. No bare `#123`.
- No section dividers, commented-out code, or test step labels.

`wadsmith/comment-style` in `lint/comment-style.ts` enforces the mechanical parts.

## Skills

`.agents/skills` holds the skills for this repo, and `.claude/skills` links to it. Read a skill's `SKILL.md` and follow it before the work it covers.

- `ui-sdk`: any UI built on UI SDK. It links to the copy that ships in `@ui-sdk/core`, so it matches the installed version. Its docs are in `node_modules/@ui-sdk/react/docs`; start from `llms.txt`.

## UI

- Import from another folder through `@/`, which maps to `src`, and from the same folder with `./`.
- Import React and UI SDK parts as namespaces: `import * as React from "react"`, `import * as DialogPrimitive from "@ui-sdk/react/dialog"`.
- `cn` in `src/lib/cn.ts` also takes a class name that's a function of a part's state, so pass a part's `className` through it without narrowing it to a string.
- React UI, including UI SDK primitives built with `createParts`, lives in `src/components`. Hooks live in `src/hooks`, as `use-<name>.ts`. Everything else lives in `src/lib`.
- `src/components/ui` ends each file with one `export { ... }` list, like shadcn/ui. Everywhere else, export each declaration where it's declared.
- A component's props are an `interface <Component>Props` declared above it, never an inline object type. `wadsmith/no-inline-props` enforces it.

## Project

Wadsmith is a Doom map editor built with Next.js, Tailwind CSS and UI SDK. It compiles maps to real WAD files and plays them in Woof, built for WebAssembly and run in its vanilla Doom compatibility mode.

- `src/app`: Next.js routes and metadata images. `colors.test.ts` checks the contrast of the color tokens.
- `src/styles`: global styles. The color tokens in `globals.css` use shadcn/ui role names.
- `src/components/ui`: shared controls built on UI SDK with Tailwind, such as `Button`, `Input`, `Field`, `Select`, `Menu` and `Dialog`. New UI uses these instead of new classes in `globals.css`.
- `src/components`: the app shell and pieces several areas share, like `MapPlan`. `editor` holds the editor screen, the `map-editor` primitive, the inspector and the editable 3D view; `episodes` holds the episode pages, featured maps and the dialogs around them; `play` holds the game view, its HUD and co-op screens.
- `src/hooks`: shared hooks, like `useIwad` and `useBuildChecks`.
- `src/lib`: everything that isn't UI. No React components.
  - `map`: the map model, edits and validation.
  - `wad`: the WAD compiler, including the BSP and blockmap builders.
  - `engine`: the game runs in `doom-worker.ts`, `game-client.ts` connects it to the page and an AudioWorklet, `mouse-capture.ts` holds the pointer lock rules, `room.ts` runs co-op rooms, and `peer-link.ts` sends game packets directly over WebRTC when it can.
  - `episodes`: episode data, routes, storage and build checks. Saved data still says "project" (the IndexedDB stores, a map's `projectId` and the backup format) so existing browsers and backups keep working.
  - `editor`: editor shortcuts, targets, thing icons and the agent. `agent-actions.ts` is the one table of actions an agent can take on a map, each checked before it lands. The page's agent bridge and the MCP server in `mcp-server.ts`, started by `scripts/wadsmith-mcp.mjs`, both run it.
  - `preview`: the 3D view's software renderer and camera. It is not the game renderer.
- `rooms`: the Cloudflare Worker for online co-op rooms, one Durable Object per room. It passes messages between a room's players, and has its own `tsconfig.json`. Under `/maps` it also keeps maps' online copies, one `MapCopy` Durable Object per map; `src/lib/episodes/cloud.ts` is the client, and `live.ts` its live link for editing together. Edits travel as patches from `rooms/src/map-patch.ts`, which the app imports as `@rooms/map-patch`.
- `engine/woof.patch`: every change to Woof, including the browser frame loop, the audio mixer and Wadsmith's exports. To change it, edit `.cache/woof`, then run `git add -AN && git diff > ../../engine/woof.patch` there.

Editor coordinates are y-down. `toDoom` in `src/lib/wad/compile.ts` is the only place that flips them for the engine.

Run `pnpm setup:engine` once after cloning, and again when `engine/` or `scripts/setup-engine.mjs` changes. It needs Emscripten, git, curl and unzip, and it writes the engine, Freedoom and their licenses to `public/engine`, which stays out of git.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
