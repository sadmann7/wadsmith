type Point = { x: number; y: number };

type DoorSettings = {
  opensBy: "use" | "switch";
  closes: boolean;
  texture: string;
};

type SectorEffect =
  | "flicker"
  | "blink"
  | "strobe-slow"
  | "strobe-fast"
  | "glow"
  | "secret"
  | "damage-5"
  | "damage-10"
  | "damage-20";

type Sector = {
  id: string;
  name: string;
  vertices: string[];
  floor: number;
  ceiling: number;
  light: number;
  floorTexture: string;
  ceilingTexture: string;
  wallTexture: string;
  wallOverrides?: Record<string, string>;
  door?: DoorSettings;
  effect?: SectorEffect;
  tag?: number;
};

type LineActionKind =
  | "door-raise"
  | "door-open"
  | "door-close"
  | "floor-lower"
  | "floor-raise"
  | "floor-raise-next"
  | "lift"
  | "exit";

type LineTrigger = "door" | "switch" | "walk" | "shoot";

type KeyColor = "blue" | "yellow" | "red";

type LineAction = {
  kind: LineActionKind;
  trigger: LineTrigger;
  repeat: boolean;
  key?: KeyColor;
  tag: number;
};

type LineSide = {
  offsetX?: number;
  offsetY?: number;
  upper?: string;
  lower?: string;
};

type LineSettings = {
  blocksAll?: boolean;
  blocksEnemies?: boolean;
  upperFixed?: boolean;
  lowerFixed?: boolean;
  hidden?: boolean;
  action?: LineAction;
  sides?: Record<string, LineSide>;
};

type ThingKind =
  | "player"
  | "player-2"
  | "player-3"
  | "player-4"
  | "imp"
  | "zombieman"
  | "shotgun-guy"
  | "demon"
  | "spectre"
  | "lost-soul"
  | "chaingunner"
  | "pain-elemental"
  | "shotgun"
  | "chaingun"
  | "clip"
  | "shells"
  | "stimpack"
  | "medikit"
  | "green-armor"
  | "blue-armor"
  | "blue-key"
  | "yellow-key"
  | "red-key"
  | "barrel"
  | "lamp"
  | "tech-column"
  | "red-torch";

type ThingCategory = "start" | "enemy" | "item" | "key" | "decor";

type ThingSkill = "easy" | "medium" | "hard";

type Thing = Point & {
  id: string;
  kind: ThingKind;
  angle: number;
  skills?: ThingSkill[];
  ambush?: boolean;
};

type MapSwitch = {
  id: string;
  sector: string;
  from: string;
  to: string;
  texture: string;
  door: string | null;
};

type MapNote = Point & { id: string; text: string };

type GameMap = {
  name?: string;
  vertices: Record<string, Point>;
  sectors: Sector[];
  things: Thing[];
  switches: MapSwitch[];
  lines?: Record<string, LineSettings>;
  notes?: MapNote[];
};

export type {
  DoorSettings,
  GameMap,
  KeyColor,
  LineAction,
  LineActionKind,
  LineSettings,
  LineSide,
  LineTrigger,
  MapNote,
  MapSwitch,
  Point,
  Sector,
  SectorEffect,
  Thing,
  ThingCategory,
  ThingKind,
  ThingSkill,
};
