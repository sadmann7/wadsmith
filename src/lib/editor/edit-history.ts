import {
  applyPatch,
  combinePatches,
  diffMaps,
  getIsEmptyPatch,
  type MapPatch,
  missingCorners,
} from "@rooms/map-patch";

import type { GameMap } from "@/lib/map/types";

import { sectorVertices } from "@/lib/map/geometry";
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
    record(
      before: GameMap,
      after: GameMap,
      group?: string,
      delay = groupDelay,
    ) {
      const redo = diffMaps(before, after);
      if (getIsEmptyPatch(redo)) return;
      const undo = diffMaps(after, before);
      const now = Date.now();
      const last = done.at(-1);
      undone.length = 0;
      if (group && last?.group === group && now - last.at < delay) {
        last.redo = combinePatches(last.redo, redo);
        last.undo = combinePatches(undo, last.undo);
        last.at = now;
        return;
      }
      done.push({ undo, redo, group, at: now });
      if (done.length > limit) done.shift();
    },
    undo(current: GameMap) {
      const step = done.pop();
      if (!step) return undefined;
      const next = keepCorners(current, applyPatch(current, step.undo));
      // A room can't come back on corners someone else removed since, so
      // that step is gone.
      if (getHasLostCorners(current, next)) return undefined;
      undone.push(step);
      return next;
    },
    redo(current: GameMap) {
      const step = undone.pop();
      if (!step) return undefined;
      const next = keepCorners(current, applyPatch(current, step.redo));
      if (getHasLostCorners(current, next)) return undefined;
      done.push({ ...step, group: undefined });
      return next;
    },
    // Takes back every step of one group, wherever it sits in the history.
    // Nothing changes if that would bring a room back on lost corners.
    undoGroup(group: string, current: GameMap) {
      const steps = done.filter((step) => step.group === group).toReversed();
      if (steps.length === 0) return undefined;
      const next = steps.reduce(
        (map, step) => keepCorners(map, applyPatch(map, step.undo)),
        current,
      );
      if (getHasLostCorners(current, next)) return undefined;
      for (const step of steps) done.splice(done.indexOf(step), 1);
      undone.length = 0;
      return next;
    },
    canUndo: () => done.length > 0,
    canRedo: () => undone.length > 0,
    // Forgets every step, as when the whole map was swapped for another.
    clear() {
      done.length = 0;
      undone.length = 0;
    },
  };
}

function getHasLostCorners(current: GameMap, next: GameMap) {
  const before = missingCorners(current);
  return [...missingCorners(next)].some((id) => !before.has(id));
}

// Corners a step would take away that a room still uses, like one someone
// else drew against them since, stay where they are.
function keepCorners(current: GameMap, next: GameMap): GameMap {
  const used = new Set(next.sectors.flatMap(sectorVertices));
  const missing = [...used].filter(
    (id) => !next.vertices[id] && current.vertices[id],
  );
  if (missing.length === 0) return next;
  return {
    ...next,
    vertices: {
      ...next.vertices,
      ...Object.fromEntries(missing.map((id) => [id, current.vertices[id]])),
    },
  };
}
