import type {
  Complevel,
  DoorSettings,
  GameMap,
  LineActionKind,
  LineTrigger,
  Point,
  Sector,
  SectorEffect,
  Thing,
  ThingKind,
  ThingSkill,
} from "@/lib/map/types";

import { defined } from "@/lib/defined";
import { mapBalance } from "@/lib/map/balance";
import { sectorSpecialPatch } from "@/lib/map/boom";
import {
  doorTextures,
  getIsPlayerStart,
  sectorEffects,
  switchTextures,
  thingCatalog,
  thingKinds,
} from "@/lib/map/catalog";
import { checkMap, fixIssue } from "@/lib/map/checks";
import {
  addDetail,
  addNote,
  addRoomOnSide,
  addSwitch,
  addSwitchInRoom,
  addThing,
  applyPositions,
  defaultDoor,
  fillHole,
  freeWallAt,
  gridSize,
  makePillar,
  mergeCorners,
  newRoomLooks,
  removeDetailLine,
  removeHole,
  removeNote,
  removeSector,
  removeSwitch,
  removeThing,
  roomCenter,
  type RoomSide,
  setLineTarget,
  setRoomDoor,
  setRoomWalls,
  splitWall,
  updateLine,
  updateLineSide,
  updateSector,
  updateSwitch,
  updateThing,
} from "@/lib/map/edit";
import {
  boxOf,
  sectorAt,
  sectorDetails,
  sectorLoops,
  sectorPolygon,
  wallKey,
  wallOwners,
} from "@/lib/map/geometry";
import {
  describeLine,
  fitLineAction,
  keyColors,
  keysFor,
  lineActionKinds,
  lineActions,
  type LineSides,
  lineTriggers,
  lineUsesTag,
  newLineAction,
  triggersFor,
} from "@/lib/map/lines";
import {
  drawLines,
  drawRoom,
  joinRooms,
  removeCorner,
} from "@/lib/map/reshape";
import { describeSurface, paintSurface } from "@/lib/map/surfaces";
import { countTexture, replaceTexture } from "@/lib/map/texture-tools";
import { freedoomNames } from "@/lib/map/textures";
import {
  type CheckContext,
  doorKey,
  inspectMap,
  type MapIssue,
} from "@/lib/map/validate";
import { compileLumps } from "@/lib/wad/compile";
import { vanillaWarnings } from "@/lib/wad/vanilla-check";

type ParamType = "string" | "number" | "boolean" | "points" | "strings";

export interface AgentParam {
  name: string;
  type: ParamType;
  description: string;
  optional?: boolean;
  choices?: readonly string[];
}

type Args = Record<string, unknown>;

// One thing an agent can ask of a map. A read reports on the map and leaves
// it alone, and an edit returns the map it makes.
export interface AgentAction {
  name: string;
  description: string;
  reads?: boolean;
  params: AgentParam[];
  run: (
    map: GameMap,
    args: Args,
    context: CheckContext,
  ) => { map?: GameMap; result?: unknown };
}

// What an action did: the map as it now stands, what the action reported,
// the problems that were fixed on the way and what the map still needs.
export interface AgentOutcome {
  map: GameMap;
  result: unknown;
  fixed: string[];
  todo: string[];
}

const sides: RoomSide[] = ["north", "east", "south", "west"];
const skills: ThingSkill[] = ["easy", "medium", "hard"];
const complevels: Complevel[] = ["vanilla", "boom", "mbf", "mbf21"];
const wallParts = ["middle", "upper", "lower"] as const;
const catalogs = [
  "things",
  "walls",
  "flats",
  "line-actions",
  "sector-effects",
] as const;

const depthLimit = 4096;

const maxNameLength = 80;
const maxNoteLength = 200;

// Problems an agent finishes with a later edit, like a door that waits for
// its switch. They are reported back and never refuse the edit.
const unfinished =
  /^(empty|no-player|door-unwired|switch-unwired|line-key|door-key)(:|$)/;

const room = (description = "A room's id or name."): AgentParam => ({
  name: "room",
  type: "string",
  description,
});
const wall: AgentParam = {
  name: "wall",
  type: "string",
  description: 'A wall, as its two corner ids joined by "|", like "v1|v2".',
};
const optional = (param: AgentParam): AgentParam => ({
  ...param,
  optional: true,
});
const roomLooks: AgentParam[] = [
  { name: "name", type: "string", description: "What to call the room." },
  { name: "floor", type: "number", description: "The floor's height." },
  { name: "ceiling", type: "number", description: "The ceiling's height." },
  { name: "light", type: "number", description: "Brightness, 0 to 255." },
  { name: "floorTexture", type: "string", description: "The floor's flat." },
  {
    name: "ceilingTexture",
    type: "string",
    description: 'The ceiling\'s flat. "F_SKY1" opens it to the sky.',
  },
  {
    name: "wallTexture",
    type: "string",
    description: "The texture on every wall of the room.",
  },
].map((param) => optional(param as AgentParam));
const thingToggles = [
  ["ambush", "A monster that waits until it sees the player."],
  ["multiplayer", "Appears only in a multiplayer game."],
  ["notDeathmatch", "Stays out of a deathmatch. Boom and later."],
  ["notCoop", "Stays out of a co-op game. Boom and later."],
  ["friendly", "A monster that fights beside the player. MBF and later."],
] as const;
// A wall's flags, each with what setting it does.
const lineFlags = [
  ["blocksAll", "Blocks players and monsters, like a window."],
  ["blocksEnemies", "Blocks monsters only."],
  ["upperFixed", "The upper texture hangs from the ceiling."],
  ["lowerFixed", "The lower texture starts at the floor."],
  ["secret", "The automap draws it as a solid wall."],
  ["hidden", "The automap never draws it."],
  ["mapped", "The automap shows it from the start."],
  ["soundBlock", "Stops sound from carrying past two of these."],
  ["passUse", "A press passes on to the lines behind it. Boom and later."],
  ["solid", "An inner room's wall stays solid."],
  ["shut", "A door's own line that doesn't open it from this side."],
  ["scrolls", "The wall's texture scrolls sideways. Not with an action."],
] as const;
const thingFlags: AgentParam[] = [
  {
    name: "angle",
    type: "number",
    description: "Where it faces, in degrees: 0 east, 90 north.",
  },
  {
    name: "skills",
    type: "strings",
    description: "The difficulties it appears on. Leave out for all three.",
    choices: skills,
  },
  ...thingToggles.map(([name, description]) => ({
    name,
    type: "boolean",
    description,
  })),
].map((param) => optional(param as AgentParam));

const pageLimit = 50;

const paging: AgentParam[] = [
  optional({
    name: "offset",
    type: "number",
    description: "How many to skip, to read the next page.",
  }),
  optional({
    name: "limit",
    type: "number",
    description: `How many to return, up to ${pageLimit}.`,
  }),
];

const namePageLimit = 1000;

const overviewRooms = 30;

export const agentActions: AgentAction[] = [
  {
    name: "help",
    description: "Lists every action with what it takes.",
    reads: true,
    params: [],
    run: () => ({
      result: agentActions.map(({ name, description, reads, params }) => ({
        name,
        description,
        reads: Boolean(reads),
        params: params.map((param) => ({
          ...param,
          optional: Boolean(param.optional),
        })),
      })),
    }),
  },
  {
    name: "describeMap",
    description:
      "An overview of the map: its size, the first rooms, how many things of each kind, and what it still needs. listRooms pages through every room.",
    reads: true,
    params: [],
    run: (map, _args, context) => ({
      result: {
        name: map.name ?? null,
        complevel: map.complevel ?? "vanilla",
        // Coordinates are in map units with y running down, so north is up
        // on the map and a smaller y.
        axes: "x runs east, y runs south",
        ...(map.sectors.length > 0 && {
          bounds: boxOf(Object.values(map.vertices)),
        }),
        roomCount: map.sectors.length,
        rooms: map.sectors.slice(0, overviewRooms).map((sector) => ({
          id: sector.id,
          name: sector.name,
          center: roomCenter(map, sector),
        })),
        things: countBy(map.things.map((thing) => thing.kind)),
        switches: map.switches.length,
        notes: map.notes?.length ?? 0,
        todo: problems(inspectMap(map, context).errors),
      },
    }),
  },
  {
    name: "listRooms",
    description:
      "Rooms with their heights, light, box and middle, a page at a time. Filter by name, or sort by distance from a point. describeRoom has a room's walls.",
    reads: true,
    params: [
      optional({
        name: "name",
        type: "string",
        description: "Only rooms whose name contains this.",
      }),
      optional({
        name: "x",
        type: "number",
        description: "With y, sort nearest to this point.",
      }),
      optional({
        name: "y",
        type: "number",
        description: "With x, sort nearest to this point.",
      }),
      ...paging,
    ],
    run: (map, args) => {
      const query =
        args.name === undefined ? "" : text(args, "name").toLowerCase();
      const rooms = map.sectors
        .filter((sector) => sector.name.toLowerCase().includes(query))
        .map((sector) => roomSummary(map, sector));
      if (args.x !== undefined && args.y !== undefined) {
        const at = {
          x: number(args, "x", -32768, 32767),
          y: number(args, "y", -32768, 32767),
        };
        rooms.sort(
          (a, b) =>
            Math.hypot(a.center.x - at.x, a.center.y - at.y) -
            Math.hypot(b.center.x - at.x, b.center.y - at.y),
        );
      }
      return { result: page(rooms, args, 20) };
    },
  },
  {
    name: "describeRoom",
    description:
      "One room in full, with every wall's textures and action, and the lines drawn inside it.",
    reads: true,
    params: [room()],
    run: (map, args) => ({
      result: roomDetail(map, findRoom(map, args.room)),
    }),
  },
  {
    name: "listThings",
    description:
      "Things with their place, room and flags, a page at a time, in one room or of one kind.",
    reads: true,
    params: [
      optional(room("Only the things in this room.")),
      optional({
        name: "kind",
        type: "string",
        description: "Only things of this kind.",
      }),
      ...paging,
    ],
    run: (map, args) => {
      const only = args.room === undefined ? null : findRoom(map, args.room).id;
      const kind = args.kind === undefined ? null : thingKind(args, "kind");
      const things = map.things
        .map((thing) => ({
          ...thing,
          label: thingCatalog[thing.kind].label,
          room: sectorAt(map, thing)?.id ?? null,
        }))
        .filter(
          (thing) =>
            (only === null || thing.room === only) &&
            (kind === null || thing.kind === kind),
        );
      return { result: page(things, args, 50) };
    },
  },
  {
    name: "listLines",
    description:
      "Walls that have an action, a switch, flags or their own textures, a page at a time.",
    reads: true,
    params: paging,
    run: (map, args) => ({
      result: page(
        [...wallOwners(map)].flatMap(([key, owners]) => {
          const settings = map.lines?.[key];
          const mapSwitch = map.switches.find(
            (item) => wallKey(item.from, item.to) === key,
          );
          if (!settings && !mapSwitch) return [];
          return [
            {
              wall: key,
              rooms: [...new Set(owners.map((owner) => owner.id))],
              ...settings,
              ...(mapSwitch && { switch: mapSwitch.id }),
            },
          ];
        }),
        args,
        30,
      ),
    }),
  },
  {
    name: "checkMap",
    description:
      "The map's errors and warnings, including where a Vanilla map would overflow the original game's limits, and how its health, ammo and keys balance against its monsters on a difficulty. keysNeeded counts the key colors locked lines ask for, and keysMissing those with no key on the map on that difficulty.",
    reads: true,
    params: [
      optional({
        name: "skill",
        type: "string",
        description: "The difficulty to balance for. Medium when left out.",
        choices: skills,
      }),
    ],
    run: (map, args, context) => {
      const issues = [...checkMap(map, context), ...builtWarnings(map)];
      const of = (severity: "error" | "warning") =>
        issues
          .filter((issue) => issue.severity === severity)
          .map(({ id, message, detail, target }) => ({
            id,
            message,
            ...(detail ? { detail } : {}),
            target,
          }));
      return {
        result: {
          errors: of("error"),
          warnings: of("warning"),
          balance: mapBalance(
            map,
            choice(args, "skill", skills, "medium"),
            context.custom,
          ),
        },
      };
    },
  },
  {
    name: "listCatalog",
    description:
      "The names an action takes: thing kinds, wall textures, flats, line actions or sector effects. Walls and flats are every one the game has, a page at a time, and walls also names the see-through textures for the middle of an open line.",
    reads: true,
    params: [
      {
        name: "of",
        type: "string",
        description: "Which list to read.",
        choices: catalogs,
      },
      optional({
        name: "search",
        type: "string",
        description:
          "Only the wall textures or flats whose names contain this, like STAR or NUKAGE.",
      }),
      optional({ ...paging[0] }),
      optional({
        name: "limit",
        type: "number",
        description: `How many wall textures or flats to return, up to ${namePageLimit}.`,
      }),
    ],
    run: (_map, args, context) => ({
      result: catalog(choice(args, "of", catalogs), args, context),
    }),
  },
  {
    name: "addRoom",
    description:
      "Draws a room from its corners, in order. Corners that land on another room's wall join it, so the two rooms open onto each other. A room drawn inside another sits in it like a platform or a pit. One drawn inside another against its wall, like a bridge from the wall to an island, cuts the outer room round it, and splits it in two when it runs from wall to wall. One drawn partly over another cuts it, the overlap staying part of the old room.",
    params: [
      {
        name: "corners",
        type: "points",
        description: "At least three corners as {x, y}.",
      },
      ...roomLooks,
    ],
    run: (map, args, context) => {
      const corners = points(args, "corners");
      if (corners.length < 3) throw new Error("A room needs three corners.");
      const isFloorOnly =
        args.floor !== undefined && args.ceiling === undefined;
      const added = drawRoom(
        map,
        corners,
        looks(
          args,
          context,
          isFloorOnly ? undefined : newRoomLooks(map, corners),
        ),
        1,
      );
      return { map: added.map, result: added.id };
    },
  },
  {
    name: "addConnectedRoom",
    description:
      "Adds a room on a free wall of another, as wide as that wall, and opens the two onto each other.",
    params: [
      room("The room to build from."),
      {
        name: "side",
        type: "string",
        description: "Which way the new room lies.",
        choices: sides,
      },
      optional({
        name: "depth",
        type: "number",
        description: "How far the new room reaches. 192 when left out.",
      }),
      optional(roomLooks[1]),
      optional(roomLooks[2]),
    ],
    run: (map, args) => {
      const source = findRoom(map, args.room);
      const side = choice(args, "side", sides);
      const depth = number(args, "depth", gridSize, depthLimit, 192);
      const heights =
        args.floor === undefined && args.ceiling === undefined
          ? { floor: source.floor, ceiling: source.ceiling }
          : heightsOf(args, source);
      const added = addRoomOnSide(map, source.id, side, depth, heights);
      if (!added) {
        throw new Error(`${source.name} has no free wall facing ${side}.`);
      }
      return { map: added.map, result: added.id };
    },
  },
  {
    name: "updateRoom",
    description:
      "Changes a room's name, heights, brightness, textures, effect or tag.",
    params: [
      room(),
      ...roomLooks,
      optional({
        name: "effect",
        type: "string",
        description: 'A sector effect, or "none" to clear it.',
        choices: ["none", ...Object.keys(sectorEffects)],
      }),
      optional({
        name: "tag",
        type: "number",
        description: "The tag line actions find the room by. 0 clears it.",
      }),
      optional({
        name: "special",
        type: "number",
        description:
          "A sector special by its number, for an effect the list doesn't name. 0 clears it.",
      }),
    ],
    run: (map, args, context) => {
      const sector = findRoom(map, args.room);
      const { wallTexture, ...patch } = looks(args, context, sector);
      if (args.effect !== undefined && args.special !== undefined) {
        throw new Error("Give a room an effect or a special, not both.");
      }
      // An effect and a special are one number in the game, so either one
      // takes the other's place.
      const effect =
        args.effect === undefined
          ? {}
          : {
              effect: (choice(args, "effect", [
                "none",
                ...Object.keys(sectorEffects),
              ]) === "none"
                ? undefined
                : args.effect) as SectorEffect | undefined,
              rawEffect: undefined,
            };
      const tag =
        args.tag === undefined
          ? {}
          : { tag: number(args, "tag", 0, 32767) || undefined };
      const special =
        args.special === undefined
          ? {}
          : sectorSpecialPatch(number(args, "special", 0, 65535));
      const updated = updateSector(map, sector.id, {
        ...patch,
        ...effect,
        ...tag,
        ...special,
      });
      return {
        map: wallTexture
          ? setRoomWalls(updated, sector.id, wallTexture)
          : updated,
      };
    },
  },
  {
    name: "setRoomHeights",
    description: "Sets a room's floor and ceiling heights.",
    params: [
      room(),
      { ...roomLooks[1], optional: false },
      { ...roomLooks[2], optional: false },
    ],
    run: (map, args) => {
      const sector = findRoom(map, args.room);
      return { map: updateSector(map, sector.id, heightsOf(args, sector)) };
    },
  },
  {
    name: "removeRoom",
    description: "Removes a room, and with it the switches on its walls.",
    params: [room()],
    run: (map, args) => ({
      map: removeSector(map, findRoom(map, args.room).id),
    }),
  },
  {
    name: "makeDoor",
    description:
      "Turns a thin room between two rooms into a door. It opens when pressed, locked behind a key if given one, or from a switch added with addDoorSwitch.",
    params: [
      room("The room to turn into a door."),
      optional({
        name: "opensBy",
        type: "string",
        description: "How it opens. Pressed when left out.",
        choices: ["use", "switch"],
      }),
      optional({
        name: "closes",
        type: "boolean",
        description: "Whether it shuts again. It does when left out.",
      }),
      optional({
        name: "fast",
        type: "boolean",
        description: "Opens at the fast doors' speed.",
      }),
      optional({
        name: "texture",
        type: "string",
        description: "The texture on the door's face.",
        choices: doorTextures,
      }),
      optional({
        name: "key",
        type: "string",
        description:
          "The key a pressed door needs. Place that key too. None when left out.",
        choices: keyColors,
      }),
    ],
    run: (map, args) => {
      const door: DoorSettings = {
        ...defaultDoor,
        opensBy: choice(args, "opensBy", ["use", "switch"], "use"),
        ...(args.key !== undefined && { key: choice(args, "key", keyColors) }),
        closes: flag(args, "closes") ?? true,
        ...(flag(args, "fast") && { fast: true }),
        ...(args.texture !== undefined && {
          texture: choice(args, "texture", doorTextures),
        }),
      };
      if (door.key && door.opensBy === "switch") {
        throw new Error("A door opened by a switch can't need a key.");
      }
      return { map: setRoomDoor(map, findRoom(map, args.room).id, door) };
    },
  },
  {
    name: "removeDoor",
    description: "Turns a door back into a plain room.",
    params: [room("The door.")],
    run: (map, args) => ({
      map: setRoomDoor(map, findRoom(map, args.room).id, undefined),
    }),
  },
  {
    name: "moveCorner",
    description:
      "Moves a corner, and with it every wall that ends there. A corner moved onto another joins it. Corner ids come from describeRoom.",
    params: [
      { name: "corner", type: "string", description: "The corner's id." },
      { name: "x", type: "number", description: "Where it goes, across." },
      { name: "y", type: "number", description: "Where it goes, down." },
    ],
    run: (map, args) => {
      const id = text(args, "corner");
      if (!map.vertices[id]) throw new Error(`No corner "${id}".`);
      const moved = applyPositions(map, { [id]: pointOf(args) });
      return { map: mergeCorners(moved, [id]) };
    },
  },
  {
    name: "splitWall",
    description: "Adds a corner on a wall, at the point nearest the one given.",
    params: [
      wall,
      { name: "x", type: "number", description: "Near where, across." },
      { name: "y", type: "number", description: "Near where, down." },
    ],
    run: (map, args) => {
      const split = splitWall(map, findWall(map, args.wall), pointOf(args), 1);
      if (!split) throw new Error("That point isn't on the wall.");
      return { map: split.map, result: split.id };
    },
  },
  {
    name: "splitRoom",
    description:
      "Draws a line across rooms. Each stretch that runs from one wall of a room to another splits that room in two, and both halves keep its heights and looks. A stretch that would leave a room whole is refused. To cut a ring round a room inside it, go from the outer wall to the inner room, along its wall and back out, in one line.",
    params: [
      {
        name: "points",
        type: "points",
        description: "The line's points in order, at least two.",
      },
    ],
    run: (map, args) => {
      const corners = points(args, "points");
      const drawn = drawLines(map, corners, 1, "split");
      if (drawn) return { map: drawn.map, result: drawn.rooms };
      if (drawLines(map, corners, 1)) {
        throw new Error(
          "That line leaves a room whole, so nothing changed. Every stretch has to run from one wall of a room to another and cut it in two. A single line from an outer wall to a room inside it doesn't, so go back out along a second one in the same line. For a line that stays in one piece of a room, use addDetailLine.",
        );
      }
      throw new Error("No part of that line lies in a room.");
    },
  },
  {
    name: "joinRooms",
    description:
      "Joins rooms that share walls into one, with the first room's heights and looks, taking out the walls between them.",
    params: [
      {
        name: "rooms",
        type: "strings",
        description: "Two or more room ids or names, the first one kept.",
      },
    ],
    run: (map, args) => {
      const ids = strings(args, "rooms").map((item) => findRoom(map, item).id);
      const joined = joinRooms(map, ids);
      if (!joined) {
        throw new Error(
          "Only rooms side by side, sharing a wall, with the same tag and no doors, can join.",
        );
      }
      return { map: joined.map, result: joined.id };
    },
  },
  {
    name: "removeCorner",
    description:
      "Takes a corner out of the walls that meet at it, joining the two into one. Corner ids come from describeRoom.",
    params: [
      { name: "corner", type: "string", description: "The corner's id." },
    ],
    run: (map, args) => {
      const id = text(args, "corner");
      if (!map.vertices[id]) throw new Error(`No corner "${id}".`);
      const removed = removeCorner(map, id);
      if (!removed) {
        throw new Error(
          "Only a corner between two walls can go, with no switch or two actions on them, and only if the joined wall would cross no other wall or corner.",
        );
      }
      return { map: removed };
    },
  },
  {
    name: "makePillar",
    description:
      "Turns a room drawn inside another into a solid pillar the outer room goes round.",
    params: [room("The inner room.")],
    run: (map, args) => {
      const sector = findRoom(map, args.room);
      const made = makePillar(map, sector.id);
      if (!made) throw new Error(`${sector.name} isn't inside another room.`);
      return { map: made };
    },
  },
  {
    name: "fillHole",
    description: "Turns one of a room's pillars back into a room of its own.",
    params: [
      room("The room with the pillar."),
      {
        name: "index",
        type: "number",
        description:
          "Which pillar, counting from 0 as describeRoom lists them.",
      },
    ],
    run: (map, args) => {
      const sector = findRoom(map, args.room);
      const filled = fillHole(map, sector.id, holeIndex(args, sector));
      if (!filled) throw new Error("That pillar can't be filled.");
      return { map: filled.map, result: filled.id };
    },
  },
  {
    name: "removeHole",
    description: "Removes one of a room's pillars, leaving open floor.",
    params: [
      room("The room with the pillar."),
      { name: "index", type: "number", description: "Which pillar, from 0." },
    ],
    run: (map, args) => {
      const sector = findRoom(map, args.room);
      return { map: removeHole(map, sector.id, holeIndex(args, sector)) };
    },
  },
  {
    name: "addDetailLine",
    description:
      "Draws a line inside one room, with that room on both sides, for a trigger to walk over or a texture hung in the open.",
    params: [
      {
        name: "points",
        type: "points",
        description: "The line's points in order, at least two.",
      },
    ],
    run: (map, args) => {
      const added = addDetail(map, points(args, "points"), 1);
      if (!added) throw new Error("A line needs two points inside one room.");
      return { map: added.map, result: added.id };
    },
  },
  {
    name: "removeDetailLine",
    description: "Removes a line drawn inside a room.",
    params: [room(), wall],
    run: (map, args) => ({
      map: removeDetailLine(
        map,
        findRoom(map, args.room).id,
        findWall(map, args.wall),
      ),
    }),
  },
  {
    name: "setLineAction",
    description:
      "Gives a wall an action, like a lift, a remote door, a teleporter or the level's exit. Actions that move a room need the room as their target. For a locked door, give the wall in front of a door the kind door-raise with the trigger door and a key.",
    params: [
      wall,
      {
        name: "kind",
        type: "string",
        description: "The action. listCatalog of line-actions names them.",
      },
      optional({
        name: "trigger",
        type: "string",
        description:
          "What sets it off: pressing the wall as a switch, walking over it, shooting it, or pressing a door's own face.",
        choices: lineTriggers,
      }),
      optional(
        room(
          "The room the action moves or lands in, for a trigger that listCatalog of line-actions says needs one.",
        ),
      ),
      optional({
        name: "key",
        type: "string",
        description: "A key a locked door asks for.",
        choices: keyColors,
      }),
      optional({
        name: "repeat",
        type: "boolean",
        description: "Whether it works more than once.",
      }),
    ],
    run: (map, args) => {
      const key = findWall(map, args.wall);
      const kind = choice(args, "kind", lineActionKinds);
      const line = describeLine(map, key, "");
      const fresh = newLineAction(line, kind);
      const wanted = {
        ...fresh,
        ...(args.trigger !== undefined && {
          trigger: choice(args, "trigger", lineTriggers),
        }),
        ...(args.key !== undefined && {
          key: choice(args, "key", keyColors),
        }),
        ...(args.repeat !== undefined && { repeat: Boolean(args.repeat) }),
      };
      const action = fitLineAction(wanted, line);
      if (
        args.trigger !== undefined &&
        !triggersFor(kind, line).includes(wanted.trigger)
      ) {
        throw new Error(refusedTrigger(kind, wanted.trigger, line));
      }
      const acted = updateLine(map, key, { ...soleSpecial, action });
      const { label } = lineActions[kind];
      const roomTriggers = triggersOf(kind).filter((trigger) =>
        takesRoom(kind, trigger),
      );
      if (!takesRoom(kind, action.trigger)) {
        if (args.room !== undefined) {
          throw new Error(
            roomTriggers.length > 0
              ? `${label} set off by ${action.trigger} takes no target room, since it moves the door the wall belongs to. Only ${roomTriggers.join(" or ")} takes one.`
              : `${label} takes no target room.`,
          );
        }
        return { map: acted };
      }
      if (args.room === undefined) {
        throw new Error(
          `${label} set off by ${action.trigger} needs a target room.`,
        );
      }
      return { map: setLineTarget(acted, key, findRoom(map, args.room).id) };
    },
  },
  {
    name: "clearLineAction",
    description: "Takes a wall's action or special away.",
    params: [wall],
    run: (map, args) => ({
      map: updateLine(map, findWall(map, args.wall), {
        action: undefined,
        raw: undefined,
      }),
    }),
  },
  {
    name: "setLineSpecial",
    description:
      "Gives a wall a line special by its number, for what setLineAction doesn't name, like a Boom generalized line. The map's complevel has to allow it. 0 clears it.",
    params: [
      wall,
      { name: "special", type: "number", description: "The special." },
      optional(room("The room the special acts on, found by its tag.")),
    ],
    run: (map, args) => {
      const key = findWall(map, args.wall);
      const special = number(args, "special", 0, 65535);
      const acted = updateLine(map, key, {
        ...soleSpecial,
        ...(special > 0 && { raw: { special, tag: 0 } }),
      });
      return {
        map:
          special > 0 && args.room !== undefined
            ? setLineTarget(acted, key, findRoom(map, args.room).id)
            : acted,
      };
    },
  },
  {
    name: "setLineFlags",
    description:
      "Sets a wall's flags: what it blocks, how its textures are pegged, and how the automap shows it.",
    params: [
      wall,
      ...lineFlags.map(([name, description]) =>
        optional({ name, type: "boolean", description }),
      ),
      optional(
        room(
          "The room on the line's front, where a switch or a teleporter is used from.",
        ),
      ),
    ],
    run: (map, args) => {
      const key = findWall(map, args.wall);
      const patch = Object.fromEntries(
        lineFlags.flatMap(([name]) => {
          const value = flag(args, name);
          return value === undefined ? [] : [[name, value || undefined]];
        }),
      );
      const line = map.lines?.[key];
      if (patch.scrolls && (line?.action || line?.raw)) {
        throw new Error("A wall with an action can't scroll its texture.");
      }
      if (args.room === undefined) return { map: updateLine(map, key, patch) };
      const front = findRoom(map, args.room);
      if (!wallOwners(map).get(key)?.includes(front)) {
        throw new Error(`${front.name} doesn't have the wall ${key}.`);
      }
      return { map: updateLine(map, key, { ...patch, front: front.id }) };
    },
  },
  {
    name: "setLineSide",
    description:
      "Sets a wall's texture offsets and its own upper, lower and middle textures, as seen from one room.",
    params: [
      wall,
      room("The room that side of the wall faces."),
      ...(
        [
          ["offsetX", "number", "Shifts the textures across."],
          ["offsetY", "number", "Shifts the textures down."],
          ["upper", "string", 'The upper texture, or "-" for none.'],
          ["lower", "string", 'The lower texture, or "-" for none.'],
          ["middle", "string", 'A see-through middle texture, or "-".'],
        ] as const
      ).map(([name, type, description]) =>
        optional({ name, type, description }),
      ),
    ],
    run: (map, args, context) => {
      const key = findWall(map, args.wall);
      const sector = findRoom(map, args.room);
      if (!wallOwners(map).get(key)?.includes(sector)) {
        throw new Error(`${sector.name} doesn't have the wall ${key}.`);
      }
      const offsets = (["offsetX", "offsetY"] as const).flatMap((name) =>
        args[name] === undefined
          ? []
          : [[name, number(args, name, -32767, 32767) || undefined]],
      );
      const textures = (["upper", "lower", "middle"] as const).flatMap(
        (name) => {
          if (args[name] === undefined) return [];
          return [
            [
              name,
              text(args, name).trim() === "-"
                ? undefined
                : textureName(args, name, "wall", context),
            ],
          ];
        },
      );
      return {
        map: updateLineSide(
          map,
          key,
          sector.id,
          Object.fromEntries([...offsets, ...textures]),
        ),
      };
    },
  },
  {
    name: "paintSurface",
    description:
      "Paints one surface: a room's floor or ceiling, or one part of one wall.",
    params: [
      room(),
      {
        name: "surface",
        type: "string",
        description: "Which surface of the room.",
        choices: ["floor", "ceiling", "wall"],
      },
      { name: "texture", type: "string", description: "The texture or flat." },
      optional({ ...wall, description: `${wall.description} For a wall.` }),
      optional({
        name: "part",
        type: "string",
        description: "Which part of the wall. The middle when left out.",
        choices: wallParts,
      }),
    ],
    run: (map, args, context) => {
      const sector = findRoom(map, args.room);
      const kind = choice(args, "surface", ["floor", "ceiling", "wall"]);
      const key =
        kind === "wall"
          ? `wall:${sector.id}:${findWall(map, args.wall)}:${choice(args, "part", wallParts, "middle")}`
          : `${kind}:${sector.id}`;
      const info = describeSurface(map, key);
      if (!info?.sector || !info.paints) {
        throw new Error(`${sector.name} has no such surface to paint.`);
      }
      return {
        map: paintSurface(
          map,
          key,
          textureName(
            args,
            "texture",
            kind === "wall" ? "wall" : "flat",
            context,
          ),
        ),
      };
    },
  },
  {
    name: "replaceTexture",
    description:
      "Swaps one texture for another everywhere on the map, and says how many surfaces wore it.",
    params: [
      { name: "from", type: "string", description: "The texture to find." },
      { name: "to", type: "string", description: "What takes its place." },
      {
        name: "kind",
        type: "string",
        description: "Wall textures or the flats of floors and ceilings.",
        choices: ["wall", "flat"],
      },
    ],
    run: (map, args, context) => {
      const kind = choice(args, "kind", ["wall", "flat"]);
      const swapped = replaceTexture(
        map,
        text(args, "from"),
        textureName(args, "to", kind, context),
        kind,
      );
      return { map: swapped.map, result: swapped.count };
    },
  },
  {
    name: "placeThing",
    description:
      "Puts a thing in a room, at its middle or the closest spot to it where the thing fits clear of walls and other things.",
    params: [
      {
        name: "kind",
        type: "string",
        description: "The thing. listCatalog of things names them.",
      },
      room(),
      ...thingFlags,
    ],
    run: (map, args) => {
      const sector = findRoom(map, args.room);
      const kind = thingKind(args, "kind");
      return placed(
        map,
        args,
        freeSpot(map, sector, kind, roomCenter(map, sector)),
      );
    },
  },
  {
    name: "addThing",
    description: "Puts a thing at a point, which has to be inside a room.",
    params: [
      {
        name: "kind",
        type: "string",
        description: "The thing. listCatalog of things names them.",
      },
      { name: "x", type: "number", description: "Where, across." },
      { name: "y", type: "number", description: "Where, down." },
      ...thingFlags,
    ],
    run: (map, args) => placed(map, args, pointOf(args)),
  },
  {
    name: "updateThing",
    description: "Moves a thing, turns it, or changes its kind or flags.",
    params: [
      { name: "thing", type: "string", description: "The thing's id." },
      optional({ name: "x", type: "number", description: "Where, across." }),
      optional({ name: "y", type: "number", description: "Where, down." }),
      optional({
        name: "kind",
        type: "string",
        description: "What it becomes.",
      }),
      ...thingFlags,
    ],
    run: (map, args) => {
      const thing = findThing(map, args.thing);
      const moved = {
        x: args.x === undefined ? thing.x : coordinate(args, "x"),
        y: args.y === undefined ? thing.y : coordinate(args, "y"),
      };
      const kind =
        args.kind === undefined ? thing.kind : thingKind(args, "kind");
      standsIn(map, kind, moved);
      return {
        map: updateThing(map, thing.id, { ...moved, kind, ...flagsOf(args) }),
      };
    },
  },
  {
    name: "removeThing",
    description: "Removes a thing.",
    params: [{ name: "thing", type: "string", description: "The thing's id." }],
    run: (map, args) => ({
      map: removeThing(map, findThing(map, args.thing).id),
    }),
  },
  {
    name: "addDoorSwitch",
    description:
      "Puts a switch on a room's longest free wall and wires it to a door. Answers with the switch's id and its wall.",
    params: [room("The room the switch goes in."), doorParam()],
    run: (map, args) => {
      const source = findRoom(map, args.room);
      const target = findDoor(map, args.door);
      const added = addSwitchInRoom(map, source.id, target.id);
      if (!added) throw new Error(`${source.name} has no free wall.`);
      return { map: added.map, result: placedSwitch(added.map, added.id) };
    },
  },
  {
    name: "addSwitch",
    description:
      "Puts a switch on a solid wall, wired to a door or left for a line action on its own wall. The switch splits the wall, so it answers with the switch's id and the wall it now has, which setLineAction takes.",
    params: [
      wall,
      optional(doorParam()),
      optional({
        name: "texture",
        type: "string",
        description: "The switch's texture.",
        choices: switchTextures,
      }),
    ],
    run: (map, args) => {
      const key = findWall(map, args.wall);
      const free = freeWallAt(map, key);
      if (!free) {
        throw new Error("A switch needs a solid wall with no switch on it.");
      }
      const from = map.vertices[free.from];
      const to = map.vertices[free.to];
      const door = args.door === undefined ? null : findDoor(map, args.door);
      const added = addSwitch(
        map,
        free,
        { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
        door?.id ?? null,
      );
      return {
        map:
          args.texture === undefined
            ? added.map
            : updateSwitch(added.map, added.id, {
                texture: choice(args, "texture", switchTextures),
              }),
        result: placedSwitch(added.map, added.id),
      };
    },
  },
  {
    name: "connectSwitch",
    description: "Wires a switch to a door, or to none.",
    params: [
      { name: "switch", type: "string", description: "The switch's id." },
      optional(doorParam()),
    ],
    run: (map, args) => ({
      map: updateSwitch(map, findSwitch(map, args.switch), {
        door: args.door === undefined ? null : findDoor(map, args.door).id,
      }),
    }),
  },
  {
    name: "removeSwitch",
    description: "Removes a switch.",
    params: [{ name: "switch", type: "string", description: "Its id." }],
    run: (map, args) => ({
      map: removeSwitch(map, findSwitch(map, args.switch)),
    }),
  },
  {
    name: "addNote",
    description: "Leaves a note on the map for whoever edits it next.",
    params: [
      { name: "x", type: "number", description: "Where, across." },
      { name: "y", type: "number", description: "Where, down." },
      { name: "text", type: "string", description: "What it says." },
    ],
    run: (map, args) => {
      const note = text(args, "text").trim().slice(0, maxNoteLength);
      if (!note) throw new Error("A note needs some text.");
      const added = addNote(map, pointOf(args), note);
      return { map: added, result: added.notes?.at(-1)?.id };
    },
  },
  {
    name: "removeNote",
    description: "Removes a note.",
    params: [{ name: "note", type: "string", description: "The note's id." }],
    run: (map, args) => {
      const id = text(args, "note");
      if (!map.notes?.some((note) => note.id === id)) {
        throw new Error(`No note "${id}".`);
      }
      return { map: removeNote(map, id) };
    },
  },
  {
    name: "setMapDetails",
    description: "Names the map, or sets the engine features it may use.",
    params: [
      optional({ name: "name", type: "string", description: "The name." }),
      optional({
        name: "complevel",
        type: "string",
        description:
          "Vanilla plays everywhere. Boom and the MBF levels allow more line actions.",
        choices: complevels,
      }),
    ],
    run: (map, args) => ({
      map: {
        ...map,
        ...(args.name !== undefined && {
          name: text(args, "name").trim().slice(0, maxNameLength),
        }),
        ...(args.complevel !== undefined && {
          complevel: choice(args, "complevel", complevels),
        }),
      },
    }),
  },
];

// A wall holds one special, so a new one takes the place of whatever the
// wall did before.
const soleSpecial = {
  action: undefined,
  raw: undefined,
  scrolls: undefined,
  shut: undefined,
};

const byName = new Map(agentActions.map((action) => [action.name, action]));

export const agentActionNames = agentActions.map((action) => action.name);

// Runs an action on a map. The arguments come in the action's own order, as
// an agent bridge step sends them, or by name, as an MCP tool call does. An
// edit that would break the map throws, and the map stays as it was. With
// the game's texture names in the context, a name it lacks breaks the map.
export function runAgentAction(
  map: GameMap,
  name: string,
  input: unknown[] | Args = [],
  context: CheckContext = {},
): AgentOutcome {
  const action = byName.get(name);
  if (!action) {
    throw new Error(
      `No action "${name}". Actions: ${agentActionNames.join(", ")}.`,
    );
  }
  const args = named(action, input);
  const { map: next, result } = action.run(map, args, context);
  if (!next || next === map) {
    return { map, result: result ?? null, fixed: [], todo: [] };
  }
  const settled = settle(map, next, context);
  return { ...settled, result: result ?? null };
}

const askFirstNames = new Set([
  "removeRoom",
  "joinRooms",
  "removeCorner",
  "removeDoor",
  "removeHole",
  "removeDetailLine",
  "removeThing",
  "removeSwitch",
  "removeNote",
  "replaceTexture",
  "clearLineAction",
]);

// The JSON Schema of an action's arguments, for MCP and WebMCP tools.
export function agentInputSchema(params: AgentParam[]) {
  return {
    type: "object",
    properties: Object.fromEntries(
      params.map((param) => [param.name, propertyOf(param)]),
    ),
    required: params
      .filter((param) => !param.optional)
      .map((param) => param.name),
    additionalProperties: false,
  };
}

export function getIsAgentRead(name: string) {
  return byName.get(name)?.reads === true;
}

// Removals, and a line special of 0, which clears a wall's action like
// clearLineAction does.
export function getIsAgentAskFirst(name: string, input: unknown[] | Args = []) {
  if (askFirstNames.has(name)) return true;
  if (name !== "setLineSpecial") return false;
  const action = byName.get(name);
  try {
    return action
      ? number(named(action, input), "special", 0, 65535) === 0
      : false;
  } catch {
    return false;
  }
}

export interface AgentRisk {
  title: string;
  detail: string;
  confirm: string;
}

// What an action would take away, put to the person before it runs.
export function agentRisk(
  map: GameMap,
  name: string,
  input: unknown[] | Args = [],
): AgentRisk {
  const fallback = {
    title: `Let the agent run ${humanize(name).toLowerCase()}?`,
    detail: "Undo brings back what it changes.",
    confirm: "Allow",
  };
  const action = byName.get(name);
  if (!action) return fallback;
  try {
    const args = named(action, input);
    if (name === "removeRoom") {
      const sector = findRoom(map, args.room);
      const switches = map.switches.filter(
        (item) => item.sector === sector.id,
      ).length;
      const things = map.things.filter(
        (thing) => sectorAt(map, thing)?.id === sector.id,
      ).length;
      const parts = [
        switches > 1 ? `${switches} switches` : switches === 1 ? "switch" : "",
        things > 0 ? `${count(things, "thing", "things")} inside` : "",
      ].filter(Boolean);
      return {
        title: `Remove ${sector.name}?`,
        detail:
          parts.length > 0
            ? `Its ${parts.join(" and the ")} ${switches + things > 1 ? "go" : "goes"} with it. Undo brings ${switches + things > 1 ? "them all" : "it"} back.`
            : "Undo brings it back.",
        confirm: `Remove ${sector.name}`,
      };
    }
    if (name === "removeDoor") {
      const sector = findDoor(map, args.room);
      return {
        title: `Turn ${sector.name} back into a plain room?`,
        detail: "It stops opening. Undo brings the door back.",
        confirm: "Remove door",
      };
    }
    if (name === "removeHole") {
      const sector = findRoom(map, args.room);
      return {
        title: `Remove a pillar from ${sector.name}?`,
        detail: "It leaves open floor. Undo brings it back.",
        confirm: "Remove pillar",
      };
    }
    if (name === "removeDetailLine") {
      const sector = findRoom(map, args.room);
      return {
        title: `Remove a line inside ${sector.name}?`,
        detail: "Undo brings it back.",
        confirm: "Remove line",
      };
    }
    if (name === "removeThing") {
      const thing = findThing(map, args.thing);
      const room = sectorAt(map, thing);
      return {
        title: `Remove the ${thingCatalog[thing.kind].label.toLowerCase()}?`,
        detail: `${room ? `It stands in ${room.name}. ` : ""}Undo brings it back.`,
        confirm: "Remove thing",
      };
    }
    if (name === "removeSwitch") {
      const id = findSwitch(map, args.switch);
      const room = map.sectors.find(
        (sector) =>
          sector.id === map.switches.find((item) => item.id === id)?.sector,
      );
      return {
        title: "Remove a switch?",
        detail: `${room ? `It's on a wall of ${room.name}. ` : ""}Undo brings it back.`,
        confirm: "Remove switch",
      };
    }
    if (name === "removeNote") {
      const note = map.notes?.find((item) => item.id === args.note);
      return {
        title: "Remove a note?",
        detail: note
          ? `“${note.text}” goes. Undo brings it back.`
          : fallback.detail,
        confirm: "Remove note",
      };
    }
    if (name === "replaceTexture") {
      const from = text(args, "from");
      const to = text(args, "to");
      const worn = countTexture(
        map,
        from,
        choice(args, "kind", ["wall", "flat"]),
      );
      return {
        title: `Replace ${from} with ${to}?`,
        detail: `${count(worn, "surface", "surfaces")} change. Undo puts ${from} back.`,
        confirm: "Replace",
      };
    }
    if (
      name === "clearLineAction" ||
      (name === "setLineSpecial" && number(args, "special", 0, 65535) === 0)
    ) {
      return {
        title: "Take this wall's action away?",
        detail:
          "Whatever it opened or triggered stops working. Undo brings it back.",
        confirm: "Take it away",
      };
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export interface AgentStepSummary {
  label: string;
  at: Point | null;
}

// A line for the trail of what an agent did, and where on the map it did it.
export function agentStepSummary(
  map: GameMap,
  name: string,
  input: unknown[] | Args,
  result: unknown,
): AgentStepSummary {
  const made = map.sectors.find((sector) => sector.id === result);
  const placed = map.things.find((thing) => thing.id === result);
  let room: Sector | undefined = made;
  let thing: Thing | undefined = placed;
  const action = byName.get(name);
  if (action && !room && !thing) {
    try {
      const args = named(action, input);
      if (args.room !== undefined) room = findRoom(map, args.room);
      else if (args.thing !== undefined) thing = findThing(map, args.thing);
    } catch {
      // The step named something that is gone now, so it has no place.
    }
  }
  const label = humanize(name);
  if (room) {
    return { label: `${label} · ${room.name}`, at: roomCenter(map, room) };
  }
  if (thing) {
    return {
      label: `${label} · ${thingCatalog[thing.kind].label}`,
      at: { x: thing.x, y: thing.y },
    };
  }
  return { label, at: null };
}

function refusedTrigger(
  kind: LineActionKind,
  trigger: LineTrigger,
  sides: LineSides,
) {
  const { label, triggers } = lineActions[kind];
  const allowed = triggersFor(kind, sides);
  const refusal = triggers[trigger]
    ? `${label} can't be set off by "${trigger}" on this wall: ${wallRefusal(trigger, sides)}.`
    : `${label} never takes "${trigger}".`;
  if (allowed.length > 0) return `${refusal} It takes: ${allowed.join(", ")}.`;
  const others = lineTriggers.filter(
    (each) => triggers[each] && each !== trigger,
  );
  if (others.length === 0) {
    return `${refusal} It takes nothing else, so no trigger works on this wall.`;
  }
  const lead = triggers[trigger]
    ? "Its other triggers don't fit either"
    : `It takes only ${others.join(" or ")}`;
  return `${refusal} ${lead}: ${others
    .map((each) => wallRefusal(each, sides))
    .join("; ")}.`;
}

function wallRefusal(trigger: LineTrigger, { twoSided }: LineSides) {
  if (trigger === "walk") return "nothing can walk over a solid wall";
  return twoSided
    ? "pressing the wall only works when a door room is right behind it"
    : "a press-to-open door needs a sector behind the line";
}

function humanize(name: string) {
  const words = name.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function count(value: number, one: string, many: string) {
  return `${value} ${value === 1 ? one : many}`;
}

// Positional arguments take the parameters' names in order. A lone object
// whose keys are all parameter names is taken as named already.
function named(action: AgentAction, input: unknown[] | Args): Args {
  const names = action.params.map((param) => param.name);
  let args: Args;
  if (!Array.isArray(input)) {
    args = input;
  } else if (
    input.length === 1 &&
    getIsRecord(input[0]) &&
    Object.keys(input[0]).every((key) => names.includes(key))
  ) {
    [args] = input as [Args];
  } else {
    if (input.length > names.length) {
      throw new Error(
        `${action.name} takes ${names.length === 0 ? "nothing" : names.join(", ")}.`,
      );
    }
    args = Object.fromEntries(
      input.map((value, index) => [names[index], value]),
    );
  }
  const unknown = Object.keys(args).filter((key) => !names.includes(key));
  if (unknown.length > 0) {
    throw new Error(
      `${action.name} takes no "${unknown[0]}". It takes: ${names.join(", ") || "nothing"}.`,
    );
  }
  const cleaned = Object.fromEntries(
    Object.entries(args).filter(
      ([, value]) => value !== undefined && value !== null,
    ),
  );
  const missing = action.params.find(
    (param) => !param.optional && cleaned[param.name] === undefined,
  );
  if (missing) {
    throw new Error(
      `${action.name} needs "${missing.name}": ${missing.description}`,
    );
  }
  return cleaned;
}

const fixPasses = 8;

// Fixes what the edit broke where a fix is known, and refuses it where one
// isn't. Problems the map already had stay for the agent to see in checkMap.
function settle(before: GameMap, after: GameMap, context: CheckContext) {
  let map = after;
  const fixed: string[] = [];
  for (let pass = 0; pass < fixPasses; pass += 1) {
    const fresh = freshErrors(before, map, context);
    if (fresh.length === 0) break;
    const repaired = fresh.reduce<{ map: GameMap; issue: MapIssue } | null>(
      (found, issue) => {
        if (found) return found;
        const next = fixIssue(map, issue);
        return next && next !== map ? { map: next, issue } : null;
      },
      null,
    );
    if (!repaired) break;
    fixed.push(repaired.issue.message);
    map = repaired.map;
  }
  const left = freshErrors(before, map, context);
  if (left.length > 0) {
    throw new Error(
      `That would break the map, so nothing changed. ${problems(left).join(" ")}`,
    );
  }
  return {
    map,
    fixed,
    todo: problems(
      inspectMap(map, context).errors.filter((issue) =>
        unfinished.test(issue.id),
      ),
    ),
  };
}

// The errors a map has that the one before it didn't. Checks the earlier map
// was too broken to run say nothing about this edit, so they don't count.
function freshErrors(before: GameMap, after: GameMap, context: CheckContext) {
  const was = inspectMap(before, context);
  const now = inspectMap(after, context);
  const old = new Set(was.errors.map((issue) => issue.id));
  const unknown = new Set([
    ...(was.layers.rooms ? [] : (now.layers.rooms ?? [])),
    ...(was.layers.things ? [] : (now.layers.things ?? [])),
  ]);
  const fresh = now.errors.filter(
    (issue) =>
      !old.has(issue.id) &&
      !unknown.has(issue.id) &&
      !unfinished.test(issue.id),
  );
  // The map check leaves where things stand until nothing else is wrong,
  // which an unfinished map never is, so the gate looks for itself.
  const placed = new Set(misplaced(before).map((issue) => issue.id));
  const seen = new Set(fresh.map((issue) => issue.id));
  return [
    ...fresh,
    ...misplaced(after).filter(
      (issue) => !placed.has(issue.id) && !seen.has(issue.id),
    ),
  ];
}

// Things outside every room, which never spawn, and player starts inside a
// shut door, which can't move.
function misplaced(map: GameMap): MapIssue[] {
  return map.things.flatMap((thing) => {
    const room = sectorAt(map, thing);
    if (!room) {
      return [
        {
          id: `outside:${thing.id}`,
          message: `${thing.id} is outside every room.`,
          target: thing.id,
        },
      ];
    }
    return room.door && getIsPlayerStart(thing.kind)
      ? [
          {
            id: `in-door:${thing.id}`,
            message: `${thing.id} is inside a closed door.`,
            target: thing.id,
          },
        ]
      : [];
  });
}

// Each problem once, as several walls can raise the same one.
function problems(issues: MapIssue[]) {
  return [
    ...new Set(
      issues.map(({ message, detail }) =>
        detail ? `${message} ${detail}` : message,
      ),
    ),
  ];
}

function roomSummary(map: GameMap, sector: Sector) {
  const box = boxOf(sectorPolygon(map, sector));
  return {
    id: sector.id,
    name: sector.name,
    floor: sector.floor,
    ceiling: sector.ceiling,
    light: sector.light,
    ...(sector.door && { door: doorKey(sector) ?? sector.door.opensBy }),
    ...(sector.tag && { tag: sector.tag }),
    ...(sector.effect && { effect: sector.effect }),
    box,
    center: roomCenter(map, sector),
  };
}

function roomDetail(map: GameMap, sector: Sector) {
  const owners = wallOwners(map);
  const [outline, ...holes] = sectorLoops(sector);
  const corner = (id: string) => ({ id, ...map.vertices[id] });
  const walls = sectorLoops(sector).flatMap((loop) =>
    loop.map((from, index) => {
      const key = wallKey(from, loop[(index + 1) % loop.length]);
      const beyond = (owners.get(key) ?? []).find((owner) => owner !== sector);
      const settings = map.lines?.[key];
      return {
        wall: key,
        // The room past the wall, or null for a solid wall.
        opensOnto: beyond?.id ?? null,
        ...(sector.wallOverrides?.[key] && {
          texture: sector.wallOverrides[key],
        }),
        ...(settings?.action && { action: settings.action }),
        ...(settings?.sides?.[sector.id] && {
          side: settings.sides[sector.id],
        }),
      };
    }),
  );
  return {
    ...roomSummary(map, sector),
    floorTexture: sector.floorTexture,
    ceilingTexture: sector.ceilingTexture,
    wallTexture: sector.wallTexture,
    ...(sector.door && { door: sector.door }),
    corners: outline.map(corner),
    pillars: holes.map((loop) => loop.map(corner)),
    walls,
    lines: sectorDetails(sector).map(({ from, to }) => wallKey(from, to)),
    things: map.things
      .filter((thing) => sectorAt(map, thing) === sector)
      .map((thing) => thing.id),
  };
}

const namePageSize = 200;

function catalog(of: string, args: Args, context: CheckContext) {
  if (of === "things") {
    return thingKinds.map((kind) => ({
      kind,
      label: thingCatalog[kind].label,
      category: thingCatalog[kind].category,
    }));
  }
  const names = context.names ?? freedoomNames;
  const search =
    args.search === undefined ? "" : text(args, "search").trim().toUpperCase();
  const matching = (list: readonly string[]) =>
    list.filter((name) => name.toUpperCase().includes(search));
  const found = (list: readonly string[]) =>
    page(matching(list), args, namePageSize, namePageLimit);
  if (of === "walls") {
    const solid = new Set(names.walls);
    return {
      ...found(names.walls),
      seeThrough: matching(names.middles.filter((name) => !solid.has(name))),
      doors: doorTextures,
      switches: switchTextures,
    };
  }
  if (of === "flats") return { ...found(names.flats), sky: "F_SKY1" };
  if (of === "sector-effects") {
    return Object.entries(sectorEffects).map(([effect, { label }]) => ({
      effect,
      label,
    }));
  }
  return lineActionKinds.map((kind) => ({
    kind,
    label: lineActions[kind].label,
    group: lineActions[kind].group,
    triggers: triggersOf(kind).map((trigger) => {
      const keys = keysFor(kind, trigger);
      return {
        trigger,
        needsRoom: takesRoom(kind, trigger),
        ...(keys.length > 0 && { keys }),
      };
    }),
  }));
}

const triggersOf = (kind: LineActionKind) =>
  Object.keys(lineActions[kind].triggers) as LineTrigger[];

// Pressing a door's own face moves the door behind it. Any other trigger
// finds the room to move by its tag.
const takesRoom = (kind: LineActionKind, trigger: LineTrigger) =>
  lineUsesTag({ kind, trigger, repeat: true, tag: 0 });

function countBy(values: string[]) {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function doorParam(): AgentParam {
  return {
    name: "door",
    type: "string",
    description: "The door's id or name.",
  };
}

const namedRooms = 20;

// A room by its id, or by its name where only one room has it.
function findRoom(map: GameMap, value: unknown) {
  const name = label(value).trim();
  const known = map.sectors.find((sector) => sector.id === name);
  if (known) return known;
  const named = map.sectors.filter(
    (sector) => sector.name.toLowerCase() === name.toLowerCase(),
  );
  if (named.length === 1) return named[0];
  const shown = map.sectors
    .slice(0, namedRooms)
    .map((sector) => `${sector.id} (${sector.name})`)
    .join(", ");
  const more =
    map.sectors.length > namedRooms
      ? `, and ${map.sectors.length - namedRooms} more that listRooms finds`
      : "";
  throw new Error(
    named.length > 1
      ? `${named.length} rooms are named "${name}". Use an id: ${named.map((sector) => sector.id).join(", ")}.`
      : `No room "${name}". Rooms: ${shown || "none yet"}${more}.`,
  );
}

function findDoor(map: GameMap, value: unknown) {
  const sector = findRoom(map, value);
  if (!sector.door) throw new Error(`${sector.name} is not a door.`);
  return sector;
}

function findThing(map: GameMap, value: unknown) {
  const thing = map.things.find((item) => item.id === value);
  if (!thing) throw new Error(`No thing "${label(value)}".`);
  return thing;
}

function findSwitch(map: GameMap, value: unknown) {
  const found = map.switches.find((item) => item.id === value);
  if (!found) throw new Error(`No switch "${label(value)}".`);
  return found.id;
}

function placedSwitch(map: GameMap, id: string) {
  const placed = defined(map.switches.find((item) => item.id === id));
  return { switch: id, wall: wallKey(placed.from, placed.to) };
}

// A wall named by its corners in either order.
function findWall(map: GameMap, value: unknown) {
  const [from, to, ...rest] = label(value).split("|");
  const key = from && to && rest.length === 0 ? wallKey(from, to) : "";
  if (!wallOwners(map).has(key)) {
    throw new Error(
      `No wall "${label(value)}". A wall is two corner ids joined by "|", as describeRoom shows them.`,
    );
  }
  return key;
}

function holeIndex(args: Args, sector: Sector) {
  const count = sector.holes?.length ?? 0;
  if (count === 0) throw new Error(`${sector.name} has no pillars.`);
  return number(args, "index", 0, count - 1);
}

function thingKind(args: Args, name: string) {
  const kind = text(args, name) as ThingKind;
  if (!thingKinds.includes(kind)) {
    throw new Error(
      `No thing "${kind}". listCatalog of things names them, like: ${thingKinds.slice(0, 8).join(", ")}.`,
    );
  }
  return kind;
}

// Doom's thing radii, for the kinds bigger or smaller than an imp's 20.
const thingRadii: Partial<Record<ThingKind, number>> = {
  player: 16,
  "player-2": 16,
  "player-3": 16,
  "player-4": 16,
  "deathmatch-start": 16,
  "lost-soul": 16,
  barrel: 10,
  "burning-barrel": 16,
  demon: 30,
  spectre: 30,
  cacodemon: 31,
  "pain-elemental": 31,
  "hell-knight": 24,
  "baron-of-hell": 24,
  cyberdemon: 40,
  mancubus: 48,
  arachnotron: 64,
  "spider-mastermind": 128,
};
const thingRadius = (kind: ThingKind) => thingRadii[kind] ?? 20;
const spotStep = 16;
const spotRings = 40;

// The closest point to `start` where a thing of `kind` fits inside the room
// and clear of the things there. Doom collides things as squares, and a
// monster that starts overlapping a wall or another thing can't move.
function freeSpot(
  map: GameMap,
  sector: Sector,
  kind: ThingKind,
  start: Point,
): Point {
  const radius = thingRadius(kind);
  const fits = (point: Point) =>
    [-1, 0, 1]
      .flatMap((sx) => [-1, 0, 1].map((sy) => ({ sx, sy })))
      .every(
        ({ sx, sy }) =>
          sectorAt(map, { x: point.x + sx * radius, y: point.y + sy * radius })
            ?.id === sector.id,
      ) &&
    map.things.every((thing) => {
      const reach = radius + thingRadius(thing.kind);
      return (
        Math.abs(thing.x - point.x) >= reach ||
        Math.abs(thing.y - point.y) >= reach
      );
    });
  const spots: Point[] = [];
  for (let dx = -spotRings; dx <= spotRings; dx += 1) {
    for (let dy = -spotRings; dy <= spotRings; dy += 1) {
      spots.push({ x: start.x + dx * spotStep, y: start.y + dy * spotStep });
    }
  }
  const distance = (point: Point) =>
    Math.hypot(point.x - start.x, point.y - start.y);
  spots.sort((a, b) => distance(a) - distance(b));
  const spot = spots.find(fits);
  if (!spot) {
    throw new Error(
      `No room left in ${sector.name} for a ${thingCatalog[kind].label.toLowerCase()}. Pick a bigger room, or use addThing with a point.`,
    );
  }
  return spot;
}

// A thing outside every room never spawns, and a player can't start inside a
// shut door.
function standsIn(map: GameMap, kind: ThingKind, point: Point) {
  const sector = sectorAt(map, point);
  if (!sector) {
    throw new Error(`${point.x}, ${point.y} is outside every room.`);
  }
  if (sector.door && getIsPlayerStart(kind)) {
    throw new Error(`A player can't start inside ${sector.name}, a door.`);
  }
}

function flagsOf(args: Args): Partial<Thing> {
  const picked =
    args.skills === undefined
      ? undefined
      : strings(args, "skills").map((skill) => {
          if (!skills.includes(skill as ThingSkill)) {
            throw new Error(
              `No difficulty "${skill}". Use: ${skills.join(", ")}.`,
            );
          }
          return skill as ThingSkill;
        });
  return {
    ...(args.angle !== undefined && {
      angle: ((number(args, "angle", -3600, 3600) % 360) + 360) % 360,
    }),
    ...(picked && {
      skills:
        picked.length === 0 || picked.length === skills.length
          ? undefined
          : skills.filter((skill) => picked.includes(skill)),
    }),
    ...Object.fromEntries(
      thingToggles.flatMap(([name]) => {
        const value = flag(args, name);
        return value === undefined ? [] : [[name, value || undefined]];
      }),
    ),
  };
}

function placed(map: GameMap, args: Args, point: Point) {
  const kind = thingKind(args, "kind");
  standsIn(map, kind, point);
  const added = addThing(map, kind, point, 0, 1);
  return {
    map: updateThing(added.map, added.id, flagsOf(args)),
    result: added.id,
  };
}

const closestShown = 5;

// A texture or flat the game has, matched whatever its case.
function textureName(
  args: Args,
  name: string,
  kind: "wall" | "flat",
  context: CheckContext,
) {
  const value = text(args, name).trim();
  const names = context.names ?? freedoomNames;
  const known = kind === "flat" ? names.flats : names.textures;
  const wanted = value.toUpperCase();
  const match = known.find((item) => item.toUpperCase() === wanted);
  if (match) return match;
  const closest = known
    .map((item) => ({ item, distance: editDistance(wanted, item) }))
    .toSorted((a, b) => a.distance - b.distance)
    .slice(0, closestShown)
    .map(({ item }) => item);
  throw new Error(
    `No ${kind === "flat" ? "flat" : "wall texture"} "${value}" for ${name}. The closest are ${closest.join(", ")}. listCatalog of ${kind}s names them all.`,
  );
}

function editDistance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(
        row[j] + 1,
        next[j - 1] + 1,
        row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length];
}

const lightLimit = 255;

type RoomHeights = Pick<Sector, "floor" | "ceiling" | "door">;

function looks(args: Args, context: CheckContext, sector?: RoomHeights) {
  const texture = (name: string) =>
    args[name] === undefined
      ? {}
      : {
          [name]: textureName(
            args,
            name,
            name === "wallTexture" ? "wall" : "flat",
            context,
          ),
        };
  return {
    ...(args.name !== undefined && {
      name: text(args, "name").trim().slice(0, maxNameLength) || "Room",
    }),
    ...(args.floor !== undefined || args.ceiling !== undefined
      ? heightsOf(args, sector)
      : {}),
    ...(args.light !== undefined && {
      light: number(args, "light", 0, lightLimit),
    }),
    ...texture("floorTexture"),
    ...texture("ceilingTexture"),
    ...texture("wallTexture"),
  } as Partial<Omit<Sector, "id" | "vertices">>;
}

const heightLimit = 2048;

// A room's heights, with what isn't given taken from the room as it is.
function heightsOf(args: Args, sector?: RoomHeights) {
  const floor =
    args.floor === undefined
      ? (sector?.floor ?? 0)
      : number(args, "floor", -heightLimit, heightLimit);
  const ceiling =
    args.ceiling === undefined
      ? (sector?.ceiling ?? floor + 128)
      : number(args, "ceiling", -heightLimit, heightLimit);
  if (ceiling <= floor && !sector?.door) {
    throw new Error("The ceiling must be above the floor.");
  }
  return { floor, ceiling };
}

function pointOf(args: Args): Point {
  return { x: coordinate(args, "x"), y: coordinate(args, "y") };
}

const coordinateLimit = 32000;

function coordinate(args: Args, name: string) {
  return number(args, name, -coordinateLimit, coordinateLimit);
}

function points(args: Args, name: string): Point[] {
  const list = args[name];
  if (!Array.isArray(list)) {
    throw new Error(`"${name}" must be a list of points like {x, y}.`);
  }
  return list.map((item, index) => {
    const pair = Array.isArray(item) ? { x: item[0], y: item[1] } : item;
    if (!getIsRecord(pair)) {
      throw new Error(`Point ${index + 1} of "${name}" must be {x, y}.`);
    }
    return pointOf(pair);
  });
}

function strings(args: Args, name: string) {
  const list = args[name];
  if (!Array.isArray(list) || !list.every((item) => typeof item === "string")) {
    throw new Error(`"${name}" must be a list of words.`);
  }
  return list;
}

function text(args: Args, name: string) {
  const value = args[name];
  if (typeof value !== "string") throw new Error(`"${name}" must be text.`);
  return value;
}

function flag(args: Args, name: string) {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`"${name}" must be true or false.`);
  }
  return value;
}

// A whole number, kept within its limits. Text that is a number counts, as
// agents often send one.
function number(
  args: Args,
  name: string,
  min: number,
  max: number,
  fallback?: number,
) {
  const given = args[name] ?? fallback;
  const value =
    typeof given === "string" && given.trim() ? Number(given) : given;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`"${name}" must be a number.`);
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function choice<T extends string>(
  args: Args,
  name: string,
  choices: readonly T[],
  fallback?: T,
) {
  const value = args[name] ?? fallback;
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new Error(`"${name}" must be one of: ${choices.join(", ")}.`);
  }
  return value as T;
}

// What an agent sent, as text to look a name up by or to quote back.
function label(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value ?? "");
}

function getIsRecord(value: unknown): value is Args {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// One page of a long list, so a big map's answers stay small.
function page<T>(items: T[], args: Args, fallback: number, most = pageLimit) {
  const offset = number(args, "offset", 0, Math.max(0, items.length), 0);
  const limit = number(args, "limit", 1, most, fallback);
  const shown = items.slice(offset, offset + limit);
  return {
    total: items.length,
    offset,
    items: shown,
    ...(offset + shown.length < items.length && {
      next: offset + shown.length,
    }),
  };
}

function propertyOf({ type, description, choices }: AgentParam) {
  const picked = choices ? { enum: [...choices] } : {};
  if (type === "points") {
    return {
      type: "array",
      description,
      items: {
        type: "object",
        properties: { x: { type: "number" }, y: { type: "number" } },
        required: ["x", "y"],
      },
    };
  }
  if (type === "strings") {
    return {
      type: "array",
      description,
      items: { type: "string", ...picked },
    };
  }
  return { type, description, ...picked };
}

// A map that won't build has its own error, so it adds no warnings here.
function builtWarnings(map: GameMap) {
  try {
    return vanillaWarnings(map, compileLumps(map));
  } catch {
    return [];
  }
}
