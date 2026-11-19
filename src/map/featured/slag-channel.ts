import { buildMap, rect } from "./build-map";

const walk = {
  floor: 0,
  ceiling: 128,
  light: 160,
  floorTexture: "FLOOR4_8",
  ceilingTexture: "CEIL5_1",
  wallTexture: "METAL",
};
const acid = {
  floor: -16,
  ceiling: 128,
  light: 176,
  floorTexture: "NUKAGE1",
  ceilingTexture: "CEIL5_1",
  wallTexture: "SLADWALL",
  effect: "damage-10" as const,
};

const slagChannel = buildMap({
  name: "Slag Channel",
  scale: 4,
  rooms: [
    {
      name: "Start",
      points: rect(40, 140, 80, 240),
      ...walk,
      wallTexture: "SLADWALL",
    },
    { name: "North walk", points: rect(120, 160, 640, 60), ...walk },
    { name: "Slag channel", points: rect(120, 220, 440, 80), ...acid },
    {
      name: "Bridge",
      points: rect(560, 220, 60, 80),
      ...walk,
      floor: -16,
      floorTexture: "FLOOR4_8",
      tag: 1,
    },
    { name: "Slag channel east", points: rect(620, 220, 140, 80), ...acid },
    { name: "South walk", points: rect(120, 300, 280, 60), ...walk },
    { name: "South walk east", points: rect(520, 300, 240, 60), ...walk },
    {
      name: "Control room",
      points: [
        [440, 360],
        [540, 360],
        [540, 460],
        [498, 460],
        [482, 460],
        [440, 460],
      ],
      ...walk,
      ceiling: 112,
      light: 144,
      wallTexture: "SLADWALL",
    },
    {
      name: "Blue key room",
      points: rect(600, 60, 120, 84),
      ...walk,
      floor: 16,
      light: 192,
      ceilingTexture: "TLITE6_4",
    },
    {
      name: "Key room door",
      points: rect(640, 144, 40, 16),
      ...walk,
      floor: 16,
      ceiling: 112,
      wallTexture: "DOORTRAK",
      door: { opensBy: "use", closes: true, texture: "BIGDOOR2" },
    },
    {
      name: "Blue door",
      points: rect(760, 170, 16, 44),
      ...walk,
      ceiling: 112,
      wallTexture: "DOORBLU",
      door: { opensBy: "use", closes: true, texture: "DOOR3" },
    },
    {
      name: "Exit",
      points: [
        [776, 160],
        [850, 160],
        [850, 232],
        [850, 248],
        [850, 320],
        [776, 320],
      ],
      ...walk,
      light: 208,
      floorTexture: "FLAT14",
      ceilingTexture: "TLITE6_4",
      wallTexture: "TEKWALL4",
    },
    {
      name: "Flickering alcove",
      points: rect(230, 360, 40, 8),
      ...walk,
      floor: 96,
      ceiling: 104,
      wallTexture: "SLADWALL",
      effect: "flicker",
      tag: 2,
    },
    {
      name: "Secret",
      points: rect(200, 368, 100, 72),
      ...walk,
      ceiling: 104,
      light: 128,
      wallTexture: "SLADWALL",
      effect: "secret",
    },
  ],
  things: [
    { kind: "player", at: [70, 260] },
    { kind: "medikit", at: [80, 170] },
    { kind: "barrel", at: [200, 180] },
    { kind: "barrel", at: [330, 180] },
    { kind: "barrel", at: [470, 192] },
    { kind: "zombieman", at: [260, 192], angle: 180 },
    { kind: "zombieman", at: [420, 196], angle: 180 },
    { kind: "shotgun-guy", at: [700, 190], angle: 180 },
    { kind: "shells", at: [150, 330] },
    { kind: "imp", at: [300, 330], angle: 180 },
    { kind: "imp", at: [650, 330], angle: 180 },
    { kind: "shotgun-guy", at: [580, 330], angle: 180 },
    { kind: "stimpack", at: [740, 340] },
    { kind: "spectre", at: [490, 410], angle: 90 },
    { kind: "blue-key", at: [660, 100] },
    { kind: "chaingun", at: [250, 400] },
  ],
  switches: [
    {
      room: "Control room",
      wall: [
        [498, 460],
        [482, 460],
      ],
      texture: "SW1METAL",
    },
    {
      room: "Exit",
      wall: [
        [850, 232],
        [850, 248],
      ],
      texture: "SW1COMP",
    },
  ],
  lines: [
    {
      wall: [
        [498, 460],
        [482, 460],
      ],
      settings: {
        action: {
          kind: "floor-raise-next",
          trigger: "switch",
          repeat: false,
          tag: 1,
        },
      },
    },
    {
      wall: [
        [760, 170],
        [760, 214],
      ],
      settings: {
        action: {
          kind: "door-open",
          trigger: "door",
          repeat: false,
          key: "blue",
          tag: 0,
        },
      },
    },
    {
      wall: [
        [850, 232],
        [850, 248],
      ],
      settings: {
        action: { kind: "exit", trigger: "switch", repeat: false, tag: 0 },
      },
    },
    {
      wall: [
        [230, 360],
        [270, 360],
      ],
      settings: {
        hidden: true,
        action: {
          kind: "floor-lower",
          trigger: "switch",
          repeat: false,
          tag: 2,
        },
      },
    },
  ],
});

export { slagChannel };
