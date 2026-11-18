type Point = { x: number; y: number };

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

type GameMap = {
  vertices: Record<string, Point>;
  sectors: Sector[];
  things: Thing[];
};

export type { GameMap, Point, Sector, Thing, ThingKind };
