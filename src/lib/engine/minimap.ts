import type { MouseMode } from "@/lib/engine/mouse-capture";
import type { GameMap, KeyColor, Point } from "@/lib/map/types";

import { keyThings } from "@/lib/map/catalog";
import { wallOwners } from "@/lib/map/geometry";
import { actionForSpecial, endsLevel } from "@/lib/map/lines";

// The minimap shows a square this many map units across, centered on the
// player, and the engine reports monsters out to its corners.
export const minimapSpan = 1024;
export const monsterRange = Math.ceil((minimapSpan / 2) * Math.SQRT2);

export type MinimapLineKind = "wall" | "step" | "door" | "exit";

export interface MinimapLine {
  key: string;
  from: Point;
  to: Point;
  kind: MinimapLineKind;
  lock?: KeyColor;
}

export interface MinimapKey {
  id: string;
  x: number;
  y: number;
  color: KeyColor;
  skull: boolean;
}

export interface HeldKey {
  color: KeyColor;
  skull: boolean;
}

const keyColors: KeyColor[] = ["blue", "yellow", "red"];

// Bits as the engine reports them: the three keycards, then the three skull
// keys, each in Doom's blue, yellow, red order.
function keyBit({ color, skull }: HeldKey) {
  return 1 << (keyColors.indexOf(color) + (skull ? keyColors.length : 0));
}

export function heldKeys(bits: number): HeldKey[] {
  return [false, true].flatMap((skull) =>
    keyColors
      .map((color) => ({ color, skull }))
      .filter((key) => bits & keyBit(key)),
  );
}

// Lines the way Doom's automap draws them: solid walls, changes in floor or
// ceiling height, doors in their key's color and the exit. Lines between
// rooms of the same height, and lines marked hidden, are left out, and a
// secret line reads as a plain wall.
export function minimapLines(map: GameMap): MinimapLine[] {
  const lines: MinimapLine[] = [];
  for (const [key, owners] of wallOwners(map)) {
    const settings = map.lines?.[key];
    if (settings?.hidden) continue;
    const [from, to] = key.split("|").map((id) => map.vertices[id]);
    if (!from || !to) continue;
    const action =
      settings?.action ??
      (settings?.raw?.special
        ? actionForSpecial(settings.raw.special, settings.raw.tag)
        : undefined);
    const door = owners.find((owner) => owner.door)?.door;
    const lock = action?.key ?? door?.key;
    const [first] = owners;
    let kind: MinimapLineKind;
    if (action && endsLevel(action.kind)) {
      kind = "exit";
    } else if (owners.length < 2 || settings?.secret) {
      kind = "wall";
    } else if (door || lock) {
      kind = "door";
    } else if (
      owners.some(
        (owner) =>
          owner.floor !== first.floor || owner.ceiling !== first.ceiling,
      )
    ) {
      kind = "step";
    } else {
      continue;
    }
    lines.push(
      kind === "door" && lock
        ? { key, from, to, kind, lock }
        : { key, from, to, kind },
    );
  }
  return lines;
}

// Keys still lying in the level. A key the player holds is left out, since
// picking it up is what took it off the floor.
export function minimapKeys(map: GameMap, held: number): MinimapKey[] {
  return map.things.flatMap((thing) => {
    const color = keyColors.find((each) =>
      keyThings[each].includes(thing.kind),
    );
    if (!color) return [];
    const skull = thing.kind.endsWith("skull-key");
    if (held & keyBit({ color, skull })) return [];
    return [{ id: thing.id, x: thing.x, y: thing.y, color, skull }];
  });
}

// The engine is y-up and the map is y-down.
export function fromEngine({ x, y }: Point): Point {
  return { x, y: 0 - y };
}

export function minimapView(center: Point, span = minimapSpan) {
  return {
    x: center.x - span / 2,
    y: center.y - span / 2,
    width: span,
    height: span,
  };
}

export function isInView(
  point: Point,
  view: ReturnType<typeof minimapView>,
  margin = 0,
) {
  return (
    point.x >= view.x - margin &&
    point.x <= view.x + view.width + margin &&
    point.y >= view.y - margin &&
    point.y <= view.y + view.height + margin
  );
}

interface CrosshairState {
  enabled: boolean;
  mouseMode: MouseMode;
  inLevel: boolean;
  health: number;
  automap: boolean;
  covered: boolean;
}

// The dot only helps while the mouse aims: not while it's released, on the
// automap, after death or under a panel in the middle of the view.
export function showsCrosshair({
  enabled,
  mouseMode,
  inLevel,
  health,
  automap,
  covered,
}: CrosshairState) {
  return (
    enabled &&
    mouseMode === "locked" &&
    inLevel &&
    health > 0 &&
    !automap &&
    !covered
  );
}
