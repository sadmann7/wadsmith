import type { GameMap } from "./types";

const starterMap: GameMap = {
  vertices: {
    v1: { x: 0, y: 0 },
    v2: { x: 384, y: 0 },
    v3: { x: 384, y: 96 },
    v4: { x: 384, y: 224 },
    v5: { x: 384, y: 320 },
    v6: { x: 0, y: 320 },
    v7: { x: 512, y: 96 },
    v8: { x: 512, y: 224 },
    v9: { x: 512, y: -64 },
    v10: { x: 960, y: -64 },
    v11: { x: 960, y: 384 },
    v12: { x: 512, y: 384 },
  },
  sectors: [
    {
      id: "sector-1",
      name: "Start room",
      vertices: ["v1", "v2", "v3", "v4", "v5", "v6"],
      floor: 0,
      ceiling: 128,
      light: 176,
      floorTexture: "FLOOR4_8",
      ceilingTexture: "CEIL3_5",
      wallTexture: "STARTAN3",
    },
    {
      id: "sector-2",
      name: "Corridor",
      vertices: ["v3", "v7", "v8", "v4"],
      floor: -16,
      ceiling: 96,
      light: 128,
      floorTexture: "FLAT5_4",
      ceilingTexture: "CEIL5_1",
      wallTexture: "METAL",
    },
    {
      id: "sector-3",
      name: "Arena",
      vertices: ["v9", "v10", "v11", "v12", "v8", "v7"],
      floor: -32,
      ceiling: 192,
      light: 200,
      floorTexture: "FLOOR5_1",
      ceilingTexture: "TLITE6_4",
      wallTexture: "BROWN1",
    },
  ],
  things: [
    { id: "player-1", kind: "player", x: 96, y: 160, angle: 0 },
    { id: "shotgun-1", kind: "shotgun", x: 448, y: 160, angle: 0 },
    { id: "zombieman-1", kind: "zombieman", x: 704, y: 160, angle: 180 },
    { id: "imp-1", kind: "imp", x: 832, y: 64, angle: 180 },
  ],
};

export { starterMap };
