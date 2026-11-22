import type { WallPart } from "@/lib/map/surfaces";
import type {
  GameMap,
  LineSettings,
  LineSide,
  Point,
  Sector,
  Thing,
  ThingKind,
} from "@/lib/map/types";

import { defined } from "@/lib/defined";
import { doorTrackTexture, thingCatalog } from "@/lib/map/catalog";
import {
  loopEdges,
  loopPolygon,
  sectorAt,
  sectorDetails,
  sectorEdges,
  sectorLoops,
  signedArea,
  wallKey,
  wallOwners,
  wallPartTexture,
} from "@/lib/map/geometry";
import { surfaceKey } from "@/lib/map/surfaces";
import {
  gameFlatShade,
  gameWallShade,
  type Picture,
  type SceneAssets,
} from "@/lib/wad/assets";

import { withMovers } from "./movers";

export type Camera = Point & { angle: number; eye?: number };

export interface RenderTarget {
  width: number;
  height: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
  colors: Uint32Array;
  depth: Float32Array;
  pick: Uint16Array;
  // The see-through texture whose span covers each pixel, holes included, so
  // its outline runs round the span and not round every hole, and how far
  // away it is there.
  extent: Uint16Array;
  reach: Float32Array;
  surfaces: string[];
  focal: number;
}

interface SceneOptions {
  assets: SceneAssets;
  hovered?: string | null;
  selected?: string | null;
  ghost?: (Point & { kind: ThingKind }) | null;
  // The texture drawn where a ceiling or floor wears the sky flat.
  sky?: string | null;
  // The doors and lifts shown as they stand once worked.
  opened?: readonly string[];
}

// A see-through texture on an open line, kept until what lies behind it in
// its column is drawn.
interface MaskedColumn {
  from: number;
  to: number;
  distance: number;
  column: number;
  picture: Picture;
  peak: number;
  level: number;
  id: number;
}

interface Wall {
  a: Point;
  b: Point;
  key: string;
  neighbor: Sector | null;
  switchTexture: string | null;
  line: LineSettings | undefined;
  side: LineSide | undefined;
}

const fieldOfView = Math.PI / 2;
const maxPortals = 32;
const skyColor = 0xff000000;
const skyFlat = "F_SKY1";
// The engine wraps the sky four times round the player, puts its row 100 on
// the horizon and draws it as if the view were 320 wide.
const skyTurn = 1024;
const skyHorizon = 100;
const skyView = 320;
const maxFloorDistance = 4096;
const selectedOutline = 0xff2b6aff;
const noMovers: readonly string[] = [];
const hoveredOutline = 0xffffffff;
const outlineWidth = 2;

export function createRenderTarget(
  width: number,
  height: number,
): RenderTarget {
  const pixels = new Uint8ClampedArray(width * height * 4);
  return {
    width,
    height,
    pixels,
    colors: new Uint32Array(pixels.buffer),
    depth: new Float32Array(width * height),
    pick: new Uint16Array(width * height),
    extent: new Uint16Array(width * height),
    reach: new Float32Array(width * height),
    surfaces: [""],
    focal: width / 2 / Math.tan(fieldOfView / 2),
  };
}

export function cameraBasis(camera: Camera) {
  const radians = (camera.angle * Math.PI) / 180;
  const forward = { x: Math.cos(radians), y: -Math.sin(radians) };
  return { forward, right: { x: -forward.y, y: forward.x } };
}

export function projectPoint(
  target: RenderTarget,
  map: GameMap,
  camera: Camera,
  point: Point,
  plane: number,
) {
  const { forward, right } = cameraBasis(camera);
  const dx = point.x - camera.x;
  const dy = point.y - camera.y;
  const distance = dx * forward.x + dy * forward.y;
  if (distance <= 1) return null;
  const scale = target.focal / distance;
  return {
    x: target.width / 2 + (dx * right.x + dy * right.y) * scale,
    y: target.height / 2 - (plane - eyeOf(map, camera)) * scale,
  };
}

export function pointOnPlane(
  target: RenderTarget,
  map: GameMap,
  camera: Camera,
  x: number,
  y: number,
  plane: number,
): Point | null {
  const rows = y - target.height / 2;
  const height = eyeOf(map, camera) - plane;
  if (rows === 0 || height / rows <= 0) return null;
  const distance = (height * target.focal) / rows;
  if (distance > maxFloorDistance) return null;
  const { forward, right } = cameraBasis(camera);
  const spread = (x - target.width / 2) / target.focal;
  return {
    x: camera.x + (forward.x + right.x * spread) * distance,
    y: camera.y + (forward.y + right.y * spread) * distance,
  };
}

export function renderScene(
  target: RenderTarget,
  sourceMap: GameMap,
  camera: Camera,
  { assets, hovered, selected, ghost, sky, opened = noMovers }: SceneOptions,
) {
  const { width, height, colors, pick, extent, reach, focal } = target;
  const depths = target.depth;
  const { shades } = assets;
  const map = withMovers(sourceMap, opened);
  const skyPicture = sky ? assets.texture(sky) : null;
  const heavens = skyPicture && skyPicture.width > 1 ? skyPicture : null;
  colors.fill(skyColor);
  depths.fill(Infinity);
  pick.fill(0);
  extent.fill(0);
  const seeThrough = new Set<number>();
  target.surfaces = [""];

  const start = sectorAt(map, camera);
  if (!start) return false;

  const surfaceIds = new Map<string, number>();
  const idOf = (key: string) => {
    let id = surfaceIds.get(key);
    if (id === undefined) {
      id = target.surfaces.length;
      target.surfaces.push(key);
      surfaceIds.set(key, id);
    }
    return id;
  };

  const walls = wallsBySector(map);
  const { forward, right } = cameraBasis(camera);
  const halfWidth = Math.tan(fieldOfView / 2);
  const horizon = height / 2;
  const eye = eyeOf(map, camera);

  for (let x = 0; x < width; x += 1) {
    const spread = ((2 * (x + 0.5)) / width - 1) * halfWidth;
    const ray = {
      x: forward.x + right.x * spread,
      y: forward.y + right.y * spread,
    };
    let sector = start;
    let top = 0;
    let bottom = height - 1;
    let entered = "";
    const masked: MaskedColumn[] = [];
    // The engine reads the sky by the way the column looks, and so mirrored:
    // a step of its turn first, then wrapped to the texture's width.
    const turn = Math.atan2(-ray.y, ray.x) / (2 * Math.PI);
    const skyColumn = heavens
      ? Math.floor((turn < 0 ? turn + 1 : turn) * skyTurn) % heavens.width
      : 0;
    // The sky is as bright at any distance, and takes the depth of whatever
    // it stands in for, so things in front of it still show.
    const drawSky = (
      from: number,
      to: number,
      id: number,
      depthAt: (y: number) => number,
    ) => {
      if (!heavens) return;
      for (let y = Math.max(from, top); y <= Math.min(to, bottom); y += 1) {
        const row = wrap(
          skyHorizon + ((y + 0.5 - horizon) * skyView) / width,
          heavens.height,
        );
        const index = y * width + x;
        colors[index] =
          shades[heavens.pixels[skyColumn * heavens.height + row]];
        depths[index] = depthAt(y);
        pick[index] = id;
      }
    };
    // A room's walls include those of the rooms drawn inside it, so a wall
    // the ray has already passed can't be the next one it meets.
    let reached = 0.01;

    const drawFlat = (
      from: number,
      to: number,
      plane: number,
      picture: Picture,
      id: number,
      light: number,
    ) => {
      const size = picture.height;
      for (let y = Math.max(from, top); y <= Math.min(to, bottom); y += 1) {
        const rows = Math.abs(y + 0.5 - horizon) || 0.5;
        const distance = (Math.abs(plane - eye) * focal) / rows;
        const u = wrap(camera.x + ray.x * distance, picture.width);
        const v = wrap(-(camera.y + ray.y * distance), size);
        const color = picture.pixels[u * size + v];
        const index = y * width + x;
        colors[index] = shades[gameFlatShade(light, distance) * 256 + color];
        depths[index] = distance;
        pick[index] = id;
      }
    };

    for (let step = 0; step < maxPortals; step += 1) {
      let hit: {
        wall: Wall;
        distance: number;
        along: number;
        length: number;
      } | null = null;
      for (const wall of walls.get(sector.id) ?? []) {
        if (wall.key === entered) continue;
        const ex = wall.b.x - wall.a.x;
        const ey = wall.b.y - wall.a.y;
        const denominator = ray.x * ey - ray.y * ex;
        if (Math.abs(denominator) < 1e-9) continue;
        const ox = wall.a.x - camera.x;
        const oy = wall.a.y - camera.y;
        const distance = (ox * ey - oy * ex) / denominator;
        const along = (ox * ray.y - oy * ray.x) / denominator;
        if (distance > reached && along >= -1e-6 && along <= 1 + 1e-6) {
          if (!hit || distance < hit.distance) {
            const length = Math.hypot(ex, ey);
            hit = { wall, distance, along: along * length, length };
          }
        }
      }
      if (!hit) break;

      const { wall, distance, along, length } = hit;
      const current: Sector = sector;
      const rowOf = (plane: number) =>
        Math.round(horizon - ((plane - eye) * focal) / distance);
      const ceilingRow = rowOf(current.ceiling);
      const floorRow = rowOf(current.floor);
      const ceilingId = idOf(
        surfaceKey({ kind: "ceiling", sector: current.id }),
      );
      const floorId = idOf(surfaceKey({ kind: "floor", sector: current.id }));
      const planeDepth = (plane: number) => (y: number) =>
        (Math.abs(plane - eye) * focal) / (Math.abs(y + 0.5 - horizon) || 0.5);
      if (heavens && current.ceilingTexture === skyFlat) {
        drawSky(top, ceilingRow - 1, ceilingId, planeDepth(current.ceiling));
      } else {
        drawFlat(
          top,
          ceilingRow - 1,
          current.ceiling,
          assets.flat(current.ceilingTexture),
          ceilingId,
          current.light,
        );
      }
      if (heavens && current.floorTexture === skyFlat) {
        drawSky(floorRow + 1, bottom, floorId, planeDepth(current.floor));
      } else {
        drawFlat(
          floorRow + 1,
          bottom,
          current.floor,
          assets.flat(current.floorTexture),
          floorId,
          current.light,
        );
      }

      const contrast =
        wall.a.x === wall.b.x ? 1 : wall.a.y === wall.b.y ? -1 : 0;
      const level = gameWallShade(current.light, distance, contrast);
      const paintWall = (
        from: number,
        to: number,
        part: WallPart,
        picture: Picture,
        textureRow: (plane: number) => number,
      ) => {
        const id = idOf(
          surfaceKey({
            kind: "wall",
            sector: current.id,
            wall: wall.key,
            part,
          }),
        );
        const column = wrap(along + (wall.side?.offsetX ?? 0), picture.width);
        const rowOffset = wall.side?.offsetY ?? 0;
        for (let y = Math.max(from, top); y <= Math.min(to, bottom); y += 1) {
          const plane = eye + ((horizon - y - 0.5) * distance) / focal;
          const row = wrap(textureRow(plane) + rowOffset, picture.height);
          const color = picture.pixels[column * picture.height + row];
          const index = y * width + x;
          colors[index] = shades[level * 256 + color];
          depths[index] = distance;
          pick[index] = id;
        }
      };
      const partPicture = (part: WallPart) =>
        assets.texture(wallPartTexture(map, current, wall.key, part));

      const next: Sector | null = wall.neighbor;
      if (!next) {
        const name =
          wall.switchTexture ?? (current.door ? doorTrackTexture : null);
        const picture = name ? assets.texture(name) : partPicture("middle");
        const pegged = wall.line?.lowerFixed ?? name !== null;
        paintWall(ceilingRow, floorRow, "middle", picture, (plane) =>
          pegged
            ? picture.height - (plane - current.floor)
            : current.ceiling - plane,
        );
        for (let y = top; y <= bottom; y += 1) {
          if (pick[y * width + x] === 0) depths[y * width + x] = distance;
        }
        break;
      }

      const upperPlane = Math.min(current.ceiling, next.ceiling);
      const lowerPlane = Math.max(current.floor, next.floor);
      const upperRow = rowOf(upperPlane);
      const lowerRow = rowOf(lowerPlane);
      if (
        next.ceiling < current.ceiling &&
        heavens &&
        current.ceilingTexture === skyFlat &&
        next.ceilingTexture === skyFlat
      ) {
        // Between two rooms open to the sky the engine draws no wall, only
        // more sky.
        drawSky(ceilingRow, upperRow - 1, ceilingId, () => distance);
      } else if (next.ceiling < current.ceiling) {
        const picture = next.door
          ? assets.texture(wall.side?.upper ?? next.door.texture)
          : partPicture("upper");
        paintWall(ceilingRow, upperRow - 1, "upper", picture, (plane) =>
          wall.line?.upperFixed
            ? current.ceiling - plane
            : upperPlane + picture.height - plane,
        );
      }
      if (next.floor > current.floor) {
        paintWall(
          lowerRow + 1,
          floorRow,
          "lower",
          partPicture("lower"),
          (plane) =>
            wall.line?.lowerFixed
              ? current.ceiling - plane
              : lowerPlane - plane,
        );
      }
      // Two rooms open to the sky share one sky, so the opening between them
      // reaches the further room's ceiling, above this room's or below.
      const openSky =
        heavens &&
        current.ceilingTexture === skyFlat &&
        next.ceilingTexture === skyFlat;
      const middle = wall.side?.middle;
      const picture =
        middle && !next.door && !current.door ? assets.texture(middle) : null;
      if (picture && picture.width > 1) {
        // The texture hangs from the top of the opening, or stands on its
        // bottom when the line is pegged there, and isn't repeated.
        const peak =
          (wall.line?.lowerFixed ? lowerPlane + picture.height : upperPlane) +
          (wall.side?.offsetY ?? 0);
        // A line inside a room is one wall seen from both sides, and the
        // engine runs its texture from the viewer's left on each.
        const behind =
          next === current &&
          (wall.b.x - wall.a.x) * (camera.y - wall.a.y) <
            (wall.b.y - wall.a.y) * (camera.x - wall.a.x);
        masked.push({
          from: Math.max(
            top,
            openSky ? rowOf(next.ceiling) : Math.max(ceilingRow, upperRow),
          ),
          to: Math.min(bottom, floorRow, lowerRow),
          distance,
          column: wrap(
            (behind ? length - along : along) + (wall.side?.offsetX ?? 0),
            picture.width,
          ),
          picture,
          peak,
          level,
          id: idOf(
            surfaceKey({
              kind: "wall",
              sector: current.id,
              wall: wall.key,
              part: "middle",
            }),
          ),
        });
      }
      top = Math.max(
        top,
        openSky ? rowOf(next.ceiling) : Math.max(ceilingRow, upperRow),
      );
      bottom = Math.min(bottom, Math.min(floorRow, lowerRow));
      if (top > bottom) break;
      entered = wall.key;
      reached = distance;
      sector = next;
    }

    for (const item of masked.toReversed()) {
      const { picture } = item;
      seeThrough.add(item.id);
      for (let y = item.from; y <= item.to; y += 1) {
        const plane = eye + ((horizon - y - 0.5) * item.distance) / focal;
        const row = Math.floor(item.peak - plane);
        if (row < 0 || row >= picture.height) continue;
        const index = y * width + x;
        extent[index] = item.id;
        reach[index] = item.distance;
        const source = item.column * picture.height + row;
        if (!picture.opaque[source]) continue;
        colors[index] = shades[item.level * 256 + picture.pixels[source]];
        depths[index] = item.distance;
        pick[index] = item.id;
      }
    }
  }

  const placed = map.things.map((thing) => ({ thing, isGhost: false }));
  const sprites = (
    ghost
      ? [...placed, { thing: { ...ghost, id: "", angle: 0 }, isGhost: true }]
      : placed
  )
    .map(({ thing, isGhost }) => {
      const dx = thing.x - camera.x;
      const dy = thing.y - camera.y;
      return {
        thing,
        isGhost,
        distance: dx * forward.x + dy * forward.y,
        side: dx * right.x + dy * right.y,
      };
    })
    .filter((sprite) => sprite.distance > 8)
    .toSorted((a, b) => b.distance - a.distance);

  for (const { thing, isGhost, distance, side } of sprites) {
    const picture = assets.sprite(thing.kind);
    if (!picture) continue;
    const owner = isGhost ? sectorAt(map, thing) : thingOwner(map, thing);
    const { hangs } = thingCatalog[thing.kind];
    const base =
      hangs === undefined
        ? (owner?.floor ?? start.floor)
        : (owner?.ceiling ?? start.ceiling) - hangs;
    const scale = focal / distance;
    const left = width / 2 + side * scale - picture.leftOffset * scale;
    const peak = horizon - (base + picture.topOffset - eye) * scale;
    const level = gameWallShade(owner?.light ?? start.light, distance);
    const id = isGhost
      ? 0
      : idOf(surfaceKey({ kind: "thing", thing: thing.id }));
    const firstX = Math.max(0, Math.ceil(left));
    const lastX = Math.min(width - 1, Math.floor(left + picture.width * scale));
    const firstY = Math.max(0, Math.ceil(peak));
    const lastY = Math.min(
      height - 1,
      Math.floor(peak + picture.height * scale),
    );
    for (let x = firstX; x <= lastX; x += 1) {
      const column = Math.min(
        picture.width - 1,
        Math.floor((x - left) / scale),
      );
      for (let y = firstY; y <= lastY; y += 1) {
        const index = y * width + x;
        if (distance >= depths[index]) continue;
        const row = Math.min(
          picture.height - 1,
          Math.floor((y - peak) / scale),
        );
        const source = column * picture.height + row;
        if (!picture.opaque[source]) continue;
        const color = shades[level * 256 + picture.pixels[source]];
        if (isGhost) {
          colors[index] = blend(colors[index], color);
          continue;
        }
        colors[index] = color;
        depths[index] = distance;
        pick[index] = id;
        // A thing in front of a see-through texture covers its span there.
        if (extent[index] && distance < reach[index]) extent[index] = 0;
      }
    }
  }

  const hoveredId = hovered ? surfaceIds.get(hovered) : undefined;
  const selectedId = selected ? surfaceIds.get(selected) : undefined;
  const getIsEdge = (x: number, y: number, id: number, ids: Uint16Array) => {
    const own = depths[y * width + x];
    for (let step = 1; step <= outlineWidth; step += 1) {
      for (const [nextX, nextY] of [
        [x - step, y],
        [x + step, y],
        [x, y - step],
        [x, y + step],
      ]) {
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height)
          continue;
        const next = nextY * width + nextX;
        const beside = ids[next];
        if (beside === id) continue;
        // What shows through a see-through texture ends at its holes all
        // over, which is no edge of its own.
        const isVeiled =
          ids === pick && seeThrough.has(beside) && depths[next] < own;
        if (!isVeiled) return true;
      }
    }
    return false;
  };
  if (hoveredId !== undefined || selectedId !== undefined) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        // A see-through texture is outlined round its span, read from the
        // extent, and any other surface round the pixels that show it.
        const span = extent[index];
        const shown = pick[index];
        const spanEdge =
          (span === selectedId || span === hoveredId) &&
          getIsEdge(x, y, span, extent);
        const shownEdge =
          (shown === selectedId || shown === hoveredId) &&
          !seeThrough.has(shown) &&
          getIsEdge(x, y, shown, pick);
        if (!spanEdge && !shownEdge) continue;
        const isSelected =
          (spanEdge && span === selectedId) ||
          (shownEdge && shown === selectedId);
        colors[index] = isSelected ? selectedOutline : hoveredOutline;
      }
    }
  }
  return true;
}

export function startCamera(map: GameMap): Camera {
  const player = map.things.find((thing) => thing.kind === "player");
  if (player) return { x: player.x, y: player.y, angle: player.angle };
  const first = Object.values(map.vertices)[0] ?? { x: 0, y: 0 };
  return { ...first, angle: 0 };
}

const eyeHeight = 41;

function eyeOf(map: GameMap, camera: Camera) {
  return camera.eye ?? (sectorAt(map, camera)?.floor ?? 0) + eyeHeight;
}

const sectorWalls = new WeakMap<GameMap, Map<string, Wall[]>>();

function wallsBySector(map: GameMap) {
  const cached = sectorWalls.get(map);
  if (cached) return cached;
  const owners = wallOwners(map);
  const switches = new Map(
    map.switches.map((item) => [wallKey(item.from, item.to), item.texture]),
  );
  const drawn = new Set<string>();
  for (const sector of map.sectors) {
    for (const { from, to } of sectorEdges(sector)) {
      drawn.add(`${sector.id}:${wallKey(from, to)}`);
    }
  }
  const walls = new Map<string, Wall[]>(
    map.sectors.map((sector) => [sector.id, []]),
  );
  const wallOf = (
    sector: Sector,
    a: Point,
    b: Point,
    key: string,
    neighbor: Sector | null,
  ): Wall => {
    const line = map.lines?.[key];
    return {
      a,
      b,
      key,
      neighbor,
      switchTexture: switches.get(key) ?? null,
      line,
      side: line?.sides?.[sector.id],
    };
  };
  for (const sector of map.sectors) {
    sectorLoops(sector).forEach((loop, at) => {
      // The engine runs textures left to right as seen from inside the room,
      // and a pillar's walls face the other way round.
      const clockwise = signedArea(loopPolygon(map, loop)) < 0;
      const flipped = at > 0 ? !clockwise : clockwise;
      for (const { from, to } of loopEdges(loop)) {
        const key = wallKey(from, to);
        const owning = owners.get(key) ?? [];
        if (!owning.includes(sector)) continue;
        const neighbor = owning.find((item) => item !== sector) ?? null;
        const a = map.vertices[flipped ? to : from];
        const b = map.vertices[flipped ? from : to];
        defined(walls.get(sector.id)).push(wallOf(sector, a, b, key, neighbor));
        // A wall that opens onto the room around it is that room's wall too.
        if (neighbor && !drawn.has(`${neighbor.id}:${key}`)) {
          defined(walls.get(neighbor.id)).push(
            wallOf(neighbor, b, a, key, sector),
          );
        }
      }
    });
    // A line drawn inside a room is a portal back into the same room.
    for (const { from, to } of sectorDetails(sector)) {
      defined(walls.get(sector.id)).push(
        wallOf(
          sector,
          map.vertices[from],
          map.vertices[to],
          wallKey(from, to),
          sector,
        ),
      );
    }
  }
  sectorWalls.set(map, walls);
  return walls;
}

function wrap(value: number, size: number) {
  const remainder = Math.floor(value) % size;
  return remainder < 0 ? remainder + size : remainder;
}

const thingOwners = new WeakMap<GameMap, Map<Thing, Sector | undefined>>();

function thingOwner(map: GameMap, thing: Thing) {
  let owners = thingOwners.get(map);
  if (!owners) {
    owners = new Map();
    thingOwners.set(map, owners);
  }
  if (!owners.has(thing)) owners.set(thing, sectorAt(map, thing));
  return owners.get(thing);
}

function blend(under: number, over: number) {
  const mix = (shift: number) =>
    (((under >>> shift) & 255) + ((over >>> shift) & 255)) >> 1;
  return ((255 << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0;
}
