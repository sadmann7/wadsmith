import type { GameMap, LineSettings } from "./types";

import {
  buildMap,
  type Corner,
  rect,
  type RoomSpec,
} from "./featured/build-map";

const outline = (points: Corner[], texture: string) =>
  points.map((corner, index) => ({
    wall: [corner, points[(index + 1) % points.length]] as [Corner, Corner],
    texture,
  }));

const desk = rect(512, 112, 96, 96);
const crates = [rect(1296, 144, 64, 64), rect(1424, 272, 64, 64)];

const rooms: RoomSpec[] = [
  {
    name: "Landing",
    points: rect(0, 0, 384, 320),
    floor: 0,
    ceiling: 160,
    light: 160,
    floorTexture: "FLOOR4_8",
    ceilingTexture: "CEIL3_5",
    wallTexture: "STARTAN3",
  },
  {
    name: "Landing light",
    points: rect(128, 96, 128, 128),
    floor: 0,
    ceiling: 176,
    light: 200,
    floorTexture: "FLOOR4_8",
    ceilingTexture: "TLITE6_4",
    wallTexture: "STARTAN3",
  },
  {
    name: "Landing door",
    points: rect(384, 96, 16, 128),
    floor: 0,
    ceiling: 128,
    light: 160,
    floorTexture: "FLAT20",
    ceilingTexture: "CEIL5_1",
    wallTexture: "DOORTRAK",
    door: { opensBy: "use", closes: true, texture: "BIGDOOR2" },
  },
  {
    name: "Control room",
    points: rect(400, 32, 320, 256),
    floor: 0,
    ceiling: 128,
    light: 144,
    floorTexture: "FLAT5_4",
    ceilingTexture: "CEIL5_1",
    wallTexture: "STARGR1",
    walls: outline(desk, "COMPSTA1"),
  },
  {
    name: "Console",
    points: desk,
    floor: 40,
    ceiling: 128,
    light: 176,
    floorTexture: "CONS1_5",
    ceilingTexture: "TLITE6_4",
    wallTexture: "STARGR1",
  },
  {
    name: "Arch",
    points: rect(720, 96, 32, 128),
    floor: 0,
    ceiling: 112,
    light: 160,
    floorTexture: "FLAT20",
    ceilingTexture: "CEIL5_1",
    wallTexture: "STARGR1",
  },
  {
    name: "Courtyard",
    points: [
      [752, -64],
      [864, -64],
      [880, -64],
      [1008, -64],
      [1024, -64],
      [1136, -64],
      [1136, 384],
      [752, 384],
    ],
    floor: -16,
    ceiling: 176,
    light: 192,
    floorTexture: "FLAT10",
    ceilingTexture: "F_SKY1",
    wallTexture: "BROWN1",
    walls: [
      {
        wall: [
          [864, -64],
          [880, -64],
        ],
        texture: "DOORBLU",
      },
      {
        wall: [
          [1008, -64],
          [1024, -64],
        ],
        texture: "DOORBLU",
      },
    ],
  },
  {
    name: "Pool",
    points: rect(864, 64, 160, 192),
    floor: -32,
    ceiling: 176,
    light: 192,
    floorTexture: "NUKAGE1",
    ceilingTexture: "F_SKY1",
    wallTexture: "BROWN1",
    effect: "damage-5",
  },
  {
    name: "Step 1",
    points: rect(1136, 192, 32, 128),
    floor: 0,
    ceiling: 144,
    light: 168,
    floorTexture: "FLAT20",
    ceilingTexture: "CEIL5_1",
    wallTexture: "STARGR1",
  },
  {
    name: "Step 2",
    points: rect(1168, 192, 32, 128),
    floor: 16,
    ceiling: 160,
    light: 160,
    floorTexture: "FLAT20",
    ceilingTexture: "CEIL5_1",
    wallTexture: "STARGR1",
  },
  {
    name: "Step 3",
    points: rect(1200, 192, 32, 128),
    floor: 32,
    ceiling: 176,
    light: 152,
    floorTexture: "FLAT20",
    ceilingTexture: "CEIL5_1",
    wallTexture: "STARGR1",
  },
  {
    name: "Storeroom",
    points: rect(1232, 128, 288, 256),
    floor: 48,
    ceiling: 176,
    light: 152,
    floorTexture: "FLOOR5_1",
    ceilingTexture: "CEIL3_5",
    wallTexture: "BROWN96",
    walls: crates.flatMap((crate) => outline(crate, "CRATE1")),
  },
  ...crates.map((points, index) => ({
    name: `Crate ${index + 1}`,
    points,
    floor: 112,
    ceiling: 176,
    light: 152,
    floorTexture: "CRATOP1",
    ceilingTexture: "CEIL3_5",
    wallTexture: "CRATE1",
  })),
  {
    name: "Secret door",
    points: rect(1520, 192, 16, 64),
    floor: 48,
    ceiling: 160,
    light: 152,
    floorTexture: "FLOOR5_1",
    ceilingTexture: "CEIL3_5",
    wallTexture: "BROWN96",
    door: { opensBy: "use", closes: false, texture: "BROWN144" },
  },
  {
    name: "Secret",
    points: rect(1536, 160, 96, 128),
    floor: 48,
    ceiling: 144,
    light: 128,
    floorTexture: "FLOOR7_2",
    ceilingTexture: "CEIL3_5",
    wallTexture: "BROWN96",
    effect: "secret",
  },
  {
    name: "Blue door",
    points: rect(880, -80, 128, 16),
    floor: -16,
    ceiling: 112,
    light: 176,
    floorTexture: "FLAT20",
    ceilingTexture: "CEIL5_1",
    wallTexture: "DOORTRAK",
    door: { opensBy: "use", key: "blue", closes: false, texture: "BIGDOOR2" },
  },
  {
    name: "Exit room",
    points: [
      [848, -304],
      [912, -304],
      [976, -304],
      [1040, -304],
      [1040, -80],
      [848, -80],
    ],
    floor: -16,
    ceiling: 128,
    light: 176,
    floorTexture: "FLAT14",
    ceilingTexture: "TLITE6_4",
    wallTexture: "TEKWALL4",
    effect: "glow",
  },
];

const roomId = (name: string) =>
  `sector-${rooms.findIndex((room) => room.name === name) + 1}`;

const step = (room: string): LineSettings => ({
  sides: { [roomId(room)]: { lower: "STEP1" } },
});

const exitSwitch: [Corner, Corner] = [
  [912, -304],
  [976, -304],
];

// A small tech outpost to build on. The Landing has bare walls on three
// sides for new rooms, and the level beyond it is complete: a key loop
// through an open courtyard, a secret and an exit, with more monsters on
// harder skills.
export const starterMap: GameMap = buildMap({
  name: "Starter map",
  rooms,
  things: [
    { kind: "player", at: [96, 160] },
    { kind: "player-2", at: [48, 96] },
    { kind: "player-3", at: [48, 224] },
    { kind: "player-4", at: [48, 160] },
    { kind: "short-tech-lamp", at: [32, 32] },
    { kind: "short-tech-lamp", at: [352, 32] },
    { kind: "short-tech-lamp", at: [32, 288] },
    { kind: "short-tech-lamp", at: [352, 288] },
    { kind: "clip", at: [320, 96] },
    { kind: "stimpack", at: [320, 224] },

    { kind: "shotgun", at: [456, 160] },
    { kind: "zombieman", at: [672, 72], angle: 180 },
    {
      kind: "zombieman",
      at: [672, 248],
      angle: 180,
      skills: ["medium", "hard"],
    },
    { kind: "zombieman", at: [560, 256], angle: 90, skills: ["hard"] },
    { kind: "shells", at: [656, 160] },
    { kind: "tall-tech-lamp", at: [432, 56] },
    { kind: "tall-tech-lamp", at: [432, 264] },

    { kind: "imp", at: [1088, 16], angle: 180 },
    { kind: "imp", at: [1088, 336], angle: 180, skills: ["medium", "hard"] },
    { kind: "imp", at: [800, -24], angle: 0, skills: ["hard"] },
    { kind: "demon", at: [944, 320], angle: 180, skills: ["hard"] },
    { kind: "barrel", at: [800, 320] },
    { kind: "barrel", at: [832, 344] },
    { kind: "barrel", at: [1096, -24] },
    { kind: "shells", at: [944, 32] },
    { kind: "medikit", at: [1096, 168] },
    { kind: "clip", at: [800, 40] },

    { kind: "shotgun-guy", at: [1456, 200], angle: 180 },
    {
      kind: "shotgun-guy",
      at: [1392, 344],
      angle: 180,
      skills: ["medium", "hard"],
    },
    { kind: "zombieman", at: [1296, 344], angle: 0 },
    { kind: "imp", at: [1328, 248], angle: 180, skills: ["hard"] },
    { kind: "blue-key", at: [1456, 160] },
    { kind: "box-of-shells", at: [1376, 176] },
    { kind: "stimpack", at: [1264, 352] },
    { kind: "green-armor", at: [1584, 200] },
    { kind: "medikit", at: [1584, 248] },

    { kind: "imp", at: [944, -256], angle: 90 },
    {
      kind: "zombieman",
      at: [880, -240],
      angle: 90,
      skills: ["medium", "hard"],
    },
    { kind: "shotgun-guy", at: [1008, -240], angle: 90, skills: ["hard"] },
    { kind: "medikit", at: [1000, -120] },
    { kind: "tall-blue-torch", at: [872, -280] },
    { kind: "tall-blue-torch", at: [1016, -280] },
  ],
  switches: [{ room: "Exit room", wall: exitSwitch, texture: "SW1COMP" }],
  lines: [
    {
      wall: [
        [1136, 192],
        [1136, 320],
      ],
      settings: step("Step 1"),
    },
    {
      wall: [
        [1168, 192],
        [1168, 320],
      ],
      settings: step("Step 2"),
    },
    {
      wall: [
        [1200, 192],
        [1200, 320],
      ],
      settings: step("Step 3"),
    },
    {
      wall: [
        [1232, 192],
        [1232, 320],
      ],
      settings: step("Storeroom"),
    },
    {
      wall: [
        [1520, 192],
        [1520, 256],
      ],
      settings: { secret: true },
    },
    {
      wall: exitSwitch,
      settings: {
        action: { kind: "exit", trigger: "switch", repeat: false, tag: 0 },
      },
    },
  ],
});

export const blankMap: GameMap = {
  name: "Untitled map",
  vertices: {
    v1: { x: 0, y: 0 },
    v2: { x: 384, y: 0 },
    v3: { x: 384, y: 320 },
    v4: { x: 0, y: 320 },
  },
  sectors: [
    {
      id: "sector-1",
      name: "Room 1",
      vertices: ["v1", "v2", "v3", "v4"],
      floor: 0,
      ceiling: 128,
      light: 176,
      floorTexture: "FLOOR4_8",
      ceilingTexture: "CEIL3_5",
      wallTexture: "STARTAN3",
    },
  ],
  things: [{ id: "player-1", kind: "player", x: 96, y: 160, angle: 0 }],
  switches: [],
};
