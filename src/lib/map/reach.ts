import type { GameMap, LineActionKind, Sector } from "./types";

import { sectorAt, wallOwners } from "./geometry";
import {
  actionForSpecial,
  getIsTeleport,
  lineUsesTag,
  movesSector,
} from "./lines";

// The rooms a player can walk into from the player start. A room that a door,
// lift or other action could move counts as open on every side, and a
// teleporter the player can reach leads to every room with its tag, so only
// rooms that stay shut whatever the player does are left out.
export function reachableRooms(map: GameMap) {
  const start = map.things.find((thing) => thing.kind === "player");
  const first = start && sectorAt(map, start);
  if (!first) return null;
  const moving = movingRooms(map);
  const exits = new Map<Sector, Sector[]>();
  const leads = new Map<Sector, number[]>();
  const owners = wallOwners(map);
  for (const [wall, [a, b]] of owners) {
    const line = map.lines?.[wall];
    for (const tag of teleportTags(line)) {
      for (const room of [a, b]) {
        if (room) leads.set(room, [...(leads.get(room) ?? []), tag]);
      }
    }
    if (!a || !b || a === b || line?.blocksAll) continue;
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      if (moving.has(from) || moving.has(to) || getIsWalkable(from, to)) {
        exits.set(from, [...(exits.get(from) ?? []), to]);
      }
    }
  }
  const reached = new Set<Sector>();
  const queue = [first];
  for (const room of queue) {
    if (reached.has(room)) continue;
    reached.add(room);
    queue.push(...(exits.get(room) ?? []));
    for (const tag of leads.get(room) ?? []) {
      queue.push(...map.sectors.filter((sector) => sector.tag === tag));
    }
  }
  return reached;
}

const maxStep = 24;
const playerHeight = 56;

function getIsWalkable(from: Sector, to: Sector) {
  const top = Math.max(from.floor, to.floor);
  return (
    to.floor - from.floor <= maxStep &&
    Math.min(from.ceiling, to.ceiling) - top >= playerHeight
  );
}

// A raw special the editor can't name may teleport, so it counts as one.
function teleportTags(line: NonNullable<GameMap["lines"]>[string] | undefined) {
  const tags: number[] = [];
  const { action, raw } = line ?? {};
  if (
    action &&
    getIsTeleport(action.kind) &&
    action.kind !== "teleport-monsters" &&
    action.tag > 0
  ) {
    tags.push(action.tag);
  }
  if (raw && raw.special > 0 && raw.tag > 0) {
    const kind = actionForSpecial(raw.special)?.kind;
    if (!kind || getIsTeleport(kind)) tags.push(raw.tag);
  }
  return tags;
}

// Stairs build on from the tagged room through rooms with the same floor, and
// a donut moves the ring around the tagged room, so both reach past the tag.
function movingRooms(map: GameMap) {
  const moving = new Set<Sector>();
  const tagged = (tag: number) =>
    map.sectors.filter((sector) => sector.tag === tag);
  const around = new Map<Sector, Sector[]>();
  const owners = wallOwners(map);
  for (const [a, b] of owners.values()) {
    if (!a || !b || a === b) continue;
    around.set(a, [...(around.get(a) ?? []), b]);
    around.set(b, [...(around.get(b) ?? []), a]);
  }
  const moveTag = (tag: number, kind: LineActionKind | undefined) => {
    const rooms = tagged(tag);
    for (const room of rooms) moving.add(room);
    if (kind === "donut") {
      for (const room of rooms) {
        for (const next of around.get(room) ?? []) moving.add(next);
      }
    } else if (!kind || kind === "stairs" || kind === "stairs-fast") {
      const queue = [...rooms];
      for (const room of queue) {
        for (const next of around.get(room) ?? []) {
          if (moving.has(next) || next.floorTexture !== room.floorTexture) {
            continue;
          }
          moving.add(next);
          queue.push(next);
        }
      }
    }
  };
  for (const sector of map.sectors) {
    if (
      sector.door ||
      sector.effect === "door-close-30" ||
      sector.effect === "door-open-300"
    ) {
      moving.add(sector);
    }
  }
  for (const [wall, { action, raw }] of Object.entries(map.lines ?? {})) {
    const sides = owners.get(wall) ?? [];
    if (action && movesSector(action.kind)) {
      if (!lineUsesTag(action)) for (const room of sides) moving.add(room);
      else if (action.tag > 0) moveTag(action.tag, action.kind);
    }
    if (raw && raw.special > 0) {
      const kind = actionForSpecial(raw.special)?.kind;
      if (raw.tag > 0) moveTag(raw.tag, kind);
      for (const room of sides) moving.add(room);
    }
  }
  return moving;
}
