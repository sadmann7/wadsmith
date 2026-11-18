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

Wadsmith is a Doom map editor built with UI SDK. It compiles maps to real WAD files and plays them in Chocolate Doom, built for WebAssembly from cloudflare/doom-wasm.

- `src/map`: the map model, edits and validation. No UI code.
- `src/wad`: the WAD compiler, including the BSP and blockmap builders.
- `src/editor`: the `map-editor` primitive and inspector.
- `src/preview`: the editable 3D view and its software renderer. It is not the game renderer.
- `src/engine` and `engine/`: the browser runtime, the engine patch and the C exports the page reads. `engine/doom-wasm.patch` comes from tablecn, so keep the two in step; Wadsmith's own engine changes go in `engine/wadsmith.patch`.

Editor coordinates are y-down. `toDoom` in `src/wad/compile.ts` is the only place that flips them for the engine.

Run `pnpm setup:engine` once after cloning. It needs Emscripten, autoconf, automake and pkg-config, and it writes the engine and Freedoom to `public/engine`, which stays out of git.
