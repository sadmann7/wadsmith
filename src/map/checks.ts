import { mapBalance } from "./balance";
import { thingCatalog } from "./catalog";
import { removeSwitch, removeThings, updateLine, updateSector } from "./edit";
import { fitLineAction } from "./lines";
import type { GameMap, KeyColor } from "./types";
import { activeLineActions, validateMap, type MapIssue } from "./validate";

type CheckedIssue = MapIssue & { severity: "error" | "warning" };

const defaultRoomHeight = 96;

function mapWarnings(map: GameMap): CheckedIssue[] {
  const warnings: CheckedIssue[] = [];
  const actions = activeLineActions(map);
  const usedKeys = new Set(actions.map(({ action }) => action.key));
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
  const balance = mapBalance(map, "medium");
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
  if (!hasExit(map)) {
    warnings.push({
      id: "no-exit",
      severity: "warning",
      message: "No way to finish the level",
      detail: "Add a line with an exit action",
    });
  }
  return warnings;
}

function hasExit(map: GameMap) {
  return activeLineActions(map).some(({ action }) => action.kind === "exit");
}

const buildGroups: {
  name: string;
  passed: string;
  ids: RegExp;
  needsValidRooms?: boolean;
}[] = [
  {
    name: "Closed sectors",
    passed: "Every room is closed",
    ids: /^(empty|repeat|corners|missing|area|height|twist)(:|$)/,
  },
  {
    name: "Wall sides",
    passed: "Walls connect cleanly",
    ids: /^(shared|cross|overlap|line-door|line-walk|line-target|line-tag)(:|$)/,
    needsValidRooms: true,
  },
  {
    name: "Locked doors",
    passed: "Doors and keys match",
    ids: /^(door-[a-z]+|switch-[a-z]+|line-key|key-unused)(:|$)/,
    needsValidRooms: true,
  },
  {
    name: "Player start",
    passed: "1 found",
    ids: /^(no-player|many-players|outside|in-door)(:|$)/,
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
    ids: /^(range|height-range)(:|$)/,
  },
];

// validateMap stops at the first layer of errors, so later groups stay unknown.
function buildChecks(map: GameMap) {
  const issues = checkMap(map);
  const blocked = issues.some((issue) => issue.severity === "error");
  const grouped = buildGroups.map(({ name, passed, ids, needsValidRooms }) => {
    const found = issues.filter((issue) => ids.test(issue.id));
    return {
      name,
      passed,
      issues: found,
      waiting: Boolean(needsValidRooms && blocked && found.length === 0),
    };
  });
  const known = new Set(grouped.flatMap((group) => group.issues));
  const other = issues.filter((issue) => !known.has(issue));
  return other.length === 0
    ? grouped
    : [
        ...grouped,
        { name: "Other problems", passed: "", issues: other, waiting: false },
      ];
}

function checkMap(map: GameMap): CheckedIssue[] {
  return [
    ...validateMap(map).map((issue) => ({
      ...issue,
      severity: "error" as const,
    })),
    ...mapWarnings(map),
  ];
}

function issueText({ message, detail }: MapIssue) {
  if (detail) return { title: message, detail };
  const split = message.indexOf(": ");
  if (split < 0) return { title: message, detail: "" };
  const title = message.slice(split + 2).replace(/\.$/, "");
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    detail: message.slice(0, split),
  };
}

function fixIssue(map: GameMap, { id, target }: MapIssue): GameMap | null {
  const kind = id.split(":")[0];
  if (kind === "many-players") {
    const extras = map.things.filter((thing) => thing.kind === "player");
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
  if (kind === "line-door" || kind === "line-walk") {
    const action = map.lines?.[target]?.action;
    return action
      ? updateLine(map, target, { action: fitLineAction(action, false) })
      : null;
  }
  return null;
}

export {
  buildChecks,
  checkMap,
  fixIssue,
  hasExit,
  issueText,
  mapWarnings,
  type CheckedIssue,
};
