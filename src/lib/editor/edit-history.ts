import {
  applyPatch,
  diffMaps,
  getIsEmptyPatch,
  type MapPatch,
} from "@rooms/map-patch";

import type { GameMap } from "@/lib/map/types";

interface Step {
  undo: MapPatch;
  redo: MapPatch;
  group?: string;
  at: number;
}

interface EditHistoryOptions {
  limit: number;
  groupDelay: number;
}

// Undo and redo for one person's edits. Each step keeps what it changed, not
// the whole map, and undoing puts back only those things, so an edit someone
// else made since stays.
export function createEditHistory({ limit, groupDelay }: EditHistoryOptions) {
  const done: Step[] = [];
  const undone: Step[] = [];
  return {
    // Edits of one group close together join one step, like a drag's moves.
    record(before: GameMap, after: GameMap, group?: string) {
      const redo = diffMaps(before, after);
      if (getIsEmptyPatch(redo)) return;
      const undo = diffMaps(after, before);
      const now = Date.now();
      const last = done.at(-1);
      undone.length = 0;
      if (group && last?.group === group && now - last.at < groupDelay) {
        last.redo = mergePatches(last.redo, redo);
        last.undo = mergePatches(undo, last.undo);
        last.at = now;
        return;
      }
      done.push({ undo, redo, group, at: now });
      if (done.length > limit) done.shift();
    },
    undo(current: GameMap) {
      const step = done.pop();
      if (!step) return undefined;
      undone.push(step);
      return applyPatch(current, step.undo);
    },
    redo(current: GameMap) {
      const step = undone.pop();
      if (!step) return undefined;
      done.push({ ...step, group: undefined });
      return applyPatch(current, step.redo);
    },
    canUndo: () => done.length > 0,
    canRedo: () => undone.length > 0,
  };
}

// One patch that does both, the second winning where they touch one thing.
function mergePatches(first: MapPatch, second: MapPatch): MapPatch {
  const set: NonNullable<MapPatch["set"]> = { ...first.set };
  for (const [name, changes] of Object.entries(second.set ?? {})) {
    const key = name as keyof typeof set;
    set[key] = { ...set[key], ...changes };
  }
  const fields = { ...first.fields, ...second.fields };
  return {
    ...(Object.keys(set).length > 0 && { set }),
    ...(Object.keys(fields).length > 0 && { fields }),
  };
}
