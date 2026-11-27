import {
  type CustomThings,
  thingCategory,
  thingLabel,
} from "@/lib/wad/custom-things";

import type { GameMap, KeyColor, Thing } from "./types";

import { mapBalance } from "./balance";
import { deathmatchStarts, thingCatalog } from "./catalog";
import { removeSwitch, removeThings, updateLine, updateSector } from "./edit";
import { findTouches, joinTouch } from "./join";
import { endsLevel, fitLineAction, triggersFor } from "./lines";
import { findStuckThings } from "./stuck";
import {
  activeLineActions,
  type CheckContext,
  inspectMap,
  lockedKeys,
  type MapIssue,
} from "./validate";

export type CheckedIssue = MapIssue & { severity: "error" | "warning" };

const defaultRoomHeight = 96;
const noCustomThings: CustomThings = new Map();
const solidLine = { twoSided: false, doorBehind: false };

export function mapWarnings(
  map: GameMap,
  custom: CustomThings = noCustomThings,
): CheckedIssue[] {
  const warnings: CheckedIssue[] = [];
  const usedKeys = lockedKeys(map);
  for (const thing of map.things) {
    const { category, label } = thingCatalog[thing.kind];
    if (
      category === "key" &&
      !usedKeys.has(thing.kind.split("-")[0] as KeyColor)
    ) {
      warnings.push({
        id: `key-unused:${thing.id}`,
        severity: "warning",
        message: "Key has no locked door",
        detail: label,
        target: thing.id,
      });
    }
  }
  // A spawner's cube flies for the time its climb takes, so a spot nearly
  // level with the spawner gets its monsters short of it, or never.
  const spawners = map.things.filter((thing) => thing.kind === "boss-shooter");
  for (const spot of map.things) {
    if (spot.kind !== "spawn-spot") continue;
    const level = spawners.some(
      (spawner) =>
        Math.abs(spot.y - spawner.y) * 16 <= Math.abs(spot.x - spawner.x),
    );
    if (level) {
      warnings.push({
        id: `spawn-level:${spot.id}`,
        severity: "warning",
        message: "Spawn spot level with the spawner",
        detail:
          "Its monsters land short of it or never arrive. Move it up or down.",
        target: spot.id,
      });
    }
  }
  const stuck = findStuckThings(map, custom);
  const named = (thing: Thing) => thingLabel(thing, custom);
  for (const [first, second] of stuck.overlaps) {
    const reach = Math.max(
      Math.abs(first.x - second.x),
      Math.abs(first.y - second.y),
    );
    warnings.push({
      id: `thing-overlap:${first.id}`,
      severity: "warning",
      message:
        named(first) === named(second)
          ? `${named(first)} overlaps another ${named(second).toLowerCase()}`
          : `${named(first)} overlaps the ${named(second).toLowerCase()}`,
      detail: `They're ${Math.round(reach)} apart and get stuck in each other in Doom. Move them apart.`,
      target: first.id,
    });
  }
  for (const { thing } of stuck.walls) {
    warnings.push({
      id: `thing-stuck:${thing.id}`,
      severity: "warning",
      message: `${named(thing)} sticks into a wall`,
      detail: starts.has(thing.kind)
        ? "The player can't move from there in Doom. Move the start away from the wall."
        : "It can't move from there in Doom. Move it away from the wall.",
      target: thing.id,
    });
  }
  const balance = mapBalance(map, "medium", custom);
  if (balance.healthShort > 0) {
    warnings.push({
      id: "low-health",
      severity: "warning",
      message: `Low health for ${balance.enemies} enemies`,
      detail: `${balance.health} pickups on this map`,
    });
  }
  if (balance.ammoShort > 0) {
    warnings.push({
      id: "low-ammo",
      severity: "warning",
      message: `Low ammo for ${balance.enemies} enemies`,
      detail: `${balance.ammo} pickups on this map`,
    });
  }
  const deathmatch = map.things.filter(
    (thing) => thing.kind === "deathmatch-start",
  );
  if (deathmatch.length > 0 && deathmatch.length < deathmatchStarts) {
    warnings.push({
      id: "deathmatch-starts",
      severity: "warning",
      message: `Deathmatch needs ${deathmatchStarts} deathmatch starts`,
      detail: `${deathmatch.length} placed`,
      target: deathmatch[0].id,
    });
  }
  const missing = coopGaps(map);
  if (missing.length > 0) {
    warnings.push({
      id: "coop-starts",
      severity: "warning",
      message: "Co-op needs a start for each player",
      detail: `${listPlayers(missing)} ${missing.length === 1 ? "has" : "have"} none`,
    });
  }
  if (!getHasExit(map) && !getIsArena(map, custom)) {
    warnings.push({
      id: "no-exit",
      severity: "warning",
      message: "No way to finish the level",
      detail: "Add a line with an exit action",
    });
  }
  return warnings;
}

export function getHasExit(map: GameMap) {
  return (
    activeLineActions(map).some(({ action }) => endsLevel(action.kind)) ||
    map.sectors.some((sector) => sector.effect === "damage-20-exit")
  );
}

// Player N only gets a start in co-op if every lower player has one too, so a
// Player 3 start with no Player 2 start is never used.
function coopGaps(map: GameMap) {
  const placed = [2, 3, 4].filter((player) =>
    map.things.some((thing) => thing.kind === `player-${player}`),
  );
  const highest = Math.max(1, ...placed);
  return [2, 3, 4].filter(
    (player) => player < highest && !placed.includes(player),
  );
}

const starts = new Set(["player", "player-2", "player-3", "player-4"]);

function listPlayers(players: number[]) {
  const names = players.map(String);
  return `Player${players.length > 1 ? "s" : ""} ${
    names.length > 1
      ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
      : names[0]
  }`;
}

// A deathmatch arena ends on the frag limit, so it needs no exit.
function getIsArena(map: GameMap, custom: CustomThings) {
  return (
    map.things.filter((thing) => thing.kind === "deathmatch-start").length >=
      deathmatchStarts &&
    !map.things.some((thing) => thingCategory(thing, custom) === "enemy")
  );
}

const buildGroups: {
  name: string;
  passed: string;
  ids: RegExp;
  needsValidRooms?: boolean;
  needsBuild?: boolean;
}[] = [
  {
    name: "Closed sectors",
    passed: "Every room is closed",
    ids: /^(empty|repeat|corners|missing|area|height|twist|pillar-area|pillar-wall|pillar-outside|pillar-overlap|line-door-room|line-short|line-length)(:|$)/,
  },
  {
    name: "Wall sides",
    passed: "Walls connect cleanly",
    ids: /^(shared|cross|overlap|same-side|pillar-inside|line-wall|line-outside|line-shared|line-door|line-walk|line-target|line-tag)(:|$)/,
    needsValidRooms: true,
  },
  {
    name: "Locked doors",
    passed: "Doors and keys match",
    ids: /^(door-[a-z]+|switch-[a-z]+|line-key|line-doorless|key-unused)(:|$)/,
    needsValidRooms: true,
  },
  {
    name: "Player start",
    passed: "1 found",
    ids: /^(no-player|many-players|outside|in-door|coop-starts|deathmatch-starts)(:|$)/,
    needsValidRooms: true,
  },
  {
    name: "Stuck things",
    passed: "Nothing stuck in a wall or another thing",
    ids: /^thing-(overlap|stuck)(:|$)/,
  },
  {
    name: "Reachable",
    passed: "The player can get everywhere",
    ids: /^unreachable(-[a-z]+)?(:|$)/,
    needsValidRooms: true,
  },
  { name: "Exit", passed: "The level can end", ids: /^no-exit(:|$)/ },
  {
    name: "Item balance",
    passed: "Enough for Medium",
    ids: /^low-[a-z]+(:|$)/,
  },
  {
    name: "Format limits",
    passed: "Within classic Doom limits",
    ids: /^(range|height-range|vanilla-[a-z]+)(:|$)/,
    needsBuild: true,
  },
  {
    name: "Compatibility",
    passed: "Nothing past the map's level",
    ids: /^(line-level|sector-level|thing-level|texture-missing|thing-game)(:|$)/,
  },
];

// validateMap stops at the first layer of errors, so later groups stay unknown.
export function buildChecks(
  map: GameMap,
  context?: CheckContext,
  limits: { issues: CheckedIssue[]; pending: boolean } = {
    issues: [],
    pending: false,
  },
) {
  const issues = [...checkMap(map, context), ...limits.issues];
  const blocked = issues.some((issue) => issue.severity === "error");
  const grouped = buildGroups.map(
    ({ name, passed, ids, needsValidRooms, needsBuild }) => {
      const found = issues.filter((issue) => ids.test(issue.id));
      return {
        name,
        passed,
        issues: found,
        waiting:
          found.length === 0 &&
          Boolean(
            (needsValidRooms && blocked) || (needsBuild && limits.pending),
          ),
        waitingText:
          needsBuild && limits.pending
            ? "Checked once the views are scanned"
            : "Checked after errors are fixed",
      };
    },
  );
  const known = new Set(grouped.flatMap((group) => group.issues));
  const other = issues.filter((issue) => !known.has(issue));
  return other.length === 0
    ? grouped
    : [
        ...grouped,
        {
          name: "Other problems",
          passed: "",
          issues: other,
          waiting: false,
          waitingText: "",
        },
      ];
}

export function checkMap(map: GameMap, context?: CheckContext): CheckedIssue[] {
  const { errors, warnings } = inspectMap(map, context);
  return [
    ...errors.map((issue) => ({ ...issue, severity: "error" as const })),
    ...warnings.map((issue) => ({ ...issue, severity: "warning" as const })),
    ...mapWarnings(map, context?.custom),
  ];
}

export function issueText({ message, detail }: MapIssue) {
  if (detail) return { title: message, detail };
  const split = message.indexOf(": ");
  if (split < 0) return { title: message, detail: "" };
  const title = message.slice(split + 2).replace(/\.$/, "");
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    detail: message.slice(0, split),
  };
}

export function fixIssue(
  map: GameMap,
  { id, target }: MapIssue,
): GameMap | null {
  const kind = id.split(":")[0];
  if (kind === "many-players") {
    const start = id.split(":")[1] ?? "player";
    const extras = map.things.filter((thing) => thing.kind === start);
    return removeThings(
      map,
      extras.slice(1).map((thing) => thing.id),
    );
  }
  if (!target) return null;
  if (kind === "height") {
    const sector = map.sectors.find((item) => item.id === target);
    return sector
      ? updateSector(map, target, { ceiling: sector.floor + defaultRoomHeight })
      : null;
  }
  if (kind === "switch-wall" || kind === "switch-open") {
    return removeSwitch(map, target);
  }
  if (kind === "unreachable-island") {
    const room = map.sectors.find((sector) => sector.id === target);
    if (!room) return null;
    const other = id.split(":")[2];
    const touch = findTouches(map, room).find(
      (item) => item.other.id === other,
    );
    return touch ? joinTouch(map, touch) : null;
  }
  if (kind === "line-door" || kind === "line-walk") {
    const action = map.lines?.[target]?.action;
    if (!action) return null;
    return updateLine(map, target, {
      action:
        triggersFor(action.kind, solidLine).length > 0
          ? fitLineAction(action, solidLine)
          : undefined,
    });
  }
  return null;
}
