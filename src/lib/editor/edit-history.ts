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
  id: number;
  undo: MapPatch;
  redo: MapPatch;
  group?: string;
  batch?: string;
  at: number;
}

interface RecordOptions {
  group?: string;
  batch?: string;
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
  // Steps of a batch past the limit, which only undoing the whole batch
  // takes back, as long as some of its steps are still in the history.
  let evicted: Step[] = [];
  let nextId = 1;
  const getHasBatch = (batch: string) =>
    done.some((step) => step.batch === batch) ||
    undone.some((step) => step.batch === batch);
  return {
    // Edits of one group close together join one step, like a drag's moves.
    // Edits of one batch stay separate steps that can still be undone
    // together. Returns the id of the step the edit went into, if it changed
    // anything.
    record(
      before: GameMap,
      after: GameMap,
      { group, batch }: RecordOptions = {},
    ) {
      const redo = diffMaps(before, after);
      if (getIsEmptyPatch(redo)) return;
      const undo = diffMaps(after, before);
      const now = Date.now();
      const last = done.at(-1);
      undone.length = 0;
      evicted = evicted.filter((step) => step.batch && getHasBatch(step.batch));
      if (
        group &&
        last?.group === group &&
        last.batch === batch &&
        now - last.at < groupDelay
      ) {
        last.redo = combinePatches(last.redo, redo);
        last.undo = combinePatches(undo, last.undo);
        last.at = now;
        return last.id;
      }
      const id = nextId;
      nextId += 1;
      done.push({ id, undo, redo, group, batch, at: now });
      const oldest = done.length > limit ? done.shift() : undefined;
      // A batch's last step out takes its evicted steps with it.
      if (oldest?.batch) {
        const { batch } = oldest;
        if (getHasBatch(batch)) evicted.push(oldest);
        else evicted = evicted.filter((step) => step.batch !== batch);
      }
      return id;
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
    // Takes back every step of one batch, wherever it sits in the history.
    // Nothing changes if none of it is left, or if that would bring a room
    // back on lost corners.
    undoBatch(batch: string, current: GameMap) {
      if (!getHasBatch(batch)) return undefined;
      const ofBatch = (step: Step) => step.batch === batch;
      const steps = [...evicted.filter(ofBatch), ...done.filter(ofBatch)];
      const next = steps
        .toReversed()
        .reduce(
          (map, step) => keepCorners(map, applyPatch(map, step.undo)),
          current,
        );
      if (getHasLostCorners(current, next)) return undefined;
      evicted = evicted.filter((step) => !ofBatch(step));
      done.splice(0, done.length, ...done.filter((step) => !ofBatch(step)));
      undone.splice(
        0,
        undone.length,
        ...undone.filter((step) => !ofBatch(step)),
      );
      return next;
    },
    // Whether any step of one batch is still in the history.
    hasBatch: getHasBatch,
    // The ids of the steps on the map now, leaving out what a redo would
    // bring back.
    getDoneIds: () => new Set([...evicted, ...done].map((step) => step.id)),
    canUndo: () => done.length > 0,
    canRedo: () => undone.length > 0,
    // Forgets every step, as when the whole map was swapped for another.
    clear() {
      done.length = 0;
      undone.length = 0;
      evicted = [];
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
