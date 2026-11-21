import { doorTrackTexture, sectorEffects, thingCatalog } from "../map/catalog";
import {
  sectorEdges,
  signedArea,
  wallKey,
  wallPartTexture,
  wallTextureOf,
} from "../map/geometry";
import { lineSpecial, lineUsesTag } from "../map/lines";
import type {
  GameMap,
  LineSettings,
  LineSide,
  Point,
  Sector,
  Thing,
  ThingSkill,
} from "../map/types";
import { buildBlockmap } from "./blockmap";
import { buildNodes, type Box, type NodeLine } from "./nodes";

const mapLumpName = "MAP01";
const lineBlocksPlayer = 0x0001;
const lineBlocksEnemies = 0x0002;
const lineTwoSided = 0x0004;
const lineUpperUnpegged = 0x0008;
const lineLowerUnpegged = 0x0010;
const lineHidden = 0x0080;
const specialDoorRaise = 1;
const specialDoorOpen = 31;
const specialSwitchDoorRaise = 63;
const specialSwitchDoorOpen = 61;
const thingSkillFlags: Record<ThingSkill, number> = {
  easy: 0x0001,
  medium: 0x0002,
  hard: 0x0004,
};
const thingOnAllSkills = 0x0007;
const thingAmbush = 0x0008;
const noSidedef = 0xffff;

type Lump = { name: string; data: Uint8Array };

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

function clockwiseLoop(map: GameMap, sector: Sector) {
  const polygon = sector.vertices.map((id) => toDoom(map.vertices[id]));
  return signedArea(polygon) > 0
    ? { ...sector, vertices: sector.vertices.toReversed() }
    : sector;
}

function writeBox(writer: LumpWriter, box: Box) {
  writer.int16(box.top).int16(box.bottom).int16(box.left).int16(box.right);
}

type LevelLine = NodeLine & { wall: string };

function buildLevel(map: GameMap) {
  const used = new Set(map.sectors.flatMap((sector) => sector.vertices));
  const vertexIds = Object.keys(map.vertices).filter((id) => used.has(id));
  const vertexIndex = new Map(vertexIds.map((id, index) => [id, index]));
  const vertices = vertexIds.map((id) => toDoom(map.vertices[id]));
  const sectors = map.sectors.map((sector) => clockwiseLoop(map, sector));

  const owners = new Map<string, number>();
  sectors.forEach((sector, index) => {
    for (const edge of sectorEdges(sector)) {
      const key = `${edge.from}>${edge.to}`;
      if (owners.has(key)) {
        throw new Error(`${sector.name} overlaps another room's wall.`);
      }
      owners.set(key, index);
    }
  });

  const lines: LevelLine[] = [];
  const done = new Set<string>();
  sectors.forEach((sector, index) => {
    for (const edge of sectorEdges(sector)) {
      if (done.has(`${edge.from}>${edge.to}`)) continue;
      const reverse = owners.get(`${edge.to}>${edge.from}`);
      // The engine opens the sector behind a used line, so doors stay on the back.
      if (sector.door && reverse !== undefined) {
        if (sectors[reverse].door) {
          throw new Error(`${sector.name} touches another door.`);
        }
        continue;
      }
      const wall = wallKey(edge.from, edge.to);
      // A line's chosen front room builds it, so that room ends up in front.
      if (
        reverse !== undefined &&
        !sectors[reverse].door &&
        map.lines?.[wall]?.front === sectors[reverse].id
      ) {
        continue;
      }
      done.add(`${edge.from}>${edge.to}`);
      done.add(`${edge.to}>${edge.from}`);
      lines.push({
        start: vertexIndex.get(edge.from)!,
        end: vertexIndex.get(edge.to)!,
        frontSector: index,
        backSector: reverse ?? null,
        wall,
      });
    }
  });

  return { vertices, sectors, lines };
}

function thingFlags(thing: Thing) {
  const skills = thing.skills
    ? thing.skills.reduce((flags, skill) => flags | thingSkillFlags[skill], 0)
    : thingOnAllSkills;
  const enemy = thingCatalog[thing.kind].category === "enemy";
  return skills | (enemy && thing.ambush ? thingAmbush : 0);
}

function lineFlags(line: LineSettings | undefined) {
  return (
    (line?.blocksEnemies ? lineBlocksEnemies : 0) |
    (line?.upperFixed ? lineUpperUnpegged : 0) |
    (line?.lowerFixed ? lineLowerUnpegged : 0) |
    (line?.hidden ? lineHidden : 0)
  );
}

// A switch's door gets a tag no line or sector in the map has chosen.
function sectorTags(map: GameMap, sectors: Sector[]) {
  const used = new Set([
    ...sectors.map((sector) => sector.tag ?? 0),
    ...Object.values(map.lines ?? {}).map((line) => line.action?.tag ?? 0),
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
      const door = backSector.door;
      flags = lineTwoSided | (settings?.blocksAll ? lineBlocksPlayer : 0);
      if (door?.opensBy === "use") {
        special = door.closes ? specialDoorRaise : specialDoorOpen;
      }
      front = writeSide(
        line.frontSector,
        {
          upper:
            door?.texture ??
            wallPartTexture(map, frontSector, line.wall, "upper"),
          lower: wallPartTexture(map, frontSector, line.wall, "lower"),
        },
        sideOf(frontSector),
      );
      back = writeSide(
        line.backSector,
        {
          upper:
            door?.texture ??
            wallPartTexture(map, backSector, line.wall, "upper"),
          lower: wallPartTexture(map, backSector, line.wall, "lower"),
        },
        sideOf(backSector),
      );
    } else if (frontSector.door) {
      flags |= lineLowerUnpegged;
      front = writeSide(
        line.frontSector,
        { middle: doorTrackTexture },
        sideOf(frontSector),
      );
    } else {
      const item = switches.get(line.wall);
      const target = sectors.find((sector) => sector.id === item?.door);
      if (item) flags |= lineLowerUnpegged;
      if (item && target?.door) {
        wired = true;
        special = target.door.closes
          ? specialSwitchDoorRaise
          : specialSwitchDoorOpen;
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
      tag = lineUsesTag(settings.action) ? settings.action.tag : 0;
    }

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
      .int16(sector.effect ? sectorEffects[sector.effect].special : 0)
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
  return packWad(compileLumps(map, slot));
}

function compileEpisode(maps: { slot: string; map: GameMap }[]) {
  return packWad(maps.flatMap(({ slot, map }) => compileLumps(map, slot)));
}

export {
  buildLevel,
  compileEpisode,
  compileLumps,
  compileMap,
  mapLumpName,
  toDoom,
};
