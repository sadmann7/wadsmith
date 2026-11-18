import { thingCatalog } from "../map/catalog";
import { sectorEdges, signedArea } from "../map/geometry";
import type { GameMap, Point, Sector } from "../map/types";
import { buildBlockmap } from "./blockmap";
import { buildNodes, type Box, type NodeLine } from "./nodes";

const mapLumpName = "MAP01";
const lineBlocksPlayer = 0x0001;
const lineTwoSided = 0x0004;
const thingOnAllSkills = 0x0007;
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

function buildLevel(map: GameMap) {
  const vertexIds = Object.keys(map.vertices).filter((id) =>
    map.sectors.some((sector) => sector.vertices.includes(id)),
  );
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

  const lines: NodeLine[] = [];
  const done = new Set<string>();
  sectors.forEach((sector, index) => {
    for (const edge of sectorEdges(sector)) {
      if (done.has(`${edge.from}>${edge.to}`)) continue;
      done.add(`${edge.from}>${edge.to}`);
      done.add(`${edge.to}>${edge.from}`);
      lines.push({
        start: vertexIndex.get(edge.from)!,
        end: vertexIndex.get(edge.to)!,
        frontSector: index,
        backSector: owners.get(`${edge.to}>${edge.from}`) ?? null,
      });
    }
  });

  return { vertices, sectors, lines };
}

function compileLumps(map: GameMap): Lump[] {
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
      .int16(thingOnAllSkills);
  }

  const linedefs = new LumpWriter();
  const sidedefs = new LumpWriter();
  let sideCount = 0;
  const writeSide = (sector: number, twoSided: boolean) => {
    const wall = sectors[sector].wallTexture;
    sidedefs
      .int16(0)
      .int16(0)
      .name(twoSided ? wall : "-")
      .name(twoSided ? wall : "-")
      .name(twoSided ? "-" : wall)
      .int16(sector);
    sideCount += 1;
    return sideCount - 1;
  };
  for (const line of lines) {
    const twoSided = line.backSector !== null;
    const front = writeSide(line.frontSector, twoSided);
    const back = twoSided ? writeSide(line.backSector!, true) : noSidedef;
    linedefs
      .int16(line.start)
      .int16(line.end)
      .int16(twoSided ? lineTwoSided : lineBlocksPlayer)
      .int16(0)
      .int16(0)
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
  for (const sector of sectors) {
    sectorLump
      .int16(sector.floor)
      .int16(sector.ceiling)
      .name(sector.floorTexture)
      .name(sector.ceilingTexture)
      .int16(sector.light)
      .int16(0)
      .int16(0);
  }

  const blockmapWords = buildBlockmap(
    lines.map((line) => ({
      start: vertices[line.start],
      end: vertices[line.end],
    })),
  );
  const blockmap = new LumpWriter();
  for (const word of blockmapWords) blockmap.int16(word);

  return [
    { name: mapLumpName, data: new Uint8Array() },
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

function compileMap(map: GameMap) {
  return packWad(compileLumps(map));
}

export { buildLevel, compileLumps, compileMap, mapLumpName, toDoom };
