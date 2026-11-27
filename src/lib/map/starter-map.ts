import type { GameMap, LineSettings } from "./types";

import { buildMap, rect, type RoomSpec } from "./featured/build-map";

const rooms: RoomSpec[] = [
  {
    name: "Start",
    points: rect(0, 0, 256, 256),
    floor: 0,
    ceiling: 128,
    light: 192,
    floorTexture: "FLOOR4_8",
    ceilingTexture: "TLITE6_4",
    wallTexture: "STARTAN3",
  },
  {
    name: "First door",
    points: rect(256, 64, 16, 128),
    floor: 0,
    ceiling: 128,
    light: 176,
    floorTexture: "FLAT20",
    ceilingTexture: "CEIL5_1",
    wallTexture: "STARTAN3",
    door: { opensBy: "use", closes: true, texture: "BIGDOOR2" },
  },
  {
    name: "Hall",
    points: rect(272, 64, 320, 128),
    floor: 0,
    ceiling: 128,
    light: 144,
    floorTexture: "FLAT5_4",
    ceilingTexture: "CEIL5_1",
    wallTexture: "STARGR1",
  },
  {
    name: "Steps",
    points: rect(592, 64, 32, 128),
    floor: -16,
    ceiling: 144,
    light: 144,
    floorTexture: "FLAT5_4",
    ceilingTexture: "CEIL5_1",
    wallTexture: "STARGR1",
  },
  {
    name: "Steps down",
    points: rect(624, 64, 32, 128),
    floor: -32,
    ceiling: 160,
    light: 152,
    floorTexture: "FLAT5_4",
    ceilingTexture: "CEIL5_1",
    wallTexture: "STARGR1",
  },
  {
    name: "Key room",
    points: rect(656, -96, 320, 448),
    floor: -48,
    ceiling: 208,
    light: 160,
    floorTexture: "FLOOR5_1",
    ceilingTexture: "CEIL5_1",
    wallTexture: "BROWN1",
  },
  {
    name: "Key pedestal",
    points: rect(768, 80, 96, 96),
    floor: -24,
    ceiling: 208,
    light: 224,
    floorTexture: "FLAT14",
    ceilingTexture: "TLITE6_4",
    wallTexture: "BROWN1",
  },
  {
    name: "Blue door",
    points: rect(976, 64, 16, 128),
    floor: -48,
    ceiling: 128,
    light: 160,
    floorTexture: "FLAT20",
    ceilingTexture: "CEIL5_1",
    wallTexture: "DOORBLU",
    door: { opensBy: "use", key: "blue", closes: true, texture: "BIGDOOR2" },
  },
  {
    name: "Lift room",
    points: [
      [992, 32],
      [1184, 32],
      [1184, 96],
      [1248, 96],
      [1248, 288],
      [992, 288],
    ],
    floor: -48,
    ceiling: 208,
    light: 136,
    floorTexture: "FLOOR4_8",
    ceilingTexture: "CEIL3_5",
    wallTexture: "STARTAN3",
  },
  {
    name: "Lift",
    points: rect(1184, 32, 64, 64),
    floor: 64,
    ceiling: 208,
    light: 176,
    floorTexture: "FLAT20",
    ceilingTexture: "TLITE6_4",
    wallTexture: "STARTAN3",
    tag: 1,
  },
  {
    name: "Ledge",
    points: rect(992, -96, 256, 128),
    floor: 64,
    ceiling: 208,
    light: 176,
    floorTexture: "FLOOR4_8",
    ceilingTexture: "CEIL3_5",
    wallTexture: "STARTAN3",
  },
  {
    name: "Secret door",
    points: rect(1056, -112, 64, 16),
    floor: 64,
    ceiling: 192,
    light: 176,
    floorTexture: "FLOOR4_8",
    ceilingTexture: "CEIL3_5",
    wallTexture: "STARTAN3",
    door: { opensBy: "use", closes: false, texture: "BROWN96" },
  },
  {
    name: "Secret",
    points: rect(1024, -224, 128, 112),
    floor: 64,
    ceiling: 192,
    light: 112,
    floorTexture: "FLOOR7_2",
    ceilingTexture: "CEIL3_5",
    wallTexture: "BROWN96",
    effect: "secret",
  },
  {
    name: "Exit door",
    points: rect(1248, -64, 16, 64),
    floor: 64,
    ceiling: 192,
    light: 176,
    floorTexture: "FLAT20",
    ceilingTexture: "CEIL5_1",
    wallTexture: "STARTAN3",
    door: { opensBy: "use", closes: true, texture: "DOOR3" },
  },
  {
    name: "Exit",
    points: [
      [1264, -128],
      [1424, -128],
      [1424, -64],
      [1424, 0],
      [1424, 64],
      [1264, 64],
    ],
    floor: 64,
    ceiling: 192,
    light: 208,
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

const lift: LineSettings = {
  front: roomId("Lift room"),
  sides: { [roomId("Lift room")]: { lower: "PLAT1" } },
  action: { kind: "lift", trigger: "switch", repeat: true, tag: 1 },
};

const blueTrim: LineSettings = {
  sides: { [roomId("Blue door")]: { middle: "DOORBLU" } },
};

// A level that teaches one idea per room: a door opened by walking up to it,
// a key that opens the matching door, a lift, a secret behind an odd wall and
// an exit switch. Monsters thin out on easier skills.
export const starterMap: GameMap = buildMap({
  name: "Starter map",
  rooms,
  things: [
    { kind: "player", at: [96, 128] },
    { kind: "player-2", at: [48, 64] },
    { kind: "player-3", at: [48, 192] },
    { kind: "player-4", at: [48, 128] },
    { kind: "lamp", at: [224, 32] },
    { kind: "lamp", at: [224, 224] },
    { kind: "shotgun", at: [320, 128] },
    { kind: "zombieman", at: [544, 96], angle: 180 },
    { kind: "zombieman", at: [544, 160], angle: 180 },
    {
      kind: "zombieman",
      at: [512, 128],
      angle: 180,
      skills: ["medium", "hard"],
    },
    { kind: "stimpack", at: [448, 176] },
    { kind: "shells", at: [704, 224] },
    { kind: "zombieman", at: [704, 320], angle: 90 },
    { kind: "imp", at: [928, -48], angle: 180 },
    { kind: "imp", at: [928, 304], angle: 180, skills: ["medium", "hard"] },
    { kind: "shotgun-guy", at: [720, -48], angle: 270, skills: ["hard"] },
    { kind: "stimpack", at: [928, 128] },
    { kind: "blue-key", at: [816, 152] },
    { kind: "tall-blue-torch", at: [952, 40] },
    { kind: "tall-blue-torch", at: [952, 216] },
    { kind: "zombieman", at: [1120, 224], angle: 180 },
    {
      kind: "shotgun-guy",
      at: [1200, 256],
      angle: 180,
      skills: ["medium", "hard"],
    },
    { kind: "medikit", at: [1024, 256] },
    { kind: "shells", at: [1120, 128] },
    { kind: "imp", at: [1040, -48], angle: 270 },
    { kind: "imp", at: [1200, -48], angle: 270, skills: ["hard"] },
    { kind: "medikit", at: [1136, 0] },
    { kind: "green-armor", at: [1064, -144] },
    { kind: "shells", at: [1112, -144] },
    { kind: "shotgun-guy", at: [1384, 24], angle: 180 },
    { kind: "imp", at: [1304, 24], angle: 180, skills: ["medium", "hard"] },
    { kind: "demon", at: [1344, -24], angle: 180, skills: ["hard"] },
  ],
  switches: [
    {
      room: "Exit",
      wall: [
        [1424, -64],
        [1424, 0],
      ],
      texture: "SW1COMP",
    },
  ],
  lines: [
    {
      wall: [
        [592, 64],
        [592, 192],
      ],
      settings: step("Steps"),
    },
    {
      wall: [
        [624, 64],
        [624, 192],
      ],
      settings: step("Steps down"),
    },
    {
      wall: [
        [656, 64],
        [656, 192],
      ],
      settings: step("Key room"),
    },
    {
      wall: [
        [768, 80],
        [864, 80],
      ],
      settings: step("Key room"),
    },
    {
      wall: [
        [864, 80],
        [864, 176],
      ],
      settings: step("Key room"),
    },
    {
      wall: [
        [864, 176],
        [768, 176],
      ],
      settings: step("Key room"),
    },
    {
      wall: [
        [768, 176],
        [768, 80],
      ],
      settings: step("Key room"),
    },
    {
      wall: [
        [976, 64],
        [992, 64],
      ],
      settings: blueTrim,
    },
    {
      wall: [
        [976, 192],
        [992, 192],
      ],
      settings: blueTrim,
    },
    {
      wall: [
        [1184, 32],
        [1184, 96],
      ],
      settings: lift,
    },
    {
      wall: [
        [1184, 96],
        [1248, 96],
      ],
      settings: lift,
    },
    {
      wall: [
        [1056, -96],
        [1120, -96],
      ],
      settings: { secret: true },
    },
    {
      wall: [
        [1424, -64],
        [1424, 0],
      ],
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
