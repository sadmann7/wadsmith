import { describe, expect, it } from "vitest";

import type { GameMap, Sector } from "@/lib/map/types";
import type { CheckContext } from "@/lib/map/validate";

import { doorTextures, switchTextures } from "@/lib/map/catalog";
import { testMap } from "@/lib/map/test-map";
import { freedoomNames } from "@/lib/map/textures";
import { readWadAssets } from "@/lib/wad/assets";
import { buildTextureWad } from "@/lib/wad/resources";
import { fakeIwad, solid } from "@/lib/wad/test-wad";

import { runAgentAction } from "./agent-actions";

type Kind = "wall" | "flat";

interface Listed {
  walls: Set<string>;
  flats: Set<string>;
}

interface NamePage {
  items: string[];
  next?: number;
  seeThrough?: string[];
  doors?: string[];
  switches?: string[];
  sky?: string;
}

const grate = solid(32, 64, 90);
grate.opaque.fill(0, 0, 32 * 16);

const resource = buildTextureWad([
  { name: "MYBRICK", image: solid(32, 64, 120) },
  { name: "MYGRATE", image: grate },
  { name: "MYFLOOR", image: solid(64, 64, 80) },
]);

const games: [string, CheckContext][] = [
  ["Freedoom's names", {}],
  [
    "a game with a resource",
    { names: readWadAssets(fakeIwad(), [resource]).names },
  ],
];

function listAll(of: "walls" | "flats", context: CheckContext) {
  const names: string[] = [];
  let first: NamePage | undefined;
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const page = runAgentAction(
      testMap,
      "listCatalog",
      { of, offset, limit: 1000 },
      context,
    ).result as NamePage;
    first ??= page;
    names.push(...page.items);
    offset = page.next;
  }
  const rest = first ?? { items: [] };
  return [
    ...names,
    ...(rest.seeThrough ?? []),
    ...(rest.doors ?? []),
    ...(rest.switches ?? []),
    ...(rest.sky === undefined ? [] : [rest.sky]),
  ];
}

function listed(context: CheckContext): Listed {
  return {
    walls: new Set(listAll("walls", context)),
    flats: new Set(listAll("flats", context)),
  };
}

// The test map wearing names this game has, so a refusal can only come from
// the name an action is given.
function mapFor({ walls, flats }: Listed): GameMap {
  const wall = [...walls][0];
  const flat = [...flats][0];
  return {
    ...testMap,
    sectors: testMap.sectors.map((sector) => ({
      ...sector,
      floorTexture: flat,
      ceilingTexture: flat,
      wallTexture: wall,
      ...(sector.door && { door: { ...sector.door, texture: wall } }),
    })),
    switches: testMap.switches.map((item) => ({ ...item, texture: wall })),
  };
}

type Args = Record<string, unknown>;

const corners = [
  { x: 1200, y: 0 },
  { x: 1328, y: 0 },
  { x: 1328, y: 128 },
  { x: 1200, y: 128 },
];

// Each action that takes a name of that kind, given the name and the room
// textures the game has for the parts it isn't testing.
const uses: Record<Kind, [string, (name: string, own: Sector) => Args][]> = {
  wall: [
    [
      "addRoom",
      (name, own) => ({
        corners,
        floorTexture: own.floorTexture,
        ceilingTexture: own.ceilingTexture,
        wallTexture: name,
      }),
    ],
    ["updateRoom", (name) => ({ room: "Start room", wallTexture: name })],
    [
      "paintSurface",
      (name) => ({
        room: "Start room",
        surface: "wall",
        wall: "v1|v6",
        texture: name,
      }),
    ],
    [
      "setLineSide",
      (name) => ({
        wall: "v3|v4",
        room: "Start room",
        upper: name,
        middle: name,
        lower: name,
      }),
    ],
    ["makeDoor", (name) => ({ room: "Arena door", texture: name })],
    ["replaceTexture", (name) => ({ from: "NOSUCH", to: name, kind: "wall" })],
  ],
  flat: [
    [
      "addRoom",
      (name, own) => ({
        corners,
        floorTexture: name,
        ceilingTexture: name,
        wallTexture: own.wallTexture,
      }),
    ],
    ["updateRoom", (name) => ({ room: "Start room", floorTexture: name })],
    ["updateRoom", (name) => ({ room: "Start room", ceilingTexture: name })],
    [
      "paintSurface",
      (name) => ({ room: "Start room", surface: "ceiling", texture: name }),
    ],
    ["replaceTexture", (name) => ({ from: "NOSUCH", to: name, kind: "flat" })],
  ],
};

function refusal(
  map: GameMap,
  action: string,
  args: Args,
  context: CheckContext,
) {
  try {
    runAgentAction(map, action, args, context);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe.each(games)("texture names with %s", (_, context) => {
  const names = listed(context);
  const map = mapFor(names);
  const own = map.sectors[0];
  const lists = { wall: names.walls, flat: names.flats };

  it.each(["wall", "flat"] as const)(
    "takes every %s name listCatalog lists",
    (kind) => {
      const refused = [...lists[kind]].flatMap((name) =>
        uses[kind].flatMap(([action, args]) => {
          const message = refusal(map, action, args(name, own), context);
          return message === null ? [] : [`${action} ${name}: ${message}`];
        }),
      );
      expect(refused).toEqual([]);
    },
  );

  it.each(["wall", "flat"] as const)(
    "lists every %s name the actions take",
    (kind) => {
      const known = context.names ?? freedoomNames;
      const candidates = new Set([
        ...known.walls,
        ...known.middles,
        ...known.textures,
        ...known.flats,
        ...known.custom,
        ...doorTextures,
        ...switchTextures,
        "F_SKY1",
      ]);
      const unlisted = [...candidates].flatMap((name) =>
        uses[kind].flatMap(([action, args]) =>
          !lists[kind].has(name) &&
          refusal(map, action, args(name, own), context) === null
            ? [`${action} ${name}`]
            : [],
        ),
      );
      expect(unlisted).toEqual([]);
    },
  );

  it.each(["wall", "flat"] as const)(
    "points a refused %s name to a list that holds its suggestions",
    (kind) => {
      for (const [action, args] of uses[kind]) {
        for (const wrong of ["NOSUCHTX", "MYBRIK", "F_SKY", "ZZ"]) {
          const message = refusal(map, action, args(wrong, own), context);
          expect(message, `${action} ${wrong}`).not.toBeNull();
          const match =
            /The closest are (.+)\. listCatalog of (\w+) names/.exec(
              message ?? "",
            );
          expect(match, message ?? "").not.toBeNull();
          const [, closest, list] = match ?? [];
          expect(list).toBe(`${kind}s`);
          for (const name of closest.split(", ")) {
            expect(lists[kind], `${action} suggests ${name}`).toContain(name);
          }
        }
      }
    },
  );
});
