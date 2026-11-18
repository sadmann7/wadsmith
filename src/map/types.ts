type Point = { x: number; y: number };

type DoorSettings = {
  opensBy: "use" | "switch";
  closes: boolean;
  texture: string;
};

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
};

type ThingKind =
  | "player"
  | "zombieman"
  | "shotgun-guy"
  | "imp"
  | "demon"
  | "shotgun"
  | "shells"
  | "medikit";

type Thing = Point & {
  id: string;
  kind: ThingKind;
  angle: number;
};

type MapSwitch = {
  id: string;
  sector: string;
  from: string;
  to: string;
  texture: string;
  door: string | null;
};

type GameMap = {
  name?: string;
  vertices: Record<string, Point>;
  sectors: Sector[];
  things: Thing[];
  switches: MapSwitch[];
};

export type {
  DoorSettings,
  GameMap,
  MapSwitch,
  Point,
  Sector,
  Thing,
  ThingKind,
};
