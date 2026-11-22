import type { LineSettings } from "@/lib/map/types";

import { buildMap, type Corner, rect } from "./build-map";

const brick = {
  floor: 0,
  ceiling: 160,
  light: 176,
  floorTexture: "FLOOR5_1",
  ceilingTexture: "TLITE6_4",
  wallTexture: "BRICK1",
};
const end = { ...brick, floor: 64, light: 160, wallTexture: "SLADWALL" };

const lift = (tag: number): LineSettings => ({
  action: { kind: "lift", trigger: "switch", repeat: true, tag },
});

// The hall is split lengthways through its three pillars, and around the lifts
// at both ends, since a room can't have a hole in it.
export const longHall = buildMap({
  name: "Long Hall",
  scale: 4,
  rooms: [
    {
      name: "Hall",
      points: [
        [80, 220],
        [780, 220],
        [780, 240],
        [764, 240],
        [764, 260],
        [644, 260],
        [644, 248],
        [620, 248],
        [620, 260],
        [444, 260],
        [444, 248],
        [420, 248],
        [420, 260],
        [244, 260],
        [244, 248],
        [220, 248],
        [220, 260],
        [96, 260],
        [96, 240],
        [80, 240],
      ],
      ...brick,
    },
    {
      name: "Hall south",
      points: [
        [96, 260],
        [220, 260],
        [220, 272],
        [244, 272],
        [244, 260],
        [420, 260],
        [420, 272],
        [444, 272],
        [444, 260],
        [620, 260],
        [620, 272],
        [644, 272],
        [644, 260],
        [764, 260],
        [764, 280],
        [780, 280],
        [780, 300],
        [80, 300],
        [80, 280],
        [96, 280],
      ],
      ...brick,
    },
    { name: "West end", points: rect(20, 170, 60, 180), ...end },
    { name: "East end", points: rect(780, 170, 60, 180), ...end },
    {
      name: "West lift",
      points: rect(80, 240, 16, 40),
      ...end,
      wallTexture: "PLAT1",
      tag: 1,
    },
    {
      name: "East lift",
      points: rect(764, 240, 16, 40),
      ...end,
      wallTexture: "PLAT1",
      tag: 2,
    },
    { name: "North alcove", points: rect(160, 170, 60, 50), ...brick },
    { name: "North alcove east", points: rect(500, 170, 60, 50), ...brick },
    { name: "South alcove", points: rect(300, 300, 60, 50), ...brick },
    { name: "South alcove east", points: rect(640, 300, 60, 50), ...brick },
  ],
  things: [
    { kind: "player", at: [130, 250] },
    { kind: "deathmatch-start", at: [190, 192], angle: 270 },
    { kind: "deathmatch-start", at: [530, 192], angle: 270 },
    { kind: "deathmatch-start", at: [330, 328], angle: 90 },
    { kind: "deathmatch-start", at: [670, 328], angle: 90 },
    { kind: "shotgun", at: [50, 200] },
    { kind: "shotgun", at: [810, 320] },
    { kind: "chaingun", at: [330, 250] },
    { kind: "shells", at: [540, 250] },
    { kind: "blue-armor", at: [50, 320] },
    { kind: "green-armor", at: [810, 200] },
    { kind: "stimpack", at: [190, 240] },
    { kind: "stimpack", at: [670, 280] },
  ],
  lines: (
    [
      [[96, 240], [96, 260], 1],
      [[96, 260], [96, 280], 1],
      [[764, 240], [764, 260], 2],
      [[764, 260], [764, 280], 2],
    ] as [Corner, Corner, number][]
  ).map(([from, to, tag]) => ({ wall: [from, to], settings: lift(tag) })),
});
