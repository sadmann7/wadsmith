import { doorTrackTexture, thingCatalog } from "../map/catalog";
import {
  sectorAt,
  sectorEdges,
  sectorPolygon,
  signedArea,
  wallKey,
  wallPartTexture,
} from "../map/geometry";
import type { WallPart } from "../map/surfaces";
import { surfaceKey } from "../map/surfaces";
import type {
  GameMap,
  LineSettings,
  LineSide,
  Point,
  Sector,
  ThingKind,
} from "../map/types";
import {
  gameFlatShade,
  gameWallShade,
  type Picture,
  type SceneAssets,
} from "../wad/assets";

type Camera = Point & { angle: number; eye?: number };

type RenderTarget = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
  colors: Uint32Array;
  depth: Float32Array;
  pick: Uint16Array;
  surfaces: string[];
  focal: number;
};

type SceneOptions = {
  assets: SceneAssets;
  hovered?: string | null;
  selected?: string | null;
  ghost?: (Point & { kind: ThingKind }) | null;
};

type Wall = {
  a: Point;
  b: Point;
  key: string;
  neighbor: Sector | null;
  switchTexture: string | null;
  line: LineSettings | undefined;
  side: LineSide | undefined;
};

const eyeHeight = 41;
const fieldOfView = Math.PI / 2;
const maxPortals = 32;
const skyColor = 0xff000000;
const maxFloorDistance = 4096;
const selectedOutline = 0xff2b6aff;
const hoveredOutline = 0xffffffff;
const outlineWidth = 2;

function createRenderTarget(width: number, height: number): RenderTarget {
  const pixels = new Uint8ClampedArray(width * height * 4);
  return {
    width,
    height,
    pixels,
    colors: new Uint32Array(pixels.buffer),
    depth: new Float32Array(width * height),
    pick: new Uint16Array(width * height),
    surfaces: [""],
    focal: width / 2 / Math.tan(fieldOfView / 2),
  };
}

function wallsBySector(map: GameMap) {
  const owners = new Map<string, Sector[]>();
  for (const sector of map.sectors) {
    for (const { from, to } of sectorEdges(sector)) {
      const key = wallKey(from, to);
      owners.set(key, [...(owners.get(key) ?? []), sector]);
    }
  }
  const switches = new Map(
    map.switches.map((item) => [wallKey(item.from, item.to), item.texture]),
  );
  return new Map(
    map.sectors.map((sector) => {
      // The engine runs textures left to right as seen from inside the room.
      const flipped = signedArea(sectorPolygon(map, sector)) < 0;
      return [
        sector.id,
        sectorEdges(sector).map(({ from, to }): Wall => {
          const key = wallKey(from, to);
          const line = map.lines?.[key];
          return {
            a: map.vertices[flipped ? to : from],
            b: map.vertices[flipped ? from : to],
            key,
            neighbor: owners.get(key)?.find((item) => item !== sector) ?? null,
            switchTexture: switches.get(key) ?? null,
            line,
            side: line?.sides?.[sector.id],
          };
        }),
      ];
    }),
  );
}

function withClosedDoors(map: GameMap): GameMap {
  return {
    ...map,
    sectors: map.sectors.map((sector) =>
      sector.door ? { ...sector, ceiling: sector.floor } : sector,
    ),
  };
}

function wrap(value: number, size: number) {
  const remainder = Math.floor(value) % size;
  return remainder < 0 ? remainder + size : remainder;
}

function blend(under: number, over: number) {
  const mix = (shift: number) =>
    (((under >>> shift) & 255) + ((over >>> shift) & 255)) >> 1;
  return ((255 << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0;
}

function cameraBasis(camera: Camera) {
  const radians = (camera.angle * Math.PI) / 180;
  const forward = { x: Math.cos(radians), y: -Math.sin(radians) };
  return { forward, right: { x: -forward.y, y: forward.x } };
}

function eyeOf(map: GameMap, camera: Camera) {
  return camera.eye ?? (sectorAt(map, camera)?.floor ?? 0) + eyeHeight;
}

function projectPoint(
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

function pointOnPlane(
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

function renderScene(
  target: RenderTarget,
  sourceMap: GameMap,
  camera: Camera,
  { assets, hovered, selected, ghost }: SceneOptions,
) {
  const { width, height, colors, depth: depths, pick, focal } = target;
  const { shades } = assets;
  const map = withClosedDoors(sourceMap);
  colors.fill(skyColor);
  depths.fill(Infinity);
  pick.fill(0);
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
      let hit: { wall: Wall; distance: number; along: number } | null = null;
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
        if (distance > 0.01 && along >= -1e-6 && along <= 1 + 1e-6) {
          if (!hit || distance < hit.distance) {
            hit = { wall, distance, along: along * Math.hypot(ex, ey) };
          }
        }
      }
      if (!hit) break;

      const { wall, distance, along } = hit;
      const current: Sector = sector;
      const rowOf = (plane: number) =>
        Math.round(horizon - ((plane - eye) * focal) / distance);
      const ceilingRow = rowOf(current.ceiling);
      const floorRow = rowOf(current.floor);
      drawFlat(
        top,
        ceilingRow - 1,
        current.ceiling,
        assets.flat(current.ceilingTexture),
        idOf(surfaceKey({ kind: "ceiling", sector: current.id })),
        current.light,
      );
      drawFlat(
        floorRow + 1,
        bottom,
        current.floor,
        assets.flat(current.floorTexture),
        idOf(surfaceKey({ kind: "floor", sector: current.id })),
        current.light,
      );

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
        const pegged = name !== null || wall.line?.lowerFixed;
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
      if (next.ceiling < current.ceiling) {
        const picture = next.door
          ? assets.texture(next.door.texture)
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
      top = Math.max(top, Math.max(ceilingRow, upperRow));
      bottom = Math.min(bottom, Math.min(floorRow, lowerRow));
      if (top > bottom) break;
      entered = wall.key;
      sector = next;
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
    const owner = sectorAt(map, thing);
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
      }
    }
  }

  const hoveredId = hovered ? surfaceIds.get(hovered) : undefined;
  const selectedId = selected ? surfaceIds.get(selected) : undefined;
  const isEdge = (x: number, y: number, id: number) => {
    for (let step = 1; step <= outlineWidth; step += 1) {
      for (const [nextX, nextY] of [
        [x - step, y],
        [x + step, y],
        [x, y - step],
        [x, y + step],
      ]) {
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height)
          continue;
        if (pick[nextY * width + nextX] !== id) return true;
      }
    }
    return false;
  };
  if (hoveredId !== undefined || selectedId !== undefined) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const id = pick[index];
        if (id !== selectedId && id !== hoveredId) continue;
        if (isEdge(x, y, id)) {
          colors[index] = id === selectedId ? selectedOutline : hoveredOutline;
        }
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

export {
  cameraBasis,
  createRenderTarget,
  pointOnPlane,
  projectPoint,
  renderScene,
  startCamera,
  type Camera,
  type RenderTarget,
};
