import type { MouseMode } from "@/lib/engine/mouse-capture";
import type { Skill } from "@/lib/engine/runtime";
import type { GameMap, KeyColor, Point, Thing } from "@/lib/map/types";

import { minimapSpan } from "@/lib/engine/runtime";
import { keyThings } from "@/lib/map/catalog";
import { sectorAt, wallOwners } from "@/lib/map/geometry";
import { actionForSpecial, endsLevel, getIsTeleport } from "@/lib/map/lines";

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

export function heldKeys(bits: number): HeldKey[] {
  return [false, true].flatMap((skull) =>
    keyColors
      .map((color) => ({ color, skull }))
      .filter((key) => bits & keyBit(key)),
  );
}

// Lines the way Doom's automap draws them: solid walls, changes in floor or
// ceiling height, doors in their key's color and the exit. Lines between
// rooms of the same height, lines marked hidden and the walls of rooms in
// `hidden` are left out, and a secret line reads as a plain wall.
export function minimapLines(
  map: GameMap,
  hidden: ReadonlySet<string> = new Set(),
): MinimapLine[] {
  const lines: MinimapLine[] = [];
  for (const [key, owners] of wallOwners(map)) {
    const settings = map.lines?.[key];
    if (settings?.hidden) continue;
    if (owners.every((owner) => hidden.has(owner.id))) continue;
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

// Secret rooms, by their effect or because player 1 can only reach them
// through a line marked secret, in groups that open onto each other. The
// minimap keeps each group hidden until the player stands in it.
export function secretAreas(map: GameMap): string[][] {
  const start = map.things.find((thing) => thing.kind === "player");
  const first = start ? sectorAt(map, start) : undefined;
  if (!first) return [];
  const links = new Map<string, string[]>();
  const link = (from: string, to: string) =>
    links.set(from, [...(links.get(from) ?? []), to]);
  const behindSecret = new Set<string>();
  for (const [key, owners] of wallOwners(map)) {
    const settings = map.lines?.[key];
    const action =
      settings?.action ??
      (settings?.raw?.special
        ? actionForSpecial(settings.raw.special, settings.raw.tag)
        : undefined);
    if (
      action &&
      getIsTeleport(action.kind) &&
      action.kind !== "teleport-monsters" &&
      action.tag > 0
    ) {
      for (const sector of map.sectors) {
        if (sector.tag !== action.tag) continue;
        for (const owner of owners) link(owner.id, sector.id);
      }
    }
    const [a, b] = owners;
    if (!a || !b || a.id === b.id) continue;
    if (settings?.secret) {
      behindSecret.add(a.id).add(b.id);
    } else {
      link(a.id, b.id);
      link(b.id, a.id);
    }
  }
  const spread = (from: string, seen: Set<string>, within?: Set<string>) => {
    const queue = [from];
    seen.add(from);
    for (const id of queue) {
      for (const next of links.get(id) ?? []) {
        if (seen.has(next) || (within && !within.has(next))) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return queue;
  };
  const reached = spread(first.id, new Set());
  const secret = new Set(
    map.sectors
      .filter((sector) => sector.effect === "secret")
      .map((sector) => sector.id),
  );
  const visited = new Set(reached);
  for (const id of behindSecret) {
    if (!visited.has(id))
      for (const each of spread(id, visited)) secret.add(each);
  }
  const backLinks = [...links].flatMap(([from, targets]) =>
    targets
      .filter((to) => secret.has(from) && secret.has(to))
      .map((to) => [to, from]),
  );
  for (const [to, from] of backLinks) link(to, from);
  const grouped = new Set<string>();
  return [...secret].flatMap((id) =>
    grouped.has(id) ? [] : [spread(id, grouped, secret)],
  );
}

interface KeyGame {
  skill: Skill;
  mode: GameMode;
}

// Keys still lying in the level. A key the player holds is left out, since
// picking it up is what took it off the floor.
export function minimapKeys(
  map: GameMap,
  held: number,
  { skill, mode }: KeyGame,
): MinimapKey[] {
  return map.things.flatMap((thing) => {
    if (!spawnsIn(thing, skill, mode)) return [];
    const color = keyColors.find((each) =>
      keyThings[each].includes(thing.kind),
    );
    if (!color) return [];
    const skull = thing.kind.endsWith("skull-key");
    if (held & keyBit({ color, skull })) return [];
    return [{ id: thing.id, x: thing.x, y: thing.y, color, skull }];
  });
}

export type GameMode = "solo" | "coop" | "deathmatch";

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

// Doom never spawns a key in deathmatch.
function spawnsIn(thing: Thing, skill: Skill, mode: GameMode) {
  if (mode === "deathmatch") return false;
  if (thing.skills && !thing.skills.includes(skill)) return false;
  return mode === "solo" ? !thing.multiplayer : !thing.notCoop;
}

// Bits as the engine reports them: the three keycards, then the three skull
// keys, each in Doom's blue, yellow, red order.
function keyBit({ color, skull }: HeldKey) {
  return 1 << (keyColors.indexOf(color) + (skull ? keyColors.length : 0));
}
