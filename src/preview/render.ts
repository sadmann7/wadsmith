import { thingCatalog } from "../map/catalog";
import { sectorAt, sectorEdges } from "../map/geometry";
import type { GameMap, Point, Sector } from "../map/types";

type Camera = Point & { angle: number };

type Rgb = readonly [number, number, number];

const eyeHeight = 41;
const fieldOfView = Math.PI / 2;
const maxPortals = 32;
const fallOff = 1100;

const textureColors: Record<string, Rgb> = {
  STARTAN3: [130, 118, 102],
  BROWN1: [120, 88, 60],
  GRAY1: [118, 118, 118],
  METAL: [86, 98, 108],
  STONE2: [104, 100, 92],
  BRICK1: [134, 76, 60],
  TEKGREN2: [62, 112, 86],
  SLADWALL: [84, 92, 84],
  FLOOR4_8: [78, 74, 70],
  FLOOR0_1: [96, 84, 70],
  FLOOR5_1: [84, 70, 58],
  FLAT1: [104, 104, 104],
  FLAT5_4: [92, 88, 80],
  GRASS1: [62, 96, 52],
  RROCK01: [90, 66, 50],
  CEIL3_5: [88, 84, 78],
  CEIL5_1: [70, 72, 76],
  CEIL1_1: [100, 96, 88],
  TLITE6_4: [176, 170, 150],
};

type Wall = {
  a: Point;
  b: Point;
  neighbor: Sector | null;
  key: string;
};

function keyOf(from: string, to: string) {
  return from < to ? `${from}|${to}` : `${to}|${from}`;
}

function wallsBySector(map: GameMap) {
  const owners = new Map<string, Sector[]>();
  for (const sector of map.sectors) {
    for (const { from, to } of sectorEdges(sector)) {
      const key = keyOf(from, to);
      owners.set(key, [...(owners.get(key) ?? []), sector]);
    }
  }
  return new Map(
    map.sectors.map((sector) => [
      sector.id,
      sectorEdges(sector).map(({ from, to }): Wall => {
        const key = keyOf(from, to);
        return {
          a: map.vertices[from],
          b: map.vertices[to],
          key,
          neighbor: owners.get(key)?.find((item) => item !== sector) ?? null,
        };
      }),
    ]),
  );
}

function colorOf(texture: string): Rgb {
  return textureColors[texture] ?? [120, 120, 120];
}

function brightness(light: number, depth: number) {
  return Math.min(1, (light / 200) * (1 / (1 + depth / fallOff)) + 0.05);
}

function renderPreview(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  map: GameMap,
  camera: Camera,
) {
  pixels.fill(0);
  for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255;

  const start = sectorAt(map, camera);
  if (!start) return false;

  const walls = wallsBySector(map);
  const radians = (camera.angle * Math.PI) / 180;
  const forward = { x: Math.cos(radians), y: -Math.sin(radians) };
  const right = { x: -forward.y, y: forward.x };
  const halfWidth = Math.tan(fieldOfView / 2);
  const focal = width / 2 / halfWidth;
  const horizon = height / 2;
  const eye = start.floor + eyeHeight;
  const depths = new Float64Array(width).fill(Infinity);

  const put = (x: number, y: number, color: Rgb, shade: number) => {
    const offset = (y * width + x) * 4;
    pixels[offset] = color[0] * shade;
    pixels[offset + 1] = color[1] * shade;
    pixels[offset + 2] = color[2] * shade;
  };

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

    const flat = (from: number, to: number, plane: number, texture: string) => {
      const color = colorOf(texture);
      for (let y = Math.max(from, top); y <= Math.min(to, bottom); y += 1) {
        const rows = Math.abs(y + 0.5 - horizon) || 0.5;
        const depth = (Math.abs(plane - eye) * focal) / rows;
        put(x, y, color, brightness(sector.light, depth));
      }
    };

    for (let step = 0; step < maxPortals; step += 1) {
      let hit: { wall: Wall; depth: number; along: number } | null = null;
      for (const wall of walls.get(sector.id) ?? []) {
        if (wall.key === entered) continue;
        const ex = wall.b.x - wall.a.x;
        const ey = wall.b.y - wall.a.y;
        const denominator = ray.x * ey - ray.y * ex;
        if (Math.abs(denominator) < 1e-9) continue;
        const ox = wall.a.x - camera.x;
        const oy = wall.a.y - camera.y;
        const depth = (ox * ey - oy * ex) / denominator;
        const along = (ox * ray.y - oy * ray.x) / denominator;
        if (depth > 0.01 && along >= -1e-6 && along <= 1 + 1e-6) {
          if (!hit || depth < hit.depth) {
            hit = { wall, depth, along: along * Math.hypot(ex, ey) };
          }
        }
      }
      if (!hit) break;

      const { wall, depth, along } = hit;
      const rowOf = (plane: number) =>
        Math.round(horizon - ((plane - eye) * focal) / depth);
      const ceilingRow = rowOf(sector.ceiling);
      const floorRow = rowOf(sector.floor);
      flat(top, ceilingRow - 1, sector.ceiling, sector.ceilingTexture);
      flat(floorRow + 1, bottom, sector.floor, sector.floorTexture);

      const wallColor = colorOf(sector.wallTexture);
      const contrast = wall.a.x === wall.b.x ? 0.84 : 1;
      const seam = along % 64 < 1.5 ? 0.82 : 1;
      const shade = brightness(sector.light, depth) * contrast * seam;
      const paint = (from: number, to: number) => {
        for (let y = Math.max(from, top); y <= Math.min(to, bottom); y += 1) {
          put(x, y, wallColor, shade);
        }
      };

      const next: Sector | null = wall.neighbor;
      if (!next) {
        paint(ceilingRow, floorRow);
        depths[x] = depth;
        break;
      }
      const upperRow = rowOf(Math.min(sector.ceiling, next.ceiling));
      const lowerRow = rowOf(Math.max(sector.floor, next.floor));
      if (next.ceiling < sector.ceiling) paint(ceilingRow, upperRow - 1);
      if (next.floor > sector.floor) paint(lowerRow + 1, floorRow);
      top = Math.max(top, Math.max(ceilingRow, upperRow));
      bottom = Math.min(bottom, Math.min(floorRow, lowerRow));
      if (top > bottom) {
        depths[x] = depth;
        break;
      }
      entered = wall.key;
      sector = next;
    }
  }

  const sprites = map.things
    .filter((thing) => thing.kind !== "player")
    .map((thing) => {
      const dx = thing.x - camera.x;
      const dy = thing.y - camera.y;
      return {
        thing,
        depth: dx * forward.x + dy * forward.y,
        side: dx * right.x + dy * right.y,
      };
    })
    .filter((sprite) => sprite.depth > 8)
    .toSorted((a, b) => b.depth - a.depth);

  for (const { thing, depth, side } of sprites) {
    const floor = sectorAt(map, thing)?.floor ?? start.floor;
    const monster = thingCatalog[thing.kind].monster;
    const worldHeight = monster ? 56 : 20;
    const worldWidth = monster ? 36 : 22;
    const center = width / 2 + (side * focal) / depth;
    const halfSize = (worldWidth * focal) / depth / 2;
    const base = Math.round(horizon - ((floor - eye) * focal) / depth);
    const peak = Math.round(
      horizon - ((floor + worldHeight - eye) * focal) / depth,
    );
    const hex = thingCatalog[thing.kind].color;
    const color: Rgb = [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ];
    const first = Math.max(0, Math.floor(center - halfSize));
    const last = Math.min(width - 1, Math.ceil(center + halfSize));
    for (let x = first; x <= last; x += 1) {
      if (depth >= depths[x]) continue;
      for (let y = Math.max(0, peak); y <= Math.min(height - 1, base); y += 1) {
        put(x, y, color, 1);
      }
    }
  }
  return true;
}

function startCamera(map: GameMap): Camera {
  const player = map.things.find((thing) => thing.kind === "player");
  if (player) return { x: player.x, y: player.y, angle: player.angle };
  const first = Object.values(map.vertices)[0] ?? { x: 0, y: 0 };
  return { ...first, angle: 0 };
}

export { renderPreview, startCamera, type Camera };
