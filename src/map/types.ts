interface Point {
  x: number;
  y: number;
}

type Complevel = "vanilla" | "boom" | "mbf" | "mbf21";

interface DoorSettings {
  opensBy: "use" | "switch";
  closes: boolean;
  fast?: boolean;
  texture: string;
}

type SectorEffect =
  | "flicker"
  | "blink"
  | "strobe-slow"
  | "strobe-fast"
  | "strobe-slow-sync"
  | "strobe-fast-sync"
  | "glow"
  | "secret"
  | "damage-5"
  | "damage-10"
  | "damage-20"
  | "damage-20-strobe"
  | "damage-20-exit"
  | "door-close-30"
  | "door-open-300";

interface Sector {
  id: string;
  name: string;
  vertices: string[];
  holes?: string[][];
  details?: string[][];
  floor: number;
  ceiling: number;
  light: number;
  floorTexture: string;
  ceilingTexture: string;
  wallTexture: string;
  wallOverrides?: Record<string, string>;
  door?: DoorSettings;
  effect?: SectorEffect;
  rawEffect?: number;
  tag?: number;
}

type LineActionKind =
  | "door-raise"
  | "door-open"
  | "door-close"
  | "door-close-wait"
  | "door-raise-fast"
  | "door-open-fast"
  | "door-close-fast"
  | "floor-lower"
  | "floor-raise"
  | "floor-raise-next"
  | "floor-lower-highest"
  | "floor-lower-fast"
  | "floor-raise-24"
  | "floor-raise-next-fast"
  | "floor-raise-texture"
  | "floor-raise-512"
  | "ceiling-lower"
  | "ceiling-lower-8"
  | "ceiling-raise"
  | "crusher"
  | "crusher-fast"
  | "crusher-silent"
  | "crusher-stop"
  | "floor-crush"
  | "stairs"
  | "stairs-fast"
  | "lift"
  | "lift-fast"
  | "exit"
  | "exit-secret"
  | "floor-raise-next-texture"
  | "floor-raise-24-texture"
  | "floor-raise-32-texture"
  | "floor-lower-texture"
  | "donut"
  | "platform"
  | "platform-stop"
  | "light-brightest"
  | "light-dimmest"
  | "light-max"
  | "light-dark"
  | "light-blink"
  | "teleport"
  | "teleport-monsters";

type LineTrigger = "door" | "switch" | "walk" | "shoot";

type KeyColor = "blue" | "yellow" | "red";

interface LineAction {
  kind: LineActionKind;
  trigger: LineTrigger;
  repeat: boolean;
  key?: KeyColor;
  tag: number;
}

interface LineSide {
  offsetX?: number;
  offsetY?: number;
  upper?: string;
  lower?: string;
  middle?: string;
}

interface RawSpecial {
  special: number;
  tag: number;
}

interface LineSettings {
  blocksAll?: boolean;
  blocksEnemies?: boolean;
  upperFixed?: boolean;
  lowerFixed?: boolean;
  hidden?: boolean;
  secret?: boolean;
  soundBlock?: boolean;
  mapped?: boolean;
  passUse?: boolean;
  solid?: boolean;
  scrolls?: boolean;
  action?: LineAction;
  raw?: RawSpecial;
  sides?: Record<string, LineSide>;
  front?: string;
}

type ThingKind =
  | "player"
  | "player-2"
  | "player-3"
  | "player-4"
  | "deathmatch-start"
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
  | "red-torch"
  | "cacodemon"
  | "hell-knight"
  | "baron-of-hell"
  | "arachnotron"
  | "revenant"
  | "mancubus"
  | "arch-vile"
  | "spider-mastermind"
  | "cyberdemon"
  | "wolfenstein-ss"
  | "commander-keen"
  | "boss-brain"
  | "chainsaw"
  | "super-shotgun"
  | "rocket-launcher"
  | "plasma-gun"
  | "bfg-9000"
  | "box-of-bullets"
  | "box-of-shells"
  | "rocket"
  | "box-of-rockets"
  | "cell"
  | "cell-pack"
  | "backpack"
  | "health-bonus"
  | "soulsphere"
  | "megasphere"
  | "armor-bonus"
  | "invulnerability"
  | "berserk"
  | "partial-invisibility"
  | "radiation-suit"
  | "computer-map"
  | "light-amplification"
  | "blue-skull-key"
  | "yellow-skull-key"
  | "red-skull-key"
  | "burning-barrel"
  | "tall-tech-lamp"
  | "short-tech-lamp"
  | "candle"
  | "candelabra"
  | "tall-blue-torch"
  | "tall-green-torch"
  | "short-blue-torch"
  | "short-green-torch"
  | "short-red-torch"
  | "tall-green-pillar"
  | "short-green-pillar"
  | "tall-red-pillar"
  | "short-red-pillar"
  | "heart-pillar"
  | "skull-pillar"
  | "brown-stump"
  | "burnt-tree"
  | "big-tree"
  | "evil-eye"
  | "floating-skulls"
  | "bloody-mess"
  | "bloody-mess-2"
  | "dead-player"
  | "dead-zombieman"
  | "dead-shotgun-guy"
  | "dead-imp"
  | "dead-demon"
  | "dead-cacodemon"
  | "dead-lost-soul"
  | "pool-of-blood"
  | "impaled-human"
  | "twitching-impaled-human"
  | "skull-on-pole"
  | "skulls-on-pole"
  | "pile-of-skulls"
  | "hanging-victim-twitching"
  | "hanging-victim-arms-out"
  | "hanging-victim-one-leg"
  | "hanging-legs"
  | "hanging-leg"
  | "hanging-victim-arms-out-2"
  | "hanging-legs-2"
  | "hanging-victim-one-leg-2"
  | "hanging-leg-2"
  | "hanging-victim-twitching-2"
  | "hanging-victim-guts"
  | "hanging-victim-guts-brain"
  | "hanging-torso-looking-down"
  | "hanging-torso-open-skull"
  | "hanging-torso-looking-up"
  | "hanging-torso-brain-removed"
  | "pool-of-blood-and-flesh"
  | "pool-of-blood-2"
  | "pool-of-brains"
  | "boss-shooter"
  | "spawn-spot"
  | "teleport-destination";

type ThingCategory = "start" | "enemy" | "item" | "key" | "decor";

type ThingSkill = "easy" | "medium" | "hard";

type Thing = Point & {
  id: string;
  kind: ThingKind;
  angle: number;
  skills?: ThingSkill[];
  ambush?: boolean;
  multiplayer?: boolean;
  notDeathmatch?: boolean;
  notCoop?: boolean;
  friendly?: boolean;
};

interface MapSwitch {
  id: string;
  sector: string;
  from: string;
  to: string;
  texture: string;
  door: string | null;
}

type MapNote = Point & { id: string; text: string };

interface GameMap {
  name?: string;
  complevel?: Complevel;
  vertices: Record<string, Point>;
  sectors: Sector[];
  things: Thing[];
  switches: MapSwitch[];
  lines?: Record<string, LineSettings>;
  notes?: MapNote[];
}

export type {
  Complevel,
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
  RawSpecial,
  Sector,
  SectorEffect,
  Thing,
  ThingCategory,
  ThingKind,
  ThingSkill,
};
