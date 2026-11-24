// A port of the parts of Doom 1.9's renderer (r_bsp.c, r_segs.c, r_plane.c,
// r_things.c) that decide how many visplanes, drawsegs, solid segs, openings
// and sprites a view fills. It draws nothing. Angles follow Doom's tables,
// but distances and scales are floats, so a count can be a step off near a
// limit.
import { vanillaThings } from "@/lib/map/doom-info";

import type { Lump } from "./compile";

export const visplaneLimit = 128;
export const drawsegLimit = 256;
export const solidsegLimit = 32;
export const openingLimit = 320 * 64;
export const vispriteLimit = 128;

const viewWidth = 320;
const viewHeight = 168;
const centerX = viewWidth / 2;
const centerY = viewHeight / 2;
const projection = centerX;
const eyeHeight = 41;

const ang45 = 0x20000000;
const ang90 = 0x40000000;
const ang180 = 0x80000000;
const clipAngle = ang45;
const fineShift = 19;
const subsectorFlag = 0x8000;
const twoSided = 4;
const skyFlat = "F_SKY1";
const unset = 0xff;
const slopeRange = 2048;
const minZ = 4;
const notSingle = 0x10;
// Starts spawn no sprite of their own, and teleport destinations and the
// boss brain's spots are kept out of their sector's thing list.
const unseenThings = new Set([1, 2, 3, 4, 11, 14, 87, 89]);
const thingRadius = new Map(
  vanillaThings.map(([type, , radius]) => [type, radius]),
);

// The corners of a box that bound its view, by where the view stands.
const checkCoord = [
  [3, 0, 2, 1],
  [3, 0, 2, 0],
  [3, 1, 2, 0],
  [0, 0, 0, 0],
  [2, 0, 2, 1],
  [0, 0, 0, 0],
  [3, 1, 3, 0],
  [0, 0, 0, 0],
  [2, 0, 3, 1],
  [2, 1, 3, 1],
  [2, 1, 3, 0],
];

interface LevelThing {
  x: number;
  y: number;
  radius: number;
  skills: number;
}

interface LevelSector {
  floor: number;
  ceiling: number;
  floorFlat: string;
  ceilingFlat: string;
  light: number;
  things: LevelThing[];
}

interface LevelSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  angle: number;
  front: LevelSector;
  back: LevelSector | null;
  middle: boolean;
  upper: boolean;
  lower: boolean;
}

interface LevelNode {
  x: number;
  y: number;
  dx: number;
  dy: number;
  boxes: [number[], number[]];
  children: [number, number];
}

export interface Level {
  sectors: LevelSector[];
  segs: LevelSeg[];
  subsectors: { first: number; count: number }[];
  nodes: LevelNode[];
}

export interface ViewCounts {
  visplanes: number;
  drawsegs: number;
  solidsegs: number;
  openings: number;
  vissprites: number;
}

interface Plane {
  height: number;
  flat: string;
  light: number;
  minX: number;
  maxX: number;
  top: Uint8Array;
  bottom: Uint8Array;
}

const { viewAngleToX, xToViewAngle } = viewTables();

export function readLevel(lumps: Lump[]): Level {
  const data = (name: string) => {
    const lump = lumps.find((item) => item.name === name)?.data;
    return lump
      ? new DataView(lump.buffer, lump.byteOffset, lump.byteLength)
      : new DataView(new ArrayBuffer(0));
  };

  const vertexData = data("VERTEXES");
  const vertices = Array.from({ length: count(vertexData, 4) }, (_, i) => ({
    x: vertexData.getInt16(i * 4, true),
    y: vertexData.getInt16(i * 4 + 2, true),
  }));
  const sectorData = data("SECTORS");
  const sectors = Array.from({ length: count(sectorData, 26) }, (_, i) => ({
    floor: sectorData.getInt16(i * 26, true),
    ceiling: sectorData.getInt16(i * 26 + 2, true),
    floorFlat: name(sectorData, i * 26 + 4),
    ceilingFlat: name(sectorData, i * 26 + 12),
    light: sectorData.getInt16(i * 26 + 20, true),
    things: [] as LevelThing[],
  }));
  const sideData = data("SIDEDEFS");
  const sides = Array.from({ length: count(sideData, 30) }, (_, i) => ({
    upper: name(sideData, i * 30 + 4),
    lower: name(sideData, i * 30 + 12),
    middle: name(sideData, i * 30 + 20),
    sector: sectors[sideData.getInt16(i * 30 + 28, true)],
  }));
  const lineData = data("LINEDEFS");
  const lines = Array.from({ length: count(lineData, 14) }, (_, i) => ({
    flags: lineData.getInt16(i * 14 + 4, true),
    sides: [
      lineData.getUint16(i * 14 + 10, true),
      lineData.getUint16(i * 14 + 12, true),
    ],
  }));
  const segData = data("SEGS");
  const segs = Array.from({ length: count(segData, 12) }, (_, i) => {
    const from = vertices[segData.getUint16(i * 12, true)];
    const to = vertices[segData.getUint16(i * 12 + 2, true)];
    const line = lines[segData.getUint16(i * 12 + 6, true)];
    const direction = segData.getInt16(i * 12 + 8, true);
    const side = sides[line.sides[direction]];
    const back =
      line.flags & twoSided ? sides[line.sides[direction ^ 1]] : undefined;
    return {
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      angle: (segData.getUint16(i * 12 + 4, true) * 0x10000) >>> 0,
      front: side.sector,
      back: back?.sector ?? null,
      middle: textured(side.middle),
      upper: textured(side.upper),
      lower: textured(side.lower),
    };
  });
  const subsectorData = data("SSECTORS");
  const subsectors = Array.from(
    { length: count(subsectorData, 4) },
    (_, i) => ({
      count: subsectorData.getUint16(i * 4, true),
      first: subsectorData.getUint16(i * 4 + 2, true),
    }),
  );
  const nodeData = data("NODES");
  const nodes = Array.from({ length: count(nodeData, 28) }, (_, i) => {
    const at = i * 28;
    const box = (offset: number) =>
      [0, 2, 4, 6].map((step) => nodeData.getInt16(at + offset + step, true));
    return {
      x: nodeData.getInt16(at, true),
      y: nodeData.getInt16(at + 2, true),
      dx: nodeData.getInt16(at + 4, true),
      dy: nodeData.getInt16(at + 6, true),
      boxes: [box(8), box(16)] as [number[], number[]],
      children: [
        nodeData.getUint16(at + 24, true),
        nodeData.getUint16(at + 26, true),
      ] as [number, number],
    };
  });
  const level = { sectors, segs, subsectors, nodes };
  const thingData = data("THINGS");
  for (let i = 0; i < count(thingData, 10); i += 1) {
    const type = thingData.getInt16(i * 10 + 6, true);
    const flags = thingData.getInt16(i * 10 + 8, true);
    if (unseenThings.has(type) || flags & notSingle || !(flags & 7)) continue;
    const x = thingData.getInt16(i * 10, true);
    const y = thingData.getInt16(i * 10 + 2, true);
    sectorAtPoint(level, x, y)?.things.push({
      x,
      y,
      radius: thingRadius.get(type) ?? 20,
      skills: flags & 7,
    });
  }
  return level;
}

// Counts what one view of the level fills. The angle is a Doom binary angle,
// counterclockwise from east, and the eye stands 41 above the floor given.
export function countView(
  level: Level,
  viewX: number,
  viewY: number,
  floor: number,
  viewAngle: number,
): ViewCounts {
  const viewZ = floor + eyeHeight;
  const solid: { first: number; last: number }[] = [
    { first: -0x7fffffff, last: -1 },
    { first: viewWidth, last: 0x7fffffff },
  ];
  let solidPeak = solid.length;
  const planes: Plane[] = [];
  let drawsegs = 0;
  let drawsegsWanted = 0;
  let openings = 0;
  const sectorsSeen = new Set<LevelSector>();
  const spritesBySkill = [0, 0, 0];
  const viewCos = Math.cos(bamToRadians(viewAngle));
  const viewSin = Math.sin(bamToRadians(viewAngle));
  const floorClip = new Int16Array(viewWidth).fill(viewHeight);
  const ceilingClip = new Int16Array(viewWidth).fill(-1);

  let front: LevelSector = level.sectors[0];
  let floorPlane: Plane | null = null;
  let ceilingPlane: Plane | null = null;
  let seg: LevelSeg = level.segs[0];
  let angleToSeg = 0;

  const pointToAngle = (x: number, y: number) =>
    fixedPointToAngle(((x - viewX) * 0x10000) | 0, ((y - viewY) * 0x10000) | 0);

  const addSprites = (sector: LevelSector) => {
    if (sectorsSeen.has(sector)) return;
    sectorsSeen.add(sector);
    for (const thing of sector.things) {
      const trX = thing.x - viewX;
      const trY = thing.y - viewY;
      const tz = trX * viewCos + trY * viewSin;
      if (tz < minZ) continue;
      const tx = trX * viewSin - trY * viewCos;
      if (Math.abs(tx) > tz * 4) continue;
      const xScale = projection / tz;
      if (Math.floor(centerX + (tx - thing.radius) * xScale) > viewWidth) {
        continue;
      }
      if (Math.floor(centerX + (tx + thing.radius) * xScale) - 1 < 0) continue;
      for (let skill = 0; skill < 3; skill += 1) {
        if (thing.skills & (1 << skill)) spritesBySkill[skill] += 1;
      }
    }
  };

  const newPlane = (height: number, flat: string, light: number) => {
    const plane: Plane = {
      height,
      flat,
      light,
      minX: viewWidth,
      maxX: -1,
      top: new Uint8Array(viewWidth).fill(unset),
      bottom: new Uint8Array(viewWidth),
    };
    planes.push(plane);
    return plane;
  };

  const findPlane = (height: number, flat: string, light: number) => {
    const sky = flat === skyFlat;
    const key = sky ? { height: 0, light: 0 } : { height, light };
    return (
      planes.find(
        (plane) =>
          plane.height === key.height &&
          plane.flat === flat &&
          plane.light === key.light,
      ) ?? newPlane(key.height, flat, key.light)
    );
  };

  const checkPlane = (plane: Plane, start: number, stop: number) => {
    const [unionL, intrL] =
      start < plane.minX ? [start, plane.minX] : [plane.minX, start];
    const [unionH, intrH] =
      stop > plane.maxX ? [stop, plane.maxX] : [plane.maxX, stop];
    let x = intrL;
    while (x <= intrH && plane.top[x] === unset) x += 1;
    if (x > intrH) {
      plane.minX = unionL;
      plane.maxX = unionH;
      return plane;
    }
    const next = newPlane(plane.height, plane.flat, plane.light);
    next.minX = start;
    next.maxX = stop;
    return next;
  };

  const storeWallRange = (start: number, stop: number) => {
    drawsegsWanted += 1;
    if (drawsegs === drawsegLimit) return;
    const back = seg.back;
    if (back) {
      const width = stop - start + 1;
      const masked = seg.middle;
      const bottomClipped = back.ceiling <= front.floor;
      const topClipped = back.floor >= front.ceiling;
      const bottom =
        front.floor > back.floor || back.floor > viewZ || bottomClipped;
      const top =
        front.ceiling < back.ceiling || back.ceiling < viewZ || topClipped;
      if (masked) openings += width;
      if ((top || masked) && !topClipped) openings += width;
      if ((bottom || masked) && !bottomClipped) openings += width;
    }
    const normal = (seg.angle + ang90) >>> 0;
    let offset = Math.abs(toSigned((normal - angleToSeg) >>> 0));
    if (offset > ang90) offset = ang90;
    const hyp = Math.hypot(seg.x1 - viewX, seg.y1 - viewY);
    const distance = hyp * Math.sin(bamToRadians(ang90 - offset));
    const scaleAt = (x: number) => {
      const visAngle = (viewAngle + xToViewAngle[x]) >>> 0;
      const sineA = Math.sin(bamToRadians(ang90 + visAngle - viewAngle));
      const sineB = Math.sin(bamToRadians(ang90 + visAngle - normal));
      const num = projection * sineB;
      const den = distance * sineA;
      if (den <= num / 65536) return 64;
      return Math.min(64, Math.max(256 / 65536, num / den));
    };
    let scale = scaleAt(start);
    const scaleStep =
      stop > start ? (scaleAt(stop) - scale) / (stop - start) : 0;

    let worldTop = front.ceiling - viewZ;
    const worldBottom = front.floor - viewZ;
    let midTexture = false;
    let topTexture = false;
    let bottomTexture = false;
    let markFloor: boolean;
    let markCeiling: boolean;
    let worldHigh = 0;
    let worldLow = 0;
    if (!back) {
      midTexture = seg.middle;
      markFloor = true;
      markCeiling = true;
    } else {
      worldHigh = back.ceiling - viewZ;
      worldLow = back.floor - viewZ;
      if (front.ceilingFlat === skyFlat && back.ceilingFlat === skyFlat) {
        worldTop = worldHigh;
      }
      markFloor =
        worldLow !== worldBottom ||
        back.floorFlat !== front.floorFlat ||
        back.light !== front.light;
      markCeiling =
        worldHigh !== worldTop ||
        back.ceilingFlat !== front.ceilingFlat ||
        back.light !== front.light;
      if (back.ceiling <= front.floor || back.floor >= front.ceiling) {
        markCeiling = true;
        markFloor = true;
      }
      topTexture = worldHigh < worldTop && seg.upper;
      bottomTexture = worldLow > worldBottom && seg.lower;
    }
    if (front.floor >= viewZ) markFloor = false;
    if (front.ceiling <= viewZ && front.ceilingFlat !== skyFlat) {
      markCeiling = false;
    }

    let topFrac = centerY - worldTop * scale;
    const topStep = -scaleStep * worldTop;
    let bottomFrac = centerY - worldBottom * scale;
    const bottomStep = -scaleStep * worldBottom;
    let pixHigh = centerY - worldHigh * scale;
    const pixHighStep = -scaleStep * worldHigh;
    let pixLow = centerY - worldLow * scale;
    const pixLowStep = -scaleStep * worldLow;

    if (markCeiling && ceilingPlane) {
      ceilingPlane = checkPlane(ceilingPlane, start, stop);
    }
    if (markFloor && floorPlane) {
      floorPlane = checkPlane(floorPlane, start, stop);
    }

    for (let x = start; x <= stop; x += 1) {
      let yl = Math.ceil(topFrac);
      if (yl < ceilingClip[x] + 1) yl = ceilingClip[x] + 1;
      if (markCeiling && ceilingPlane) {
        const top = ceilingClip[x] + 1;
        let bottom = yl - 1;
        if (bottom >= floorClip[x]) bottom = floorClip[x] - 1;
        if (top <= bottom) {
          ceilingPlane.top[x] = top;
          ceilingPlane.bottom[x] = bottom;
        }
      }
      let yh = Math.floor(bottomFrac);
      if (yh >= floorClip[x]) yh = floorClip[x] - 1;
      if (markFloor && floorPlane) {
        let top = yh + 1;
        const bottom = floorClip[x] - 1;
        if (top <= ceilingClip[x]) top = ceilingClip[x] + 1;
        if (top <= bottom) {
          floorPlane.top[x] = top;
          floorPlane.bottom[x] = bottom;
        }
      }
      if (midTexture) {
        ceilingClip[x] = viewHeight;
        floorClip[x] = -1;
      } else {
        if (topTexture) {
          let mid = Math.floor(pixHigh);
          pixHigh += pixHighStep;
          if (mid >= floorClip[x]) mid = floorClip[x] - 1;
          ceilingClip[x] = mid >= yl ? mid : yl - 1;
        } else if (markCeiling) {
          ceilingClip[x] = yl - 1;
        }
        if (bottomTexture) {
          let mid = Math.ceil(pixLow);
          pixLow += pixLowStep;
          if (mid <= ceilingClip[x]) mid = ceilingClip[x] + 1;
          floorClip[x] = mid <= yh ? mid : yh + 1;
        } else if (markFloor) {
          floorClip[x] = yh + 1;
        }
      }
      scale += scaleStep;
      topFrac += topStep;
      bottomFrac += bottomStep;
    }
    drawsegs += 1;
  };

  const clipSolid = (first: number, last: number) => {
    let start = 0;
    while (solid[start].last < first - 1) start += 1;
    if (first < solid[start].first) {
      if (last < solid[start].first - 1) {
        storeWallRange(first, last);
        solid.splice(start, 0, { first, last });
        solidPeak = Math.max(solidPeak, solid.length);
        return;
      }
      storeWallRange(first, solid[start].first - 1);
      solid[start].first = first;
    }
    if (last <= solid[start].last) return;
    let next = start;
    let merged = false;
    while (last >= solid[next + 1].first - 1) {
      storeWallRange(solid[next].last + 1, solid[next + 1].first - 1);
      next += 1;
      if (last <= solid[next].last) {
        solid[start].last = solid[next].last;
        merged = true;
        break;
      }
    }
    if (!merged) {
      storeWallRange(solid[next].last + 1, last);
      solid[start].last = last;
    }
    if (next !== start) solid.splice(start + 1, next - start);
  };

  const clipPass = (first: number, last: number) => {
    let start = 0;
    while (solid[start].last < first - 1) start += 1;
    if (first < solid[start].first) {
      if (last < solid[start].first - 1) {
        storeWallRange(first, last);
        return;
      }
      storeWallRange(first, solid[start].first - 1);
    }
    if (last <= solid[start].last) return;
    while (last >= solid[start + 1].first - 1) {
      storeWallRange(solid[start].last + 1, solid[start + 1].first - 1);
      start += 1;
      if (last <= solid[start].last) return;
    }
    storeWallRange(solid[start].last + 1, last);
  };

  const addLine = (line: LevelSeg) => {
    seg = line;
    let angle1 = pointToAngle(line.x1, line.y1);
    let angle2 = pointToAngle(line.x2, line.y2);
    const span = (angle1 - angle2) >>> 0;
    if (span >= ang180) return;
    angleToSeg = angle1;
    angle1 = (angle1 - viewAngle) >>> 0;
    angle2 = (angle2 - viewAngle) >>> 0;
    let tspan = (angle1 + clipAngle) >>> 0;
    if (tspan > 2 * clipAngle) {
      tspan = (tspan - 2 * clipAngle) >>> 0;
      if (tspan >= span) return;
      angle1 = clipAngle;
    }
    tspan = (clipAngle - angle2) >>> 0;
    if (tspan > 2 * clipAngle) {
      tspan = (tspan - 2 * clipAngle) >>> 0;
      if (tspan >= span) return;
      angle2 = -clipAngle >>> 0;
    }
    const x1 = viewAngleToX[((angle1 + ang90) >>> 0) >>> fineShift];
    const x2 = viewAngleToX[((angle2 + ang90) >>> 0) >>> fineShift];
    if (x1 === x2) return;
    const { back } = line;
    if (!back || back.ceiling <= front.floor || back.floor >= front.ceiling) {
      clipSolid(x1, x2 - 1);
      return;
    }
    if (
      back.ceiling === front.ceiling &&
      back.floor === front.floor &&
      back.ceilingFlat === front.ceilingFlat &&
      back.floorFlat === front.floorFlat &&
      back.light === front.light &&
      !line.middle
    ) {
      return;
    }
    clipPass(x1, x2 - 1);
  };

  const checkBox = (box: number[]) => {
    const [top, bottom, left, right] = box;
    const boxX = viewX <= left ? 0 : viewX < right ? 1 : 2;
    const boxY = viewY >= top ? 0 : viewY > bottom ? 1 : 2;
    const position = (boxY << 2) + boxX;
    if (position === 5) return true;
    const [a, b, c, d] = checkCoord[position];
    let angle1 = (pointToAngle(box[a], box[b]) - viewAngle) >>> 0;
    let angle2 = (pointToAngle(box[c], box[d]) - viewAngle) >>> 0;
    const span = (angle1 - angle2) >>> 0;
    if (span >= ang180) return true;
    let tspan = (angle1 + clipAngle) >>> 0;
    if (tspan > 2 * clipAngle) {
      tspan = (tspan - 2 * clipAngle) >>> 0;
      if (tspan >= span) return false;
      angle1 = clipAngle;
    }
    tspan = (clipAngle - angle2) >>> 0;
    if (tspan > 2 * clipAngle) {
      tspan = (tspan - 2 * clipAngle) >>> 0;
      if (tspan >= span) return false;
      angle2 = -clipAngle >>> 0;
    }
    const sx1 = viewAngleToX[((angle1 + ang90) >>> 0) >>> fineShift];
    let sx2 = viewAngleToX[((angle2 + ang90) >>> 0) >>> fineShift];
    if (sx1 === sx2) return false;
    sx2 -= 1;
    let start = 0;
    while (solid[start].last < sx2) start += 1;
    return !(sx1 >= solid[start].first && sx2 <= solid[start].last);
  };

  const subsector = (index: number) => {
    const { first, count } = level.subsectors[index];
    const firstSeg = level.segs[first];
    if (!firstSeg) return;
    front = firstSeg.front;
    addSprites(front);
    floorPlane =
      front.floor < viewZ
        ? findPlane(front.floor, front.floorFlat, front.light)
        : null;
    ceilingPlane =
      front.ceiling > viewZ || front.ceilingFlat === skyFlat
        ? findPlane(front.ceiling, front.ceilingFlat, front.light)
        : null;
    for (let i = first; i < first + count; i += 1) addLine(level.segs[i]);
  };

  const renderNode = (index: number) => {
    if (index & subsectorFlag) {
      subsector(index === 0xffff ? 0 : index & ~subsectorFlag);
      return;
    }
    const node = level.nodes[index];
    const side = pointOnSide(viewX, viewY, node);
    renderNode(node.children[side]);
    if (checkBox(node.boxes[side ^ 1])) renderNode(node.children[side ^ 1]);
  };

  if (level.nodes.length === 0) subsector(0);
  else renderNode(level.nodes.length - 1);
  return {
    visplanes: planes.length,
    drawsegs: drawsegsWanted,
    solidsegs: solidPeak,
    openings,
    vissprites: Math.max(...spritesBySkill),
  };
}

export function pointOnSide(x: number, y: number, node: LevelNode) {
  if (node.dx === 0) {
    return x <= node.x ? (node.dy > 0 ? 1 : 0) : node.dy < 0 ? 1 : 0;
  }
  if (node.dy === 0) {
    return y <= node.y ? (node.dx < 0 ? 1 : 0) : node.dx > 0 ? 1 : 0;
  }
  const left = node.dy * (x - node.x);
  const right = (y - node.y) * node.dx;
  return right < left ? 0 : 1;
}

function sectorAtPoint(level: Level, x: number, y: number) {
  let index = level.nodes.length - 1;
  if (index < 0) return level.segs[level.subsectors[0]?.first ?? 0]?.front;
  while (!(index & subsectorFlag)) {
    const node = level.nodes[index];
    index = node.children[pointOnSide(x, y, node)];
  }
  const subsector =
    level.subsectors[index === 0xffff ? 0 : index & ~subsectorFlag];
  return subsector && level.segs[subsector.first]?.front;
}

function count(view: DataView, size: number) {
  return Math.floor(view.byteLength / size);
}

function name(view: DataView, at: number) {
  let text = "";
  for (let i = 0; i < 8; i += 1) {
    const code = view.getUint8(at + i);
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text.toUpperCase();
}

function textured(texture: string) {
  return texture !== "" && texture !== "-";
}

function viewTables() {
  const fineCount = 4096;
  // R_InitTextureMapping divides by the fine tangent just past 45°, so
  // this is a little under the 160 that the scale uses.
  const focalLength = centerX / Math.tan(((1024 + 0.5) * Math.PI) / 4096);
  const viewAngleToX = new Int16Array(fineCount);
  for (let i = 0; i < fineCount; i += 1) {
    const tangent = Math.tan(((i - 2048 + 0.5) * Math.PI) / 4096);
    let x: number;
    if (tangent > 2) x = -1;
    else if (tangent < -2) x = viewWidth + 1;
    else {
      x = Math.ceil(centerX - tangent * focalLength);
      x = Math.min(viewWidth + 1, Math.max(-1, x));
    }
    viewAngleToX[i] = x;
  }
  const xToViewAngle = new Uint32Array(viewWidth + 1);
  for (let x = 0; x <= viewWidth; x += 1) {
    let i = 0;
    while (viewAngleToX[i] > x) i += 1;
    xToViewAngle[x] = ((i << fineShift) - ang90) >>> 0;
  }
  for (let i = 0; i < fineCount; i += 1) {
    if (viewAngleToX[i] === -1) viewAngleToX[i] = 0;
    else if (viewAngleToX[i] === viewWidth + 1) viewAngleToX[i] = viewWidth;
  }
  return { viewAngleToX, xToViewAngle };
}

const tanToAngle = Float64Array.from({ length: slopeRange + 1 }, (_, i) =>
  Math.floor((Math.atan(i / slopeRange) / (Math.PI * 2)) * 0x100000000),
);

function fixedPointToAngle(x: number, y: number) {
  if (x === 0 && y === 0) return 0;
  if (x >= 0) {
    if (y >= 0) {
      return x > y
        ? tanToAngle[slopeDiv(y, x)]
        : (ang90 - 1 - tanToAngle[slopeDiv(x, y)]) >>> 0;
    }
    const down = -y;
    return x > down
      ? -tanToAngle[slopeDiv(down, x)] >>> 0
      : (ang90 * 3 + tanToAngle[slopeDiv(x, down)]) >>> 0;
  }
  const left = -x;
  if (y >= 0) {
    return left > y
      ? (ang180 - 1 - tanToAngle[slopeDiv(y, left)]) >>> 0
      : (ang90 + tanToAngle[slopeDiv(left, y)]) >>> 0;
  }
  const down = -y;
  return left > down
    ? (ang180 + tanToAngle[slopeDiv(down, left)]) >>> 0
    : (ang90 * 3 - 1 - tanToAngle[slopeDiv(left, down)]) >>> 0;
}

function slopeDiv(num: number, den: number) {
  const unsignedDen = den >>> 0;
  if (unsignedDen < 512) return slopeRange;
  const answer = Math.floor(
    ((num * 8) % 0x100000000) / Math.floor(unsignedDen / 256),
  );
  return Math.min(answer, slopeRange);
}

function bamToRadians(angle: number) {
  return ((angle >>> 0) / 0x100000000) * Math.PI * 2;
}

function toSigned(angle: number) {
  return angle >= ang180 ? angle - 0x100000000 : angle;
}
