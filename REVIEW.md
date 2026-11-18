# Review

Wadsmith turns an edited map into binary data for a 1990s engine that does little checking of its own. A mistake usually means a map that crashes the engine, renders holes or lets the player walk through walls, even though the editor looks right.

## Checks

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`.
- `pnpm setup:engine` before `pnpm test` when `engine/` or `scripts/setup-engine.mjs` changes, or the engine tests are skipped.

## What to look for

- **Coordinate flips.** The editor is y-down and the engine is y-up. Winding, wall sides and thing angles must agree after `toDoom`.
- **Engine limits.** WAD fields are 16-bit, blockmap offsets are signed, and texture names are 8 characters. Values past those limits wrap silently.
- **Validation gaps.** Anything `compileMap` can't represent should be reported by `validateMap` before Play is enabled.
- **Live drag state.** Dragging must update through `live` slots without rendering React, and commit one undo step on drop.
- **Agent actions.** Each action listed on `map-editor` must go through `createChange`, so it can be undone and cancelled like a person's edit.

## Skip

- `pnpm-lock.yaml`, `public/engine` and anything the formatter or lint already enforces.

## Format

- Start with a count: `N important, N nit, N pre-existing`. Say plainly when nothing needs fixing.
- Every finding gives `file:line` and the input or state that breaks.
- At most three nits.
