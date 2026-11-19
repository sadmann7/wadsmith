import type { LineSettings } from "../types";
import { buildMap, rect, type Corner } from "./build-map";

const stone = {
  floor: 0,
  ceiling: 192,
  light: 176,
  floorTexture: "FLOOR0_1",
  ceilingTexture: "CEIL3_5",
  wallTexture: "STONE2",
};
const tower = { ...stone, floor: 64, light: 160, wallTexture: "GRAY1" };

const lift = (tag: number): LineSettings => ({
  action: { kind: "lift", trigger: "switch", repeat: true, tag },
});

// The lifts sit in the plaza's corners, so the plaza is a cross, and it is
// split down the middle around the pit.
const fourCorners = buildMap({
  name: "Four Corners",
  scale: 4,
  rooms: [
    {
      name: "Plaza",
      points: [
        [340, 140],
        [430, 140],
        [430, 230],
        [400, 230],
        [400, 290],
        [430, 290],
        [430, 380],
        [340, 380],
        [340, 340],
        [300, 340],
        [300, 180],
        [340, 180],
      ],
      ...stone,
    },
    {
      name: "Plaza east",
      points: [
        [430, 140],
        [520, 140],
        [520, 180],
        [560, 180],
        [560, 340],
        [520, 340],
        [520, 380],
        [430, 380],
        [430, 290],
        [460, 290],
        [460, 230],
        [430, 230],
      ],
      ...stone,
    },
    {
      name: "Pit",
      points: rect(400, 230, 60, 60),
      ...stone,
      floor: -24,
      light: 208,
      floorTexture: "TLITE6_4",
      effect: "strobe-fast",
    },
    { name: "North west tower", points: rect(200, 40, 140, 100), ...tower },
    { name: "North east tower", points: rect(520, 40, 140, 100), ...tower },
    { name: "South west tower", points: rect(200, 380, 140, 100), ...tower },
    { name: "South east tower", points: rect(520, 380, 140, 100), ...tower },
    {
      name: "North west lift",
      points: rect(300, 140, 40, 40),
      ...tower,
      wallTexture: "PLAT1",
      tag: 1,
    },
    {
      name: "North east lift",
      points: rect(520, 140, 40, 40),
      ...tower,
      wallTexture: "PLAT1",
      tag: 2,
    },
    {
      name: "South west lift",
      points: rect(300, 340, 40, 40),
      ...tower,
      wallTexture: "PLAT1",
      tag: 3,
    },
    {
      name: "South east lift",
      points: rect(520, 340, 40, 40),
      ...tower,
      wallTexture: "PLAT1",
      tag: 4,
    },
    { name: "West hall", points: rect(120, 200, 180, 120), ...stone },
    { name: "East hall", points: rect(560, 200, 180, 120), ...stone },
  ],
  things: [
    { kind: "player", at: [160, 260] },
    { kind: "deathmatch-start", at: [240, 80], angle: 270 },
    { kind: "deathmatch-start", at: [620, 80], angle: 270 },
    { kind: "deathmatch-start", at: [240, 440], angle: 90 },
    { kind: "deathmatch-start", at: [620, 440], angle: 90 },
    { kind: "chaingun", at: [430, 260] },
    { kind: "shotgun", at: [180, 236] },
    { kind: "shotgun", at: [680, 236] },
    { kind: "shells", at: [290, 90] },
    { kind: "shells", at: [570, 430] },
    { kind: "stimpack", at: [570, 90] },
    { kind: "stimpack", at: [290, 430] },
    { kind: "green-armor", at: [690, 290] },
    { kind: "blue-armor", at: [170, 290] },
    { kind: "barrel", at: [380, 200] },
    { kind: "barrel", at: [480, 320] },
  ],
  lines: (
    [
      [[340, 140], [340, 180], 1],
      [[300, 180], [340, 180], 1],
      [[520, 140], [520, 180], 2],
      [[520, 180], [560, 180], 2],
      [[300, 340], [340, 340], 3],
      [[340, 340], [340, 380], 3],
      [[520, 340], [560, 340], 4],
      [[520, 340], [520, 380], 4],
    ] as [Corner, Corner, number][]
  ).map(([from, to, tag]) => ({ wall: [from, to], settings: lift(tag) })),
});

export { fourCorners };
