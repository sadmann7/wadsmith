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

type ActionDefinition = {
  label: string;
  triggers: Partial<Record<LineTrigger, Specials>>;
  keys?: Partial<Record<LineTrigger, Record<KeyColor, Specials>>>;
};

const lineActions: Record<LineActionKind, ActionDefinition> = {
  "door-raise": {
    label: "Door: open, wait, close",
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
    triggers: {
      switch: { once: 50, repeat: 42 },
      walk: { once: 3, repeat: 75 },
    },
  },
  "floor-lower": {
    label: "Floor: lower to lowest",
    triggers: {
      switch: { once: 23, repeat: 60 },
      walk: { once: 38, repeat: 82 },
    },
  },
  "floor-raise": {
    label: "Floor: raise to ceiling",
    triggers: {
      switch: { once: 101, repeat: 64 },
      walk: { once: 5, repeat: 91 },
      shoot: { once: 24 },
    },
  },
  "floor-raise-next": {
    label: "Floor: raise to next floor",
    triggers: {
      switch: { once: 18, repeat: 69 },
      walk: { once: 119, repeat: 128 },
    },
  },
  lift: {
    label: "Lift: lower, wait, raise",
    triggers: {
      switch: { once: 21, repeat: 62 },
      walk: { once: 10, repeat: 88 },
    },
  },
  exit: {
    label: "End the level",
    triggers: { switch: { once: 11 }, walk: { once: 52 } },
  },
};

const lineActionKinds = Object.keys(lineActions) as LineActionKind[];
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

function lineUsesTag({ kind, trigger }: LineAction) {
  return kind !== "exit" && trigger !== "door";
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
  const trigger = triggers.includes(action.trigger)
    ? action.trigger
    : triggers[0];
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

function frontOwner(owners: Sector[]) {
  return owners.find((sector) => !sector.door) ?? owners[0];
}

function describeLine(map: GameMap, wall: string, sectorId: string) {
  const entries = [...wallOwners(map)];
  const owners = entries.find(([key]) => key === wall)?.[1] ?? [];
  const front = frontOwner(owners);
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
  describeLine,
  fitLineAction,
  isLineActionKind,
  keyColors,
  keysFor,
  lineActionKinds,
  lineActions,
  lineSpecial,
  lineTriggers,
  lineUsesTag,
  newLineAction,
  triggerLabels,
  triggersFor,
};
