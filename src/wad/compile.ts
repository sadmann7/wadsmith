import { sectorSpecialOf } from "@/map/boom";
import { doorTrackTexture, thingCatalog } from "@/map/catalog";
import {
  engineOrder,
  loopEdges,
  sectorContainers,
  sectorDetails,
  sectorLoops,
  sectorVertices,
  wallKey,
  wallPartTexture,
  wallTextureOf,
} from "@/map/geometry";
import { doorSpecial, lineSpecial, switchDoorSpecial } from "@/map/lines";
import { higherLevel } from "@/map/complevel";
import type {
  Complevel,
  GameMap,
  LineSettings,
  LineSide,
  Point,
  Sector,
  Thing,
  ThingSkill,
} from "@/map/types";
import { buildBlockmap } from "./blockmap";
import { buildNodes, type Box, type NodeLine } from "./nodes";

const mapLumpName = "MAP01";
const lineBlocksPlayer = 0x0001;
const lineBlocksEnemies = 0x0002;
const lineTwoSided = 0x0004;
const lineUpperUnpegged = 0x0008;
const lineLowerUnpegged = 0x0010;
const lineSecret = 0x0020;
const lineSoundBlock = 0x0040;
const lineHidden = 0x0080;
const lineMapped = 0x0100;
const linePassUse = 0x0200;
const specialScrollLeft = 48;
const thingSkillFlags: Record<ThingSkill, number> = {
  easy: 0x0001,
  medium: 0x0002,
  hard: 0x0004,
};
const thingOnAllSkills = 0x0007;
const thingAmbush = 0x0008;
const thingMultiplayer = 0x0010;
const thingNotDeathmatch = 0x0020;
const thingNotCoop = 0x0040;
const thingFriendly = 0x0080;
const noSidedef = 0xffff;

interface Lump {
  name: string;
  data: Uint8Array;
}

class LumpWriter {
  private bytes: number[] = [];

  int16(value: number) {
    const word = Math.round(value) & 0xffff;
    this.bytes.push(word & 0xff, word >> 8);
    return this;
  }

  name(value: string) {
    for (let index = 0; index < 8; index += 1) {
      this.bytes.push(value.charCodeAt(index) || 0);
    }
    return this;
  }

  finish() {
    return Uint8Array.from(this.bytes);
  }
}

function toDoom(point: Point): Point {
  return { x: Math.round(point.x), y: -Math.round(point.y) };
}

function writeBox(writer: LumpWriter, box: Box) {
  writer.int16(box.top).int16(box.bottom).int16(box.left).int16(box.right);
}

type LevelLine = NodeLine & { wall: string };

interface WallSide {
  sector: number;
  from: string;
  to: string;
  pillar: boolean;
  detail: boolean;
}

function buildLevel(map: GameMap) {
  const used = new Set(map.sectors.flatMap(sectorVertices));
  const vertexIds = Object.keys(map.vertices).filter((id) => used.has(id));
  const vertexIndex = new Map(vertexIds.map((id, index) => [id, index]));
  const vertices = vertexIds.map((id) => toDoom(map.vertices[id]));
  const { sectors } = map;
  const indexOf = new Map(sectors.map((sector, index) => [sector.id, index]));
  const containers = sectorContainers(map);

  const sides = new Map<string, WallSide[]>();
  sectors.forEach((sector, index) => {
    sectorLoops(sector).forEach((loop, at) => {
      for (const { from, to } of loopEdges(engineOrder(map, loop, at > 0))) {
        const key = wallKey(from, to);
        sides.set(key, [
          ...(sides.get(key) ?? []),
          { sector: index, from, to, pillar: at > 0, detail: false },
        ]);
      }
    });
    for (const { from, to } of sectorDetails(sector)) {
      const key = wallKey(from, to);
      sides.set(key, [
        ...(sides.get(key) ?? []),
        { sector: index, from, to, pillar: false, detail: true },
      ]);
    }
  });

  // A room drawn against a pillar covers that side of it, so the wall there
  // is the room's alone.
  const covers = (room: WallSide, pillar: WallSide) =>
    pillar.pillar &&
    containers.get(sectors[room.sector].id) === sectors[pillar.sector];

  const lines: LevelLine[] = [];
  for (const [wall, listed] of sides) {
    if (listed.some((item) => item.detail)) {
      const [side] = listed;
      if (listed.length > 1) {
        throw new Error(
          `${sectors[side.sector].name} has a line on one of its walls.`,
        );
      }
      lines.push({
        start: vertexIndex.get(side.from)!,
        end: vertexIndex.get(side.to)!,
        frontSector: side.sector,
        backSector: side.sector,
        wall,
      });
      continue;
    }
    let list = listed;
    let covered = false;
    if (listed.length === 2) {
      const [a, b] = listed;
      if (covers(a, b)) {
        list = [a];
        covered = true;
      } else if (covers(b, a)) {
        list = [b];
        covered = true;
      }
    }
    const [side, other] = list;
    if (list.length > 2) {
      throw new Error(
        `${sectors[side.sector].name} shares a wall with two rooms.`,
      );
    }
    if (other && other.from === side.from) {
      throw new Error(
        `${sectors[side.sector].name} overlaps another room's wall.`,
      );
    }
    const start = vertexIndex.get(side.from)!;
    const end = vertexIndex.get(side.to)!;
    // A room drawn inside another opens onto it wherever no other room
    // shares the wall.
    const container =
      side.pillar || covered || map.lines?.[wall]?.solid
        ? null
        : containers.get(sectors[side.sector].id);
    const behind =
      other?.sector ?? (container ? indexOf.get(container.id)! : null);
    if (behind === null) {
      lines.push({
        start,
        end,
        frontSector: side.sector,
        backSector: null,
        wall,
      });
      continue;
    }
    const front = sectors[side.sector];
    const back = sectors[behind];
    if (front.door && back.door) {
      throw new Error(`${front.name} touches another door.`);
    }
    // The engine opens the sector behind a used line, so doors stay on the
    // back, and a line's chosen front room ends up in front.
    const flipped =
      front.door || (!back.door && map.lines?.[wall]?.front === back.id);
    lines.push(
      flipped
        ? {
            start: end,
            end: start,
            frontSector: behind,
            backSector: side.sector,
            wall,
          }
        : { start, end, frontSector: side.sector, backSector: behind, wall },
    );
  }

  return { vertices, sectors, lines };
}

function thingFlags(thing: Thing) {
  const skills = thing.skills
    ? thing.skills.reduce((flags, skill) => flags | thingSkillFlags[skill], 0)
    : thingOnAllSkills;
  const enemy = thingCatalog[thing.kind].category === "enemy";
  return (
    skills |
    (enemy && thing.ambush ? thingAmbush : 0) |
    (thing.multiplayer ? thingMultiplayer : 0) |
    (thing.notDeathmatch ? thingNotDeathmatch : 0) |
    (thing.notCoop ? thingNotCoop : 0) |
    (enemy && thing.friendly ? thingFriendly : 0)
  );
}

function lineFlags(line: LineSettings | undefined) {
  return (
    (line?.blocksEnemies ? lineBlocksEnemies : 0) |
    (line?.upperFixed ? lineUpperUnpegged : 0) |
    (line?.lowerFixed ? lineLowerUnpegged : 0) |
    (line?.hidden ? lineHidden : 0) |
    (line?.secret ? lineSecret : 0) |
    (line?.soundBlock ? lineSoundBlock : 0) |
    (line?.mapped ? lineMapped : 0) |
    (line?.passUse ? linePassUse : 0)
  );
}

// Woof reads the compatibility level from this lump when no flag names one.
function complevelLump(maps: GameMap[]): Lump {
  const level = maps.reduce<Complevel>(
    (highest, map) => higherLevel(highest, map.complevel ?? "vanilla"),
    "vanilla",
  );
  return {
    name: "COMPLVL",
    data: Uint8Array.from(level, (c) => c.charCodeAt(0)),
  };
}

// A Doom 1 game ends an episode after its eighth map and sends the ninth
// back into it, so every slot from the first map to the last names the slot
// after it, gaps included: a gap plays the game's own level there, as on
// Doom II, and the engine finds the entry by episode and map.
const episodeSlot = /^E(\d)M(\d)$/;
const mostEpisodeSlots = 36;

function slotAfter(slot: string) {
  const [, episode, map] = episodeSlot.exec(slot)!.map(Number);
  return map < 9 ? `E${episode}M${map + 1}` : `E${episode + 1}M1`;
}

function umapinfoLump(slots: string[]): Lump[] {
  const chained = slots.filter((slot) => episodeSlot.test(slot));
  if (chained.length < 2) return [];
  const last = chained.at(-1)!;
  const entries: string[] = [];
  for (
    let slot = chained[0];
    slot !== last && entries.length < mostEpisodeSlots;
    slot = slotAfter(slot)
  ) {
    entries.push(`MAP ${slot}\n{\n  next = "${slotAfter(slot)}"\n}\n`);
  }
  const text = entries.join("\n");
  return [
    { name: "UMAPINFO", data: Uint8Array.from(text, (c) => c.charCodeAt(0)) },
  ];
}

// A switch's door gets a tag no line or sector in the map has chosen.
function sectorTags(map: GameMap, sectors: Sector[]) {
  const used = new Set([
    ...sectors.map((sector) => sector.tag ?? 0),
    ...Object.values(map.lines ?? {}).map(
      (line) => line.action?.tag ?? line.raw?.tag ?? 0,
    ),
  ]);
  return sectors.map((sector, index) => {
    if (sector.tag) return sector.tag;
    if (!map.switches.some((item) => item.door === sector.id)) return 0;
    let tag = index + 1;
    while (used.has(tag)) tag += 1;
    used.add(tag);
    return tag;
  });
}

function compileLumps(map: GameMap, slot = mapLumpName): Lump[] {
  const { vertices, sectors, lines } = buildLevel(map);
  const bsp = buildNodes(vertices, lines);

  const things = new LumpWriter();
  for (const thing of map.things) {
    const at = toDoom(thing);
    things
      .int16(at.x)
      .int16(at.y)
      .int16(thing.angle)
      .int16(thingCatalog[thing.kind].doomType)
      .int16(thingFlags(thing));
  }

  const linedefs = new LumpWriter();
  const sidedefs = new LumpWriter();
  let sideCount = 0;
  const writeSide = (
    sector: number,
    textures: { upper?: string; lower?: string; middle?: string },
    side: LineSide | undefined,
  ) => {
    sidedefs
      .int16(side?.offsetX ?? 0)
      .int16(side?.offsetY ?? 0)
      .name(textures.upper ?? "-")
      .name(textures.lower ?? "-")
      .name(textures.middle ?? "-")
      .int16(sector);
    sideCount += 1;
    return sideCount - 1;
  };
  const tags = sectorTags(map, sectors);
  const doorTag = (id: string) =>
    tags[sectors.findIndex((sector) => sector.id === id)];
  const switches = new Map(
    map.switches.map((item) => [wallKey(item.from, item.to), item]),
  );
  for (const line of lines) {
    const frontSector = sectors[line.frontSector];
    const settings = map.lines?.[line.wall];
    const sideOf = (sector: Sector) => settings?.sides?.[sector.id];
    let wired = false;
    let flags = lineBlocksPlayer;
    let special = 0;
    let tag = 0;
    let front: number;
    let back = noSidedef;

    if (line.backSector !== null) {
      const backSector = sectors[line.backSector];
      // A line inside a room shows only its middle texture, on both sides.
      const detail = line.backSector === line.frontSector;
      const door = detail ? undefined : backSector.door;
      const doorway = detail ? undefined : (door ?? frontSector.door);
      flags = lineTwoSided | (settings?.blocksAll ? lineBlocksPlayer : 0);
      if (door?.opensBy === "use" && !settings?.shut) {
        special = doorSpecial(door);
      }
      // A door's face is the door's texture unless the side chose its own.
      const textures = (sector: Sector) =>
        detail
          ? { middle: sideOf(sector)?.middle }
          : {
              upper: door
                ? (sideOf(sector)?.upper ?? door.texture)
                : wallPartTexture(map, sector, line.wall, "upper"),
              lower: wallPartTexture(map, sector, line.wall, "lower"),
              middle: doorway ? undefined : sideOf(sector)?.middle,
            };
      front = writeSide(
        line.frontSector,
        textures(frontSector),
        sideOf(frontSector),
      );
      back = writeSide(
        line.backSector,
        textures(backSector),
        sideOf(backSector),
      );
    } else if (frontSector.door) {
      // Door tracks and switch art stay put as the door moves unless the line
      // says otherwise.
      if (settings?.lowerFixed !== false) flags |= lineLowerUnpegged;
      front = writeSide(
        line.frontSector,
        { middle: doorTrackTexture },
        sideOf(frontSector),
      );
    } else {
      const item = switches.get(line.wall);
      const target = sectors.find((sector) => sector.id === item?.door);
      if (item && settings?.lowerFixed !== false) flags |= lineLowerUnpegged;
      if (item && target?.door) {
        wired = true;
        special = switchDoorSpecial(target.door);
        tag = doorTag(target.id);
      }
      front = writeSide(
        line.frontSector,
        { middle: item?.texture ?? wallTextureOf(frontSector, line.wall) },
        sideOf(frontSector),
      );
    }

    if (settings?.action && !wired) {
      special = lineSpecial(settings.action) ?? 0;
      tag = settings.action.tag;
    } else if (settings?.raw && !wired) {
      special = settings.raw.special;
      tag = settings.raw.tag;
    }
    if (settings?.scrolls && special === 0) special = specialScrollLeft;

    linedefs
      .int16(line.start)
      .int16(line.end)
      .int16(flags | lineFlags(settings))
      .int16(special)
      .int16(tag)
      .int16(front)
      .int16(back);
  }

  const vertexes = new LumpWriter();
  for (const vertex of bsp.vertices) {
    vertexes.int16(vertex.x).int16(vertex.y);
  }

  const segs = new LumpWriter();
  for (const seg of bsp.segs) {
    const line = lines[seg.line];
    const from = vertices[seg.side === 0 ? line.start : line.end];
    const to = vertices[seg.side === 0 ? line.end : line.start];
    const radians = Math.atan2(to.y - from.y, to.x - from.x);
    const turn =
      (radians < 0 ? radians + Math.PI * 2 : radians) / (Math.PI * 2);
    segs
      .int16(seg.start)
      .int16(seg.end)
      .int16(turn * 65536)
      .int16(seg.line)
      .int16(seg.side)
      .int16(seg.offset);
  }

  const ssectors = new LumpWriter();
  for (const subsector of bsp.subsectors) {
    ssectors.int16(subsector.count).int16(subsector.first);
  }

  const nodes = new LumpWriter();
  for (const node of bsp.nodes) {
    nodes.int16(node.x).int16(node.y).int16(node.dx).int16(node.dy);
    writeBox(nodes, node.rightBox);
    writeBox(nodes, node.leftBox);
    nodes.int16(node.rightChild).int16(node.leftChild);
  }

  const sectorLump = new LumpWriter();
  sectors.forEach((sector, index) => {
    sectorLump
      .int16(sector.floor)
      .int16(sector.door ? sector.floor : sector.ceiling)
      .name(sector.floorTexture)
      .name(sector.ceilingTexture)
      .int16(sector.light)
      .int16(sectorSpecialOf(sector))
      .int16(tags[index]);
  });

  const blockmapWords = buildBlockmap(
    lines.map((line) => ({
      start: vertices[line.start],
      end: vertices[line.end],
    })),
  );
  const blockmap = new LumpWriter();
  for (const word of blockmapWords) blockmap.int16(word);

  return [
    { name: slot, data: new Uint8Array() },
    { name: "THINGS", data: things.finish() },
    { name: "LINEDEFS", data: linedefs.finish() },
    { name: "SIDEDEFS", data: sidedefs.finish() },
    { name: "VERTEXES", data: vertexes.finish() },
    { name: "SEGS", data: segs.finish() },
    { name: "SSECTORS", data: ssectors.finish() },
    { name: "NODES", data: nodes.finish() },
    { name: "SECTORS", data: sectorLump.finish() },
    {
      name: "REJECT",
      data: new Uint8Array(Math.ceil((sectors.length * sectors.length) / 8)),
    },
    { name: "BLOCKMAP", data: blockmap.finish() },
  ];
}

function packWad(lumps: Lump[]) {
  const headerSize = 12;
  const dataSize = lumps.reduce((total, lump) => total + lump.data.length, 0);
  const output = new Uint8Array(headerSize + dataSize + lumps.length * 16);
  const view = new DataView(output.buffer);
  output.set([0x50, 0x57, 0x41, 0x44]);
  view.setInt32(4, lumps.length, true);
  view.setInt32(8, headerSize + dataSize, true);

  let offset = headerSize;
  let entry = headerSize + dataSize;
  for (const lump of lumps) {
    output.set(lump.data, offset);
    view.setInt32(entry, offset, true);
    view.setInt32(entry + 4, lump.data.length, true);
    for (let index = 0; index < 8; index += 1) {
      output[entry + 8 + index] = lump.name.charCodeAt(index) || 0;
    }
    offset += lump.data.length;
    entry += 16;
  }
  return output;
}

function compileMap(map: GameMap, slot = mapLumpName) {
  return packWad([...compileLumps(map, slot), complevelLump([map])]);
}

// Lumps built ahead of time keep their data and take the slot they're packed
// under.
function compileEpisode(
  maps: { slot: string; map: GameMap; lumps?: Lump[] | null }[],
) {
  return packWad([
    ...maps.flatMap(({ slot, map, lumps }) =>
      lumps
        ? [{ name: slot, data: new Uint8Array() }, ...lumps.slice(1)]
        : compileLumps(map, slot),
    ),
    ...umapinfoLump(maps.map(({ slot }) => slot)),
    complevelLump(maps.map(({ map }) => map)),
  ]);
}

export {
  buildLevel,
  compileEpisode,
  compileLumps,
  compileMap,
  mapLumpName,
  toDoom,
  type Lump,
};
