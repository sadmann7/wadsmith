import { describe, expect, it } from "vitest";

import type { GameMap, Sector } from "@/lib/map/types";
import type { CheckContext } from "@/lib/map/validate";

import { doorTextures, switchTextures } from "@/lib/map/catalog";
import { testMap } from "@/lib/map/test-map";
import { freedoomNames } from "@/lib/map/textures";
import { readWadAssets } from "@/lib/wad/assets";
import { buildTextureWad } from "@/lib/wad/resources";
import { fakeIwad, solid } from "@/lib/wad/test-wad";

import { agentActions, runAgentAction } from "./agent-actions";

type Kind = "wall" | "flat" | "switch";

type Args = Record<string, unknown>;

type Use = [action: string, args: (name: string, own: Sector) => Args];

interface Listed {
  walls: Set<string>;
  flats: Set<string>;
  switches: Set<string>;
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

const corners = [
  { x: 1200, y: 0 },
  { x: 1328, y: 0 },
  { x: 1328, y: 128 },
  { x: 1200, y: 128 },
];

// Each action that takes a name of that kind. The parts a use doesn't test
// keep the room's own textures, which the game has.
const uses: Record<Kind, Use[]> = {
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
    [
      "replaceTexture",
      (name, own) => ({ from: own.wallTexture, to: name, kind: "wall" }),
    ],
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
    [
      "updateRoom",
      (name) => ({
        room: "Start room",
        floorTexture: name,
        ceilingTexture: name,
      }),
    ],
    [
      "paintSurface",
      (name) => ({ room: "Start room", surface: "ceiling", texture: name }),
    ],
    [
      "replaceTexture",
      (name, own) => ({ from: own.floorTexture, to: name, kind: "flat" }),
    ],
  ],
  switch: [["addSwitch", (name) => ({ wall: "v1|v6", texture: name })]],
};

const kinds = ["wall", "flat", "switch"] as const;

const listOf = { wall: "walls", flat: "flats", switch: "walls" } as const;

const timeout = 30_000;

describe.each(games)("texture names with %s", (_, context) => {
  const names = listed(context);
  const map = mapFor(names);
  const own = map.sectors[0];
  const lists = {
    wall: names.walls,
    flat: names.flats,
    switch: names.switches,
  };

  describe.each(kinds)("%s names", (kind) => {
    it.each(uses[kind])(
      "%s takes every name listCatalog lists",
      (action, args) => {
        const refused = [...lists[kind]].flatMap((name) => {
          const message = refusal(map, action, args(name, own), context);
          return message === null ? [] : [`${name}: ${message}`];
        });
        expect(refused).toEqual([]);
      },
      timeout,
    );

    it.each(uses[kind])(
      "%s takes no name listCatalog leaves out",
      (action, args) => {
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
        const unlisted = [...candidates].filter(
          (name) =>
            !lists[kind].has(name) &&
            refusal(map, action, args(name, own), context) === null,
        );
        expect(unlisted).toEqual([]);
      },
      timeout,
    );

    it.each(uses[kind])(
      "%s points a refused name to a list that holds its suggestions",
      (action, args) => {
        for (const wrong of ["NOSUCHTX", "MYBRIK", "F_SKY", "ZZ"]) {
          const message = refusal(map, action, args(wrong, own), context);
          if (lists[kind].size === 0) {
            expect(message).toMatch(/has no switch textures/);
            continue;
          }
          const match =
            /The closest are (.+)\. listCatalog of (\w+) names/.exec(
              message ?? "",
            );
          expect(match, `${wrong}: ${message}`).not.toBeNull();
          const [, closest, list] = match ?? [];
          expect(list).toBe(listOf[kind]);
          for (const name of closest.split(", ")) {
            expect(lists[kind], `suggests ${name}`).toContain(name);
          }
        }
      },
    );
  });

  it("addRoom with no textures gives the room names listCatalog lists", () => {
    const next = runAgentAction(map, "addRoom", { corners }, context).map;
    const added = next.sectors.at(-1);
    expect(names.flats).toContain(added?.floorTexture);
    expect(names.flats).toContain(added?.ceilingTexture);
    expect(names.walls).toContain(added?.wallTexture);
  });

  it("makeDoor with no texture uses a wall listCatalog lists", () => {
    const next = runAgentAction(
      map,
      "makeDoor",
      { room: "Arena door" },
      context,
    ).map;
    const door = next.sectors.find((sector) => sector.name === "Arena door");
    expect(names.walls).toContain(door?.door?.texture);
  });

  it.each([
    ["addSwitch", { wall: "v1|v6" }],
    ["addDoorSwitch", { room: "Start room", door: "Arena door" }],
  ])("%s with no texture uses a switch listCatalog lists", (action, args) => {
    if (names.switches.size === 0) {
      expect(refusal(map, action, args, context)).toMatch(
        /has no switch textures/,
      );
      return;
    }
    const next = runAgentAction(map, action, args, context).map;
    expect(names.switches).toContain(next.switches.at(-1)?.texture);
  });

  it.each(["DOOR", "SW1", "BIG", "STAR", "Z"])(
    "a search for %s narrows every list of walls",
    (search) => {
      const page = runAgentAction(
        testMap,
        "listCatalog",
        { of: "walls", search, limit: 1000 },
        context,
      ).result as NamePage;
      const shown = [
        ...page.items,
        ...(page.seeThrough ?? []),
        ...(page.doors ?? []),
        ...(page.switches ?? []),
      ];
      expect(shown.filter((name) => !name.includes(search))).toEqual([]);
    },
  );
});

it("no help text or choice names a texture a game may lack", () => {
  const textures = new Set([
    ...freedoomNames.textures,
    ...freedoomNames.flats,
    ...doorTextures,
    ...switchTextures,
    "F_SKY1",
  ]);
  const named = agentActions.flatMap(({ name, description, params }) =>
    [
      description,
      ...params.flatMap((param) => [
        param.description,
        ...(param.choices ?? []),
      ]),
    ].flatMap((help) =>
      [...help.matchAll(/[A-Z][A-Z0-9_]{2,7}/g)]
        .map(([word]) => word)
        .filter((word) => textures.has(word))
        .map((word) => `${name}: ${word}`),
    ),
  );
  expect(named).toEqual([]);
});

function listed(context: CheckContext): Listed {
  return {
    walls: new Set(listAll("walls", context)),
    flats: new Set(listAll("flats", context)),
    switches: new Set(firstPage("walls", context).switches),
  };
}

function firstPage(of: "walls" | "flats", context: CheckContext) {
  return runAgentAction(testMap, "listCatalog", { of }, context)
    .result as NamePage;
}

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
  return [
    ...names,
    ...(first?.seeThrough ?? []),
    ...(first?.doors ?? []),
    ...(first?.switches ?? []),
    ...(first?.sky === undefined ? [] : [first.sky]),
  ];
}

// The test map wearing names the game has, so a refusal can only come from
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
