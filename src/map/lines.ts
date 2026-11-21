import { wallKey, wallOwners } from "./geometry";
import type {
  GameMap,
  KeyColor,
  LineAction,
  LineActionKind,
  LineTrigger,
  Sector,
} from "./types";

type Specials = { once?: number; repeat?: number };

type ActionGroup =
  | "Doors"
  | "Floors"
  | "Ceilings"
  | "Lifts"
  | "Platforms"
  | "Crushers"
  | "Stairs"
  | "Teleporters"
  | "Lights"
  | "Level";

type ActionDefinition = {
  label: string;
  group: ActionGroup;
  target?: string;
  triggers: Partial<Record<LineTrigger, Specials>>;
  keys?: Partial<Record<LineTrigger, Record<KeyColor, Specials>>>;
};

const lineActions: Record<LineActionKind, ActionDefinition> = {
  "door-raise": {
    label: "Door: open, wait, close",
    group: "Doors",
    triggers: {
      door: { repeat: 1 },
      switch: { once: 29, repeat: 63 },
      walk: { once: 4, repeat: 90 },
    },
    keys: {
      door: {
        blue: { repeat: 26 },
        yellow: { repeat: 27 },
        red: { repeat: 28 },
      },
    },
  },
  "door-open": {
    label: "Door: open and stay",
    group: "Doors",
    triggers: {
      door: { once: 31 },
      switch: { once: 103, repeat: 61 },
      walk: { once: 2, repeat: 86 },
      shoot: { repeat: 46 },
    },
    keys: {
      door: { blue: { once: 32 }, yellow: { once: 34 }, red: { once: 33 } },
      switch: {
        blue: { once: 133, repeat: 99 },
        yellow: { once: 137, repeat: 136 },
        red: { once: 135, repeat: 134 },
      },
    },
  },
  "door-close": {
    label: "Door: close",
    group: "Doors",
    triggers: {
      switch: { once: 50, repeat: 42 },
      walk: { once: 3, repeat: 75 },
    },
  },
  "door-close-wait": {
    label: "Door: close, wait, open",
    group: "Doors",
    triggers: { walk: { once: 16, repeat: 76 } },
  },
  "door-raise-fast": {
    label: "Door: open fast, wait, close",
    group: "Doors",
    triggers: {
      door: { repeat: 117 },
      switch: { once: 111, repeat: 114 },
      walk: { once: 108, repeat: 105 },
    },
  },
  "door-open-fast": {
    label: "Door: open fast and stay",
    group: "Doors",
    triggers: {
      door: { once: 118 },
      switch: { once: 112, repeat: 115 },
      walk: { once: 109, repeat: 106 },
    },
  },
  "door-close-fast": {
    label: "Door: close fast",
    group: "Doors",
    triggers: {
      switch: { once: 113, repeat: 116 },
      walk: { once: 110, repeat: 107 },
    },
  },
  "floor-lower": {
    label: "Floor: lower to lowest",
    group: "Floors",
    triggers: {
      switch: { once: 23, repeat: 60 },
      walk: { once: 38, repeat: 82 },
    },
  },
  "floor-raise": {
    label: "Floor: raise to ceiling",
    group: "Floors",
    triggers: {
      switch: { once: 101, repeat: 64 },
      walk: { once: 5, repeat: 91 },
      shoot: { once: 24 },
    },
  },
  "floor-raise-next": {
    label: "Floor: raise to next floor",
    group: "Floors",
    triggers: {
      switch: { once: 18, repeat: 69 },
      walk: { once: 119, repeat: 128 },
    },
  },
  "floor-raise-next-fast": {
    label: "Floor: raise fast to next floor",
    group: "Floors",
    triggers: {
      switch: { once: 131, repeat: 132 },
      walk: { once: 130, repeat: 129 },
    },
  },
  "floor-raise-24": {
    label: "Floor: raise by 24",
    group: "Floors",
    triggers: { walk: { once: 58, repeat: 92 } },
  },
  "floor-raise-texture": {
    label: "Floor: raise by its shortest lower wall",
    group: "Floors",
    triggers: { walk: { once: 30, repeat: 96 } },
  },
  "floor-raise-512": {
    label: "Floor: raise by 512",
    group: "Floors",
    triggers: { switch: { once: 140 } },
  },
  "floor-lower-highest": {
    label: "Floor: lower to highest nearby floor",
    group: "Floors",
    triggers: {
      switch: { once: 102, repeat: 45 },
      walk: { once: 19, repeat: 83 },
    },
  },
  "floor-lower-fast": {
    label: "Floor: lower fast to 8 above nearby floor",
    group: "Floors",
    triggers: {
      switch: { once: 71, repeat: 70 },
      walk: { once: 36, repeat: 98 },
    },
  },
  "ceiling-lower": {
    label: "Ceiling: lower to floor",
    group: "Ceilings",
    triggers: { switch: { once: 41, repeat: 43 } },
  },
  "ceiling-lower-8": {
    label: "Ceiling: lower to 8 above floor",
    group: "Ceilings",
    triggers: { walk: { once: 44, repeat: 72 } },
  },
  "ceiling-raise": {
    label: "Ceiling: raise to highest, floor: lower to lowest",
    group: "Ceilings",
    triggers: { walk: { once: 40 } },
  },
  lift: {
    label: "Lift: lower, wait, raise",
    group: "Lifts",
    triggers: {
      switch: { once: 21, repeat: 62 },
      walk: { once: 10, repeat: 88 },
    },
  },
  "lift-fast": {
    label: "Lift: fast lower, wait, raise",
    group: "Lifts",
    triggers: {
      switch: { once: 122, repeat: 123 },
      walk: { once: 121, repeat: 120 },
    },
  },
  crusher: {
    label: "Crusher: start",
    group: "Crushers",
    triggers: {
      switch: { once: 49 },
      walk: { once: 25, repeat: 73 },
    },
  },
  "crusher-fast": {
    label: "Crusher: start fast",
    group: "Crushers",
    triggers: { walk: { once: 6, repeat: 77 } },
  },
  "crusher-silent": {
    label: "Crusher: start silent",
    group: "Crushers",
    triggers: { walk: { once: 141 } },
  },
  "crusher-stop": {
    label: "Crusher: stop",
    group: "Crushers",
    triggers: { walk: { once: 57, repeat: 74 } },
  },
  "floor-crush": {
    label: "Crusher: raise floor and crush",
    group: "Crushers",
    triggers: {
      switch: { once: 55, repeat: 65 },
      walk: { once: 56, repeat: 94 },
    },
  },
  stairs: {
    label: "Stairs: build up by 8",
    group: "Stairs",
    triggers: { switch: { once: 7 }, walk: { once: 8 } },
  },
  "stairs-fast": {
    label: "Stairs: build up fast by 16",
    group: "Stairs",
    triggers: { switch: { once: 127 }, walk: { once: 100 } },
  },
  exit: {
    label: "End the level",
    group: "Level",
    triggers: { switch: { once: 11 }, walk: { once: 52 } },
  },
  "floor-raise-next-texture": {
    label: "Floor: raise to next floor and take its texture",
    group: "Floors",
    triggers: {
      switch: { once: 20, repeat: 68 },
      walk: { once: 22, repeat: 95 },
      shoot: { once: 47 },
    },
  },
  "floor-raise-24-texture": {
    label: "Floor: raise by 24 and take the texture",
    group: "Floors",
    triggers: {
      switch: { once: 15, repeat: 66 },
      walk: { once: 59, repeat: 93 },
    },
  },
  "floor-raise-32-texture": {
    label: "Floor: raise by 32 and take the texture",
    group: "Floors",
    triggers: { switch: { once: 14, repeat: 67 } },
  },
  "floor-lower-texture": {
    label: "Floor: lower to lowest and take the texture",
    group: "Floors",
    triggers: { walk: { once: 37, repeat: 84 } },
  },
  donut: {
    label: "Floor: lower the middle and raise the ring around it",
    group: "Floors",
    triggers: { switch: { once: 9 } },
  },
  platform: {
    label: "Platform: move up and down",
    group: "Platforms",
    triggers: { walk: { once: 53, repeat: 87 } },
  },
  "platform-stop": {
    label: "Platform: stop",
    group: "Platforms",
    triggers: { walk: { once: 54, repeat: 89 } },
  },
  "exit-secret": {
    label: "Go to the secret level",
    group: "Level",
    triggers: { switch: { once: 51 }, walk: { once: 124 } },
  },
  "light-brightest": {
    label: "Light: match the brightest nearby",
    group: "Lights",
    triggers: { walk: { once: 12, repeat: 80 } },
  },
  "light-dimmest": {
    label: "Light: match the dimmest nearby",
    group: "Lights",
    triggers: { walk: { once: 104 } },
  },
  "light-max": {
    label: "Light: full brightness",
    group: "Lights",
    triggers: { switch: { repeat: 138 }, walk: { once: 13, repeat: 81 } },
  },
  "light-dark": {
    label: "Light: turn off",
    group: "Lights",
    triggers: { switch: { repeat: 139 }, walk: { once: 35, repeat: 79 } },
  },
  "light-blink": {
    label: "Light: start blinking",
    group: "Lights",
    triggers: { walk: { once: 17 } },
  },
  teleport: {
    label: "Teleport",
    group: "Teleporters",
    target: "Teleports to",
    triggers: { walk: { once: 39, repeat: 97 } },
  },
  "teleport-monsters": {
    label: "Teleport monsters only",
    group: "Teleporters",
    target: "Teleports to",
    triggers: { walk: { once: 125, repeat: 126 } },
  },
};

const lineActionKinds = Object.keys(lineActions) as LineActionKind[];
const actionGroups: ActionGroup[] = [
  "Doors",
  "Floors",
  "Ceilings",
  "Lifts",
  "Platforms",
  "Crushers",
  "Stairs",
  "Teleporters",
  "Lights",
  "Level",
];

function lineActionGroups(kinds: LineActionKind[]) {
  return actionGroups.flatMap((group) => {
    const items = kinds
      .filter((kind) => lineActions[kind].group === group)
      .map((kind) => {
        const { label } = lineActions[kind];
        const rest = label.replace(/^[A-Z][a-z]+: /, "");
        return {
          value: kind,
          label,
          short: rest === label ? label : rest[0].toUpperCase() + rest.slice(1),
        };
      });
    return items.length > 0 ? [{ label: group, items }] : [];
  });
}
const lineTriggers: LineTrigger[] = ["door", "switch", "walk", "shoot"];
const keyColors: KeyColor[] = ["blue", "yellow", "red"];

const triggerLabels: Record<LineTrigger, string> = {
  door: "Press door",
  switch: "Press switch",
  walk: "Walk over",
  shoot: "Shoot",
};

function isLineActionKind(value: unknown): value is LineActionKind {
  return typeof value === "string" && Object.hasOwn(lineActions, value);
}

function specialsOf({ kind, trigger, key }: LineAction) {
  const action = lineActions[kind];
  return key ? action.keys?.[trigger]?.[key] : action.triggers[trigger];
}

function lineSpecial(action: LineAction) {
  const specials = specialsOf(action);
  return (action.repeat ? specials?.repeat : specials?.once) ?? null;
}

function endsLevel(kind: LineActionKind) {
  return kind === "exit" || kind === "exit-secret";
}

function movesSector(kind: LineActionKind) {
  const { group } = lineActions[kind];
  return group !== "Level" && group !== "Lights";
}

function lineUsesTag({ kind, trigger }: LineAction) {
  return !endsLevel(kind) && trigger !== "door";
}

function opensDoor(kind: LineActionKind) {
  return (
    kind === "door-raise" ||
    kind === "door-open" ||
    kind === "door-raise-fast" ||
    kind === "door-open-fast"
  );
}

function closesDoor(kind: LineActionKind) {
  return kind === "door-raise" || kind === "door-raise-fast";
}

function isFast(kind: LineActionKind) {
  return kind.endsWith("-fast");
}

// The engine ignores a press from a line's back and a teleporter crossed from
// its back.
function usedFromFront({ kind, trigger }: LineAction) {
  return (
    trigger === "door" ||
    trigger === "switch" ||
    kind === "teleport" ||
    kind === "teleport-monsters"
  );
}

function canRepeatChoice(action: LineAction) {
  const specials = specialsOf(action);
  return specials?.once !== undefined && specials.repeat !== undefined;
}

// The engine stops on a press-to-open door with no sector behind it.
function triggersFor(kind: LineActionKind, twoSided: boolean) {
  return lineTriggers.filter(
    (trigger) =>
      lineActions[kind].triggers[trigger] &&
      (twoSided || (trigger !== "door" && trigger !== "walk")),
  );
}

function keysFor(kind: LineActionKind, trigger: LineTrigger) {
  return lineActions[kind].keys?.[trigger] ? keyColors : [];
}

function fitLineAction(action: LineAction, twoSided: boolean): LineAction {
  const triggers = triggersFor(action.kind, twoSided);
  // With no trigger the line allows, the action keeps one of its own, so it
  // still saves and the map check can point at it.
  const trigger = triggers.includes(action.trigger)
    ? action.trigger
    : (triggers[0] ??
      (Object.keys(lineActions[action.kind].triggers)[0] as LineTrigger));
  const key = keysFor(action.kind, trigger).includes(action.key as KeyColor)
    ? action.key
    : undefined;
  const fitted = { ...action, trigger, key };
  const specials = specialsOf(fitted);
  return {
    ...fitted,
    repeat:
      specials?.once === undefined ||
      (action.repeat && specials.repeat !== undefined),
  };
}

function newLineAction(twoSided: boolean, kind: LineActionKind): LineAction {
  return fitLineAction(
    { kind, trigger: "door", repeat: true, tag: 0 },
    twoSided,
  );
}

// The engine only uses a switch or a teleporter from the line's front side.
function frontOwner(owners: Sector[], front?: string) {
  return (
    owners.find((sector) => sector.id === front && !sector.door) ??
    owners.find((sector) => !sector.door) ??
    owners[0]
  );
}

function describeLine(
  map: GameMap,
  wall: string,
  sectorId: string,
  entries = [...wallOwners(map)],
) {
  const owners = entries.find(([key]) => key === wall)?.[1] ?? [];
  const front = frontOwner(owners, map.lines?.[wall]?.front);
  const back = owners.find((sector) => sector !== front) ?? null;
  const [from, to] = wall.split("|").map((id) => map.vertices[id]);
  const mapSwitch =
    map.switches.find((item) => wallKey(item.from, item.to) === wall) ?? null;
  return {
    wall,
    number: entries.findIndex(([key]) => key === wall) + 1,
    length: Math.round(Math.hypot(to.x - from.x, to.y - from.y)),
    twoSided: back !== null,
    front,
    back,
    isBack: back?.id === sectorId,
    sector: owners.find((sector) => sector.id === sectorId) ?? front,
    settings: map.lines?.[wall] ?? {},
    mapSwitch,
    wiredSwitch: Boolean(
      mapSwitch &&
      map.sectors.find((sector) => sector.id === mapSwitch.door)?.door,
    ),
  };
}

export {
  canRepeatChoice,
  closesDoor,
  describeLine,
  endsLevel,
  fitLineAction,
  isFast,
  isLineActionKind,
  keyColors,
  keysFor,
  lineActionGroups,
  lineActionKinds,
  lineActions,
  lineSpecial,
  lineTriggers,
  lineUsesTag,
  movesSector,
  newLineAction,
  opensDoor,
  triggerLabels,
  triggersFor,
  usedFromFront,
};
