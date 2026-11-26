import { defined } from "@/lib/defined";

import { type GeneralizedClass, generalizedClass, withField } from "./boom";

export type HexenTrigger = "walk" | "use" | "shoot" | "monster-walk" | "none";

type HexenArg = number | "tag" | null;

export interface HexenAction {
  special: number;
  id: number;
  args: number[];
  trigger: HexenTrigger;
  repeat: boolean;
  monsters?: boolean;
}

export const actionChanges = [
  "trigger",
  "repeat",
  "monsters",
  "key",
  "speed",
  "delay",
  "height",
  "step",
  "stairs reset",
  "where it stops",
  "damage",
  "crushing",
  "stopping",
  "floor lock",
  "texture",
  "light",
  "timing",
  "sound",
  "fog",
  "angle",
  "start spot",
  "which parts scroll",
  "opacity",
  "blending",
  "Boom bug",
] as const;

export type ActionChange = (typeof actionChanges)[number];

export interface DoomAction {
  special: number;
  tag: number;
  changes: ActionChange[];
}

// Each Doom line special as the Hexen special, trigger and arguments that
// stand for it. A "tag" argument carries the Doom tag and null is ignored.
export const hexenTranslations: [
  doom: number,
  trigger: HexenTrigger,
  repeat: boolean,
  special: number,
  args: HexenArg[],
][] = [
  [1, "use", true, 12, [0, 16, 150, "tag"]],
  [2, "walk", false, 11, ["tag", 16]],
  [3, "walk", false, 10, ["tag", 16]],
  [4, "walk", false, 12, ["tag", 16, 150]],
  [5, "walk", false, 238, ["tag", 8]],
  [6, "walk", false, 168, ["tag", 8, 16, 10]],
  [7, "use", false, 217, ["tag", 2, 8]],
  [8, "walk", false, 217, ["tag", 2, 8]],
  [9, "use", false, 250, ["tag", 4, 4]],
  [10, "walk", false, 206, ["tag", 32, 105]],
  [11, "use", false, 243, []],
  [12, "walk", false, 234, ["tag"]],
  [13, "walk", false, 112, ["tag", 255]],
  [14, "use", false, 230, ["tag", 4, 4]],
  [15, "use", false, 230, ["tag", 4, 3]],
  [16, "walk", false, 249, ["tag", 16, 240]],
  [17, "walk", false, 232, ["tag", 5, 35]],
  [18, "use", false, 25, ["tag", 8]],
  [19, "walk", false, 242, ["tag", 8, 128]],
  [20, "use", false, 228, ["tag", 4]],
  [21, "use", false, 206, ["tag", 32, 105]],
  [22, "walk", false, 228, ["tag", 4]],
  [23, "use", false, 21, ["tag", 8]],
  [24, "shoot", false, 238, ["tag", 8]],
  [25, "walk", false, 168, ["tag", 8, 8, 10]],
  [26, "use", true, 13, [0, 16, 150, 130, "tag"]],
  [27, "use", true, 13, [0, 16, 150, 131, "tag"]],
  [28, "use", true, 13, [0, 16, 150, 129, "tag"]],
  [29, "use", false, 12, ["tag", 16, 150]],
  [30, "walk", false, 240, ["tag", 8]],
  [31, "use", false, 11, [0, 16, "tag"]],
  [32, "use", false, 13, [0, 16, 0, 130, "tag"]],
  [33, "use", false, 13, [0, 16, 0, 129, "tag"]],
  [34, "use", false, 13, [0, 16, 0, 131, "tag"]],
  [35, "walk", false, 112, ["tag", 35]],
  [36, "walk", false, 242, ["tag", 32, 136]],
  [37, "walk", false, 241, ["tag", 8]],
  [38, "walk", false, 21, ["tag", 8]],
  [39, "walk", false, 70, [0, "tag"]],
  [40, "walk", false, 201, ["tag", 8, 0, 1, 8]],
  [41, "use", false, 254, ["tag", 8]],
  [42, "use", true, 10, ["tag", 16]],
  [43, "use", true, 254, ["tag", 8]],
  [44, "walk", false, 43, ["tag", 8, 0, 2]],
  [45, "use", true, 242, ["tag", 8, 128]],
  [46, "shoot", true, 11, ["tag", 16]],
  [47, "shoot", false, 228, ["tag", 4]],
  [48, "none", false, 100, [64]],
  [49, "use", false, 168, ["tag", 8, 8, 10]],
  [50, "use", false, 10, ["tag", 16]],
  [51, "use", false, 244, []],
  [52, "walk", false, 243, []],
  [53, "walk", false, 207, ["tag", 8, 105]],
  [54, "walk", false, 61, ["tag"]],
  [55, "use", false, 99, ["tag", 8, 10, 2]],
  [56, "walk", false, 99, ["tag", 8, 10, 2]],
  [57, "walk", false, 44, ["tag"]],
  [58, "walk", false, 23, ["tag", 8, 24]],
  [59, "walk", false, 239, ["tag", 8, 24]],
  [60, "use", true, 21, ["tag", 8]],
  [61, "use", true, 11, ["tag", 16]],
  [62, "use", true, 206, ["tag", 32, 105]],
  [63, "use", true, 12, ["tag", 16, 150]],
  [64, "use", true, 238, ["tag", 8]],
  [65, "use", true, 99, ["tag", 8, 10, 2]],
  [66, "use", true, 230, ["tag", 4, 3]],
  [67, "use", true, 230, ["tag", 4, 4]],
  [68, "use", true, 228, ["tag", 4]],
  [69, "use", true, 25, ["tag", 8]],
  [70, "use", true, 242, ["tag", 32, 136]],
  [71, "use", false, 242, ["tag", 32, 136]],
  [72, "walk", true, 43, ["tag", 8, 0, 2]],
  [73, "walk", true, 168, ["tag", 8, 8, 10]],
  [74, "walk", true, 44, ["tag"]],
  [75, "walk", true, 10, ["tag", 16]],
  [76, "walk", true, 249, ["tag", 16, 240]],
  [77, "walk", true, 168, ["tag", 8, 16, 10]],
  [78, "use", true, 236, ["tag"]],
  [79, "walk", true, 112, ["tag", 35]],
  [80, "walk", true, 234, ["tag"]],
  [81, "walk", true, 112, ["tag", 255]],
  [82, "walk", true, 21, ["tag", 8]],
  [83, "walk", true, 242, ["tag", 8, 128]],
  [84, "walk", true, 241, ["tag", 8]],
  [85, "none", false, 101, [64]],
  [86, "walk", true, 11, ["tag", 16]],
  [87, "walk", true, 207, ["tag", 8, 105]],
  [88, "walk", true, 206, ["tag", 32, 105]],
  [89, "walk", true, 61, ["tag"]],
  [90, "walk", true, 12, ["tag", 16, 150]],
  [91, "walk", true, 238, ["tag", 8]],
  [92, "walk", true, 23, ["tag", 8, 24]],
  [93, "walk", true, 239, ["tag", 8, 24]],
  [94, "walk", true, 99, ["tag", 8, 10, 2]],
  [95, "walk", true, 228, ["tag", 4]],
  [96, "walk", true, 240, ["tag", 8]],
  [97, "walk", true, 70, [0, "tag"]],
  [98, "walk", true, 242, ["tag", 32, 136]],
  [99, "use", true, 13, ["tag", 64, 0, 130]],
  [100, "walk", false, 273, ["tag", 32, 16]],
  [101, "use", false, 238, ["tag", 8]],
  [102, "use", false, 242, ["tag", 8, 128]],
  [103, "use", false, 11, ["tag", 16]],
  [104, "walk", false, 233, ["tag"]],
  [105, "walk", true, 12, ["tag", 64, 150]],
  [106, "walk", true, 11, ["tag", 64]],
  [107, "walk", true, 10, ["tag", 64]],
  [108, "walk", false, 12, ["tag", 64, 150]],
  [109, "walk", false, 11, ["tag", 64]],
  [110, "walk", false, 10, ["tag", 64]],
  [111, "use", false, 12, ["tag", 64, 150]],
  [112, "use", false, 11, ["tag", 64]],
  [113, "use", false, 10, ["tag", 64]],
  [114, "use", true, 12, ["tag", 64, 150]],
  [115, "use", true, 11, ["tag", 64]],
  [116, "use", true, 10, ["tag", 64]],
  [117, "use", true, 12, [0, 64, 150, "tag"]],
  [118, "use", false, 11, [0, 64, "tag"]],
  [119, "walk", false, 25, ["tag", 8]],
  [120, "walk", true, 206, ["tag", 64, 105]],
  [121, "walk", false, 206, ["tag", 64, 105]],
  [122, "use", false, 206, ["tag", 64, 105]],
  [123, "use", true, 206, ["tag", 64, 105]],
  [124, "walk", false, 244, []],
  [125, "monster-walk", false, 70, [0, "tag"]],
  [126, "monster-walk", true, 70, [0, "tag"]],
  [127, "use", false, 273, ["tag", 32, 16]],
  [128, "walk", true, 25, ["tag", 8]],
  [129, "walk", true, 25, ["tag", 32]],
  [130, "walk", false, 25, ["tag", 32]],
  [131, "use", false, 25, ["tag", 32]],
  [132, "use", true, 25, ["tag", 32]],
  [133, "use", false, 13, ["tag", 64, 0, 130]],
  [134, "use", true, 13, ["tag", 64, 0, 129]],
  [135, "use", false, 13, ["tag", 64, 0, 129]],
  [136, "use", true, 13, ["tag", 64, 0, 131]],
  [137, "use", false, 13, ["tag", 64, 0, 131]],
  [138, "use", true, 112, ["tag", 255]],
  [139, "use", true, 112, ["tag", 35]],
  [140, "use", false, 35, ["tag", 8, 64]],
  [141, "walk", false, 104, ["tag", 8, 8, 10]],
  [142, "walk", false, 35, ["tag", 8, 64]],
  [143, "walk", false, 230, ["tag", 4, 3]],
  [144, "walk", false, 230, ["tag", 4, 4]],
  [145, "walk", false, 254, ["tag", 8]],
  [146, "walk", false, 250, ["tag", 4, 4]],
  [147, "walk", true, 35, ["tag", 8, 64]],
  [148, "walk", true, 230, ["tag", 4, 3]],
  [149, "walk", true, 230, ["tag", 4, 4]],
  [150, "walk", true, 104, ["tag", 8, 8, 10]],
  [151, "walk", true, 251, ["tag", 8, 8]],
  [152, "walk", true, 254, ["tag", 8]],
  [153, "walk", false, 235, ["tag"]],
  [154, "walk", true, 235, ["tag"]],
  [155, "walk", true, 250, ["tag", 4, 4]],
  [156, "walk", true, 232, ["tag", 5, 35]],
  [157, "walk", true, 233, ["tag"]],
  [158, "use", false, 240, ["tag", 8]],
  [159, "use", false, 241, ["tag", 8]],
  [160, "use", false, 239, ["tag", 8, 24]],
  [161, "use", false, 23, ["tag", 8, 24]],
  [162, "use", false, 207, ["tag", 8, 105]],
  [163, "use", false, 61, ["tag"]],
  [164, "use", false, 168, ["tag", 8, 16, 10]],
  [165, "use", false, 104, ["tag", 8, 8, 10]],
  [166, "use", false, 251, ["tag", 8, 8, 1998]],
  [167, "use", false, 43, ["tag", 8, 0, 2]],
  [168, "use", false, 44, ["tag"]],
  [169, "use", false, 234, ["tag"]],
  [170, "use", false, 112, ["tag", 35]],
  [171, "use", false, 112, ["tag", 255]],
  [172, "use", false, 232, ["tag", 5, 35]],
  [173, "use", false, 233, ["tag"]],
  [174, "use", false, 70, [0, "tag"]],
  [175, "use", false, 249, ["tag", 16, 240]],
  [176, "use", true, 240, ["tag", 8]],
  [177, "use", true, 241, ["tag", 8]],
  [178, "use", true, 35, ["tag", 8, 64]],
  [179, "use", true, 239, ["tag", 8, 24]],
  [180, "use", true, 23, ["tag", 8, 24]],
  [181, "use", true, 207, ["tag", 8, 105]],
  [182, "use", true, 61, ["tag"]],
  [183, "use", true, 168, ["tag", 8, 16, 10]],
  [184, "use", true, 168, ["tag", 8, 8, 10]],
  [185, "use", true, 104, ["tag", 8, 8, 10]],
  [186, "use", true, 251, ["tag", 8, 8, 1998]],
  [187, "use", true, 43, ["tag", 8, 0, 2]],
  [188, "use", true, 44, ["tag"]],
  [189, "use", false, 235, ["tag"]],
  [190, "use", true, 235, ["tag"]],
  [191, "use", true, 250, ["tag", 4, 4]],
  [192, "use", true, 234, ["tag"]],
  [193, "use", true, 232, ["tag", 5, 35]],
  [194, "use", true, 233, ["tag"]],
  [195, "use", true, 70, [0, "tag"]],
  [196, "use", true, 249, ["tag", 16, 240]],
  [197, "shoot", false, 243, []],
  [198, "shoot", false, 244, []],
  [199, "walk", false, 253, ["tag", 8]],
  [200, "walk", false, 192, ["tag", 8]],
  [201, "walk", true, 253, ["tag", 8]],
  [202, "walk", true, 192, ["tag", 8]],
  [203, "use", false, 253, ["tag", 8]],
  [204, "use", false, 192, ["tag", 8]],
  [205, "use", true, 253, ["tag", 8]],
  [206, "use", true, 192, ["tag", 8]],
  [207, "walk", false, 71, [0, 2, "tag", 1]],
  [208, "walk", true, 71, [0, 2, "tag", 1]],
  [209, "use", false, 71, [0, 2, "tag", 1]],
  [210, "use", true, 71, [0, 2, "tag", 1]],
  [211, "use", true, 231, ["tag"]],
  [212, "walk", true, 231, ["tag"]],
  [213, "none", false, 210, ["tag"]],
  [214, "none", false, 224, ["tag", 6]],
  [215, "none", false, 223, ["tag", 6]],
  [216, "none", false, 223, ["tag", 6, 1]],
  [217, "none", false, 223, ["tag", 6, 2]],
  [218, "none", false, 222, ["tag", 2]],
  [219, "walk", false, 22, ["tag", 8]],
  [220, "walk", true, 22, ["tag", 8]],
  [221, "use", false, 22, ["tag", 8]],
  [222, "use", true, 22, ["tag", 8]],
  [223, "none", false, 219, ["tag"]],
  [224, "none", false, 218, ["tag", 0, 0, 1]],
  [225, "none", false, 220, ["tag", 0, 0, 1]],
  [226, "none", false, 227, ["tag", 0, 0, 1]],
  [227, "walk", false, 245, ["tag", 32]],
  [228, "walk", true, 245, ["tag", 32]],
  [229, "use", false, 245, ["tag", 32]],
  [230, "use", true, 245, ["tag", 32]],
  [231, "walk", false, 247, ["tag", 32]],
  [232, "walk", true, 247, ["tag", 32]],
  [233, "use", false, 247, ["tag", 32]],
  [234, "use", true, 247, ["tag", 32]],
  [235, "walk", false, 246, ["tag", 32]],
  [236, "walk", true, 246, ["tag", 32]],
  [237, "use", false, 246, ["tag", 32]],
  [238, "use", true, 246, ["tag", 32]],
  [239, "walk", false, 236, ["tag"]],
  [240, "walk", true, 236, ["tag"]],
  [241, "use", false, 236, ["tag"]],
  [242, "none", false, 209, ["tag"]],
  [243, "walk", false, 215, [null, "tag"]],
  [244, "walk", true, 215, [null, "tag"]],
  [245, "none", false, 224, ["tag", 5]],
  [246, "none", false, 223, ["tag", 5]],
  [247, "none", false, 223, ["tag", 5, 1]],
  [248, "none", false, 223, ["tag", 5, 2]],
  [249, "none", false, 222, ["tag", 1]],
  [250, "none", false, 224, ["tag", 4]],
  [251, "none", false, 223, ["tag", 4]],
  [252, "none", false, 223, ["tag", 4, 1]],
  [253, "none", false, 223, ["tag", 4, 2]],
  [254, "none", false, 222, ["tag"]],
  [255, "none", false, 225, []],
  [256, "walk", true, 217, ["tag", 2, 8]],
  [257, "walk", true, 273, ["tag", 32, 16]],
  [258, "use", true, 217, ["tag", 2, 8]],
  [259, "use", true, 273, ["tag", 32, 16]],
  [260, "none", false, 208, ["tag", 168]],
  [261, "none", false, 211, ["tag"]],
  [262, "walk", false, 215, [null, "tag", 1]],
  [263, "walk", true, 215, [null, "tag", 1]],
  [264, "monster-walk", false, 215, [null, "tag", 1]],
  [265, "monster-walk", true, 215, [null, "tag", 1]],
  [266, "monster-walk", false, 215, [null, "tag"]],
  [267, "monster-walk", true, 215, [null, "tag"]],
  [268, "monster-walk", false, 71, [0, 2, "tag", 1]],
  [269, "monster-walk", true, 71, [0, 2, "tag", 1]],
  [1024, "none", false, 225, [0, "tag", 0, 8]],
  [1025, "none", false, 225, [0, "tag", 1, 8]],
  [1026, "none", false, 225, [0, "tag", 2, 8]],
];

// A mode names a change only for the values that don't play like Doom's.
type Mode = (value: number) => ActionChange | null;

const onlyMode =
  (mode: number, change: ActionChange): Mode =>
  (value) =>
    value === mode ? change : null;

// GZDoom scrolls every part for a value outside 1 to 6.
const scrolledParts: Mode = (parts) =>
  parts > 0 && parts < 7 ? "which parts scroll" : null;

// The arguments listed under nearest are speeds, delays and other amounts
// that only change how an action feels, so a map's own values pick the
// closest Doom special instead of ruling it out. Each names what it changes,
// or is null where GZDoom ignores it.
const hexenSpecials: Record<
  number,
  { name: string; nearest: Partial<Record<number, ActionChange | Mode | null>> }
> = {
  10: {
    name: "Door_Close",
    nearest: { 1: "speed", 2: "light" },
  },
  11: {
    name: "Door_Open",
    nearest: { 1: "speed", 2: "light" },
  },
  12: {
    name: "Door_Raise",
    nearest: { 1: "speed", 2: "delay", 3: "light" },
  },
  13: {
    name: "Door_LockedRaise",
    nearest: { 1: "speed", 2: "delay", 4: "light" },
  },
  21: {
    name: "Floor_LowerToLowest",
    nearest: { 1: "speed", 2: "texture" },
  },
  22: {
    name: "Floor_LowerToNearest",
    nearest: { 1: "speed", 2: "texture" },
  },
  23: {
    name: "Floor_RaiseByValue",
    nearest: { 1: "speed" },
  },
  25: {
    name: "Floor_RaiseToNearest",
    nearest: { 1: "speed", 2: "texture" },
  },
  35: {
    name: "Floor_RaiseByValueTimes8",
    nearest: { 1: "speed" },
  },
  42: { name: "Ceiling_CrushAndRaise", nearest: {} },
  43: {
    name: "Ceiling_LowerAndCrush",
    nearest: { 1: "speed", 2: "damage", 3: "crushing" },
  },
  44: {
    name: "Ceiling_CrushStop",
    nearest: { 1: onlyMode(2, "stopping"), 2: null, 3: null, 4: null },
  },
  60: { name: "Plat_PerpetualRaise", nearest: {} },
  61: {
    name: "Plat_Stop",
    nearest: { 1: null, 2: null, 3: onlyMode(2, "stopping"), 4: null },
  },
  62: { name: "Plat_DownWaitUpStay", nearest: {} },
  70: {
    name: "Teleport",
    nearest: { 2: "fog" },
  },
  71: {
    name: "Teleport_NoFog",
    nearest: { 1: "angle", 3: "height" },
  },
  99: {
    name: "Floor_RaiseAndCrushDoom",
    nearest: { 1: "speed", 2: "damage", 3: "crushing" },
  },
  100: {
    name: "Scroll_Texture_Left",
    nearest: { 0: "speed", 1: scrolledParts, 2: null, 3: null, 4: null },
  },
  101: {
    name: "Scroll_Texture_Right",
    nearest: { 0: "speed", 1: scrolledParts, 2: null, 3: null, 4: null },
  },
  104: {
    name: "Ceiling_CrushAndRaiseSilentDist",
    nearest: { 1: "where it stops", 2: "speed", 3: "damage", 4: "crushing" },
  },
  112: { name: "Light_ChangeToValue", nearest: {} },
  168: {
    name: "Ceiling_CrushAndRaiseDist",
    nearest: { 1: "where it stops", 2: "speed", 3: "damage", 4: "crushing" },
  },
  169: { name: "Generic_Crusher2", nearest: {} },
  192: {
    name: "Ceiling_LowerToHighestFloor",
    nearest: { 1: "speed", 2: "texture", 3: "damage", 4: "where it stops" },
  },
  200: { name: "Generic_Floor", nearest: {} },
  201: {
    name: "Generic_Ceiling",
    nearest: { 1: "speed" },
  },
  202: { name: "Generic_Door", nearest: {} },
  203: { name: "Generic_Lift", nearest: {} },
  204: { name: "Generic_Stairs", nearest: {} },
  205: { name: "Generic_Crusher", nearest: {} },
  206: {
    name: "Plat_DownWaitUpStayLip",
    nearest: { 1: "speed", 2: "delay", 3: "height", 4: "sound" },
  },
  207: {
    name: "Plat_PerpetualRaiseLip",
    nearest: { 1: "speed", 2: "delay", 3: "height" },
  },
  208: {
    name: "TranslucentLine",
    nearest: { 1: "opacity", 2: "blending" },
  },
  209: { name: "Transfer_Heights", nearest: {} },
  210: { name: "Transfer_FloorLight", nearest: {} },
  211: { name: "Transfer_CeilingLight", nearest: {} },
  215: { name: "Teleport_Line", nearest: {} },
  217: {
    name: "Stairs_BuildUpDoom",
    nearest: { 1: "speed", 3: "delay", 4: "stairs reset" },
  },
  218: { name: "Sector_SetWind", nearest: {} },
  219: { name: "Sector_SetFriction", nearest: {} },
  220: { name: "Sector_SetCurrent", nearest: {} },
  222: { name: "Scroll_Texture_Model", nearest: {} },
  223: { name: "Scroll_Floor", nearest: {} },
  224: { name: "Scroll_Ceiling", nearest: {} },
  225: { name: "Scroll_Texture_Offsets", nearest: {} },
  227: { name: "PointPush_SetForce", nearest: {} },
  228: {
    name: "Plat_RaiseAndStayTx0",
    nearest: {
      1: "speed",
      2: null,
      3: onlyMode(2, "floor lock"),
      4: null,
    },
  },
  230: {
    name: "Plat_UpByValueStayTx",
    nearest: { 1: "speed" },
  },
  231: { name: "Plat_ToggleCeiling", nearest: {} },
  232: {
    name: "Light_StrobeDoom",
    nearest: { 1: "timing", 2: "timing" },
  },
  233: { name: "Light_MinNeighbor", nearest: {} },
  234: { name: "Light_MaxNeighbor", nearest: {} },
  235: { name: "Floor_TransferTrigger", nearest: {} },
  236: { name: "Floor_TransferNumeric", nearest: {} },
  238: {
    name: "Floor_RaiseToLowestCeiling",
    nearest: { 1: "speed", 2: "texture", 3: "damage", 4: null },
  },
  239: {
    name: "Floor_RaiseByValueTxTy",
    nearest: { 1: "speed" },
  },
  240: {
    name: "Floor_RaiseByTexture",
    nearest: { 1: "speed", 2: "texture", 3: "damage" },
  },
  241: {
    name: "Floor_LowerToLowestTxTy",
    nearest: { 1: "speed" },
  },
  242: {
    name: "Floor_LowerToHighest",
    nearest: { 1: "speed", 3: "height" },
  },
  243: {
    name: "Exit_Normal",
    nearest: { 0: "start spot" },
  },
  244: {
    name: "Exit_Secret",
    nearest: { 0: "start spot" },
  },
  245: {
    name: "Elevator_RaiseToNearest",
    nearest: { 1: "speed" },
  },
  246: {
    name: "Elevator_MoveToFloor",
    nearest: { 1: "speed" },
  },
  247: {
    name: "Elevator_LowerToNearest",
    nearest: { 1: "speed" },
  },
  249: {
    name: "Door_CloseWaitOpen",
    nearest: { 1: "speed", 2: "delay", 3: "light" },
  },
  250: {
    name: "Floor_Donut",
    nearest: { 1: "speed", 2: "speed" },
  },
  251: {
    name: "FloorAndCeiling_LowerRaise",
    nearest: { 1: "speed", 2: "speed", 3: "Boom bug" },
  },
  253: {
    name: "Ceiling_LowerToLowest",
    nearest: { 1: "speed", 2: "texture", 3: "damage" },
  },
  254: {
    name: "Ceiling_LowerToFloor",
    nearest: { 1: "speed", 2: "texture", 3: "damage", 4: "where it stops" },
  },
  273: {
    name: "Stairs_BuildUpDoomCrush",
    nearest: { 1: "speed", 3: "delay", 4: "stairs reset" },
  },
  284: { name: "Generic_CrusherDist", nearest: {} },
};

const scripts = new Set([80, 81, 82, 83, 84, 226]);

export function hexenSpecialName(special: number) {
  if (scripts.has(special)) return "ACS scripts";
  return hexenSpecials[special]?.name ?? `Hexen special ${special}`;
}

// A Doom special that matches exactly wins, since it plays in every engine,
// unless monsters can trigger the line, which only a generalized one can say.
export function doomActionFor(given: HexenAction): DoomAction | null {
  const doom = fixedActionFor(given);
  if (doom && doom.changes.length === 0 && !given.monsters) return doom;
  const generalized = generalizedActionFor(given);
  if (generalized || !doom) return generalized ?? doom;
  if (
    !given.monsters ||
    given.trigger === "monster-walk" ||
    given.trigger === "none" ||
    monsterSpecials.has(doom.special)
  ) {
    return doom;
  }
  return { ...doom, changes: orderedChanges([...doom.changes, "monsters"]) };
}

// The Doom specials GZDoom's xlat/base.txt lets monsters trigger.
const monsterSpecials = new Set([
  1, 4, 10, 32, 33, 34, 39, 46, 88, 97, 174, 195, 207, 208, 209, 210, 243, 244,
  262, 263,
]);

const candidates = new Map<number, typeof hexenTranslations>();
for (const translation of hexenTranslations) {
  const [, , , special] = translation;
  candidates.set(special, [...(candidates.get(special) ?? []), translation]);
}

// Specials Doom has no row for, as the row that moves the same way, with the
// lip or distance each one has built in, and what the row always changes.
const aliases: Record<
  number,
  {
    special: number;
    args: (args: number[]) => number[];
    changes?: ActionChange[];
  }
> = {
  // Ceiling_CrushAndRaise rises at half its speed down.
  42: {
    special: 168,
    args: ([tag, speed, crush, mode]) => [tag, 8, speed, crush, mode],
    changes: ["speed"],
  },
  60: { special: 207, args: ([tag, speed, delay]) => [tag, speed, delay, 8] },
  62: { special: 206, args: ([tag, speed, delay]) => [tag, speed, delay, 8] },
};

const translucentLine = 208;
const offsetScroller = 225;
const teleportLine = 215;
const lockedDoor = 13;
const lockArg = 3;

function fixedActionFor(given: HexenAction): DoomAction | null {
  const alias = aliases[given.special];
  const action = alias
    ? { ...given, special: alias.special, args: alias.args(given.args) }
    : given;
  const nearest = hexenSpecials[action.special]?.nearest ?? {};
  let best: { action: DoomAction; distance: number } | null = null;
  for (const [doom, trigger, repeat, , args] of candidates.get(
    action.special,
  ) ?? []) {
    if (trigger !== action.trigger) continue;
    let tag: number | null = null;
    let distance = repeat === action.repeat ? 0 : 10;
    const changes = new Set<ActionChange>(alias?.changes);
    if (repeat !== action.repeat) changes.add("repeat");
    for (const [index, value] of action.args.entries()) {
      const wanted = index < args.length ? args[index] : 0;
      if (wanted === null) continue;
      if (wanted === "tag") {
        // Woof refuses an MBF21 scroller that names no line.
        if (
          value === 0 &&
          (index === 0
            ? action.special !== translucentLine
            : action.special === offsetScroller)
        ) {
          distance = Infinity;
        }
        tag ??= value;
      } else if (action.special === lockedDoor && index === lockArg) {
        if (keyOf(value) !== keyOf(wanted)) distance = Infinity;
        else if (value !== wanted) {
          distance += 0.5;
          changes.add("key");
        }
      } else if (value !== wanted) {
        const change = nearest[index];
        if (change === undefined) {
          distance = Infinity;
        } else if (typeof change === "function") {
          const changed = change(value);
          if (changed) {
            distance += 1;
            changes.add(changed);
          }
        } else {
          distance += Math.abs(Math.log((value + 1) / (wanted + 1)));
          if (change) changes.add(change);
        }
      }
    }
    // Boom sends a line teleport to the other line with its own tag, so the
    // line has to carry the number of the one it sends to.
    if (action.special === teleportLine && (!tag || action.id !== tag)) {
      continue;
    }
    if (distance === Infinity || (best && best.distance <= distance)) continue;
    best = {
      action: {
        special: doom,
        tag: tag ?? 0,
        changes: orderedChanges(changes),
      },
      distance,
    };
  }
  return best?.action ?? null;
}

export function orderedChanges(changes: Iterable<ActionChange>) {
  const given = new Set(changes);
  return actionChanges.filter((change) => given.has(change));
}

function keyOf(lock: number) {
  const card = lock & 0x7f;
  return card >= 1 && card <= 6 ? ((card - 1) % 3) + 1 : null;
}

// GZDoom's xlat/base.txt turns each Boom generalized range into one of these,
// with each bit field's options as the argument values listed here.
const genericCrusher2 = 169;
const genericFloor = 200;
const genericCeiling = 201;
const genericDoor = 202;
const genericLift = 203;
const genericStairs = 204;
const genericCrusher = 205;
const genericCrusherDist = 284;
const moverSpeeds = [8, 16, 32, 64];
const doorSpeeds = [16, 32, 64, 128];
const liftSpeeds = [16, 32, 64, 128];
const stairSpeeds = [2, 4, 16, 32];
const stairSteps = [4, 8, 16, 24];
const doorDelays = [8, 34, 69, 240];
const liftDelays = [8, 24, 40, 80];
const moverHeights = [24, 32];
const moverTargets = 6;
const liftTargets = 4;
const lockedDoorWait = 34;
const crusherDamage = 10;
const doorKindMask = 63;
const doorLightTag = 128;
const cardIsSkull = 128;
const boomKeys = new Map([
  [100, 0],
  [1, 1],
  [2, 2],
  [3, 3],
  [4, 4],
  [5, 5],
  [6, 6],
  [101, 7],
]);

function generalizedActionFor({
  special,
  args,
  trigger,
  repeat,
  monsters = false,
}: HexenAction): DoomAction | null {
  const [tag, speed, third, fourth, fifth] = args;
  const changes = new Set<ActionChange>();
  // Boom lets players walk over a line that monsters can.
  if (trigger === "monster-walk") changes.add("trigger");
  const canMonsters = trigger === "monster-walk" || monsters;
  const pick = (value: number, options: number[], change: ActionChange) => {
    const index = closest(value, options);
    if (options[index] !== value) changes.add(change);
    return index;
  };
  // A pressed line with no tag works the sector behind it, as Boom's door
  // triggers do; GZDoom writes them that way.
  const boomTrigger = (isManual: boolean) => {
    const base =
      trigger === "use"
        ? isManual
          ? 6
          : 2
        : (trigger === "walk" || trigger === "monster-walk") && tag !== 0
          ? 0
          : trigger === "shoot" && tag !== 0
            ? 4
            : null;
    return base === null ? null : base | (repeat ? 1 : 0);
  };
  const result = (
    name: GeneralizedClass,
    values: Record<string, number> | null,
  ): DoomAction | null =>
    values && {
      special: encodeGeneralized(name, values),
      tag,
      changes: orderedChanges(changes),
    };

  if (special === genericFloor || special === genericCeiling) {
    const flags = fifth;
    const change = flags & 3;
    const boom = boomTrigger(tag === 0);
    if (boom === null) return null;
    if (change !== 0 && canMonsters) changes.add("monsters");
    return result(special === genericFloor ? "floor" : "ceiling", {
      trigger: boom,
      speed: pick(speed, moverSpeeds, "speed"),
      direction: flags & 8 ? 1 : 0,
      target:
        fourth >= 1 && fourth <= moverTargets
          ? fourth - 1
          : moverTargets + pick(third, moverHeights, "height"),
      change,
      ...(change === 0
        ? { monsters: canMonsters ? 1 : 0 }
        : { model: flags & 4 ? 1 : 0 }),
      crush: flags & 16 ? 1 : 0,
    });
  }
  if (special === genericDoor) {
    const kind = third & doorKindMask;
    if (kind > 3) return null;
    if (third & doorLightTag && trigger !== "use") return null;
    const boom = boomTrigger(tag === 0 || (third & doorLightTag) !== 0);
    const key = fifth === 0 ? null : boomKeys.get(fifth & ~cardIsSkull);
    if (boom === null || key === undefined) return null;
    if (key !== null && kind <= 1) {
      if (kind === 0 && fourth !== lockedDoorWait) changes.add("delay");
      if (canMonsters) changes.add("monsters");
      return result("locked", {
        trigger: boom,
        speed: pick(speed, doorSpeeds, "speed"),
        kind,
        key,
        skulls: fifth & cardIsSkull ? 1 : 0,
      });
    }
    if (key !== null) changes.add("key");
    const waits = kind === 0 || kind === 2;
    return result("door", {
      trigger: boom,
      speed: pick(speed, doorSpeeds, "speed"),
      kind,
      delay: waits
        ? pick(fourth, doorDelays, "delay")
        : closest(fourth, doorDelays),
      monsters: canMonsters ? 1 : 0,
    });
  }
  if (special === genericLift) {
    if (fourth < 1 || fourth > liftTargets) return null;
    const boom = boomTrigger(tag === 0);
    return result(
      "lift",
      boom === null
        ? null
        : {
            trigger: boom,
            speed: pick(speed, liftSpeeds, "speed"),
            delay: pick(third, liftDelays, "delay"),
            target: fourth - 1,
            monsters: canMonsters ? 1 : 0,
          },
    );
  }
  if (special === genericStairs) {
    const boom = boomTrigger(tag === 0);
    if (fifth !== 0) changes.add("stairs reset");
    return result(
      "stairs",
      boom === null
        ? null
        : {
            trigger: boom,
            speed: pick(speed, stairSpeeds, "speed"),
            step: pick(third, stairSteps, "step"),
            direction: fourth & 1,
            ignore: (fourth >> 1) & 1,
            monsters: canMonsters ? 1 : 0,
          },
    );
  }
  if (
    special === genericCrusherDist ||
    special === genericCrusher ||
    special === genericCrusher2
  ) {
    const boom = boomTrigger(tag === 0);
    if (special !== genericCrusherDist) changes.add("where it stops");
    if (special === genericCrusher2) changes.add("crushing");
    if (third !== speed) changes.add("speed");
    if (fifth !== crusherDamage) changes.add("damage");
    return result(
      "crusher",
      boom === null
        ? null
        : {
            trigger: boom,
            speed: pick(speed, moverSpeeds, "speed"),
            silent: fourth ? 1 : 0,
            monsters: canMonsters ? 1 : 0,
          },
    );
  }
  return null;
}

function encodeGeneralized(
  name: GeneralizedClass,
  values: Record<string, number>,
) {
  const kind = defined(generalizedClass(name));
  return kind.fields.reduce(
    (special, field) =>
      field.id in values
        ? withField(special, field, values[field.id])
        : special,
    kind.base,
  );
}

function closest(value: number, options: number[]) {
  const distance = (option: number) =>
    Math.abs(Math.log((value + 1) / (option + 1)));
  return options.reduce(
    (best, option, index) =>
      distance(option) < distance(options[best]) ? index : best,
    0,
  );
}

const sectorTypes = new Map([
  [65, 1],
  [66, 2],
  [67, 3],
  [68, 4],
  [69, 5],
  [71, 7],
  [72, 8],
  [74, 10],
  [75, 11],
  [76, 12],
  [77, 13],
  [78, 14],
  [80, 16],
  [81, 17],
]);
const hexenSecret = 0x400;
const hexenBits = 0x3fe0 << 3;

export function doomSectorSpecialFor(special: number) {
  const type = special & 0xff;
  const bits = special & ~0xff;
  const doomType = type === 0 ? 0 : sectorTypes.get(type);
  if (doomType === undefined || (bits & ~hexenBits) !== 0) return null;
  if (doomType === 0 && bits === hexenSecret) return 9;
  return doomType | (bits >> 3);
}
