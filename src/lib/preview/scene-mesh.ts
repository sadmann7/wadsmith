import type { WallPart } from "@/lib/map/surfaces";
import type { GameMap, Point, Sector, ThingKind } from "@/lib/map/types";
import type { Picture, SceneAssets } from "@/lib/wad/assets";

import { doorTrackTexture, thingCatalog } from "@/lib/map/catalog";
import {
  loopEdges,
  sectorAt,
  sectorLoops,
  wallKey,
  wallPartTexture,
} from "@/lib/map/geometry";
import { surfaceKey } from "@/lib/map/surfaces";

import { skyFlat, thingOwner, type Wall, wallsBySector } from "./render";

export const meshFlags = {
  sky: 1,
  masked: 2,
  sprite: 4,
  flat: 8,
} as const;

// Each vertex is a position, a texel, the picture it reads, its surface, the
// room's light, the wall's contrast, its flags and, for sprites, how far it
// stands to the camera's right and above the thing's base.
export const vertexFloats = 12;

export interface SceneMesh {
  vertices: Float32Array;
  // Walls come first, then floors and ceilings, which are seen from either
  // side, then see-through middle textures, drawn again to find the span
  // each one covers.
  flatStart: number;
  maskedStart: number;
  maskedCount: number;
  // Sprite vertices, which stand where the camera faces.
  sprites: Float32Array;
  pictures: { key: string; picture: Picture }[];
  heavens: Picture | null;
  surfaces: string[];
  ids: Map<string, number>;
  seeThrough: number[];
}

interface MeshOptions {
  assets: SceneAssets;
  sky?: string | null;
  customSprites?: ReadonlyMap<number, string | null>;
}

export interface GhostThing extends Point {
  kind: ThingKind;
  type?: number;
}

export function buildSceneMesh(
  map: GameMap,
  { assets, sky, customSprites }: MeshOptions,
): SceneMesh {
  const skyPicture = sky ? assets.texture(sky) : null;
  const heavens = skyPicture && skyPicture.width > 1 ? skyPicture : null;
  const pictures: { key: string; picture: Picture }[] = [];
  const slots = new Map<string, number>();
  const slotOf = (key: string, picture: Picture) => {
    let slot = slots.get(key);
    if (slot === undefined) {
      slot = pictures.length;
      pictures.push({ key, picture });
      slots.set(key, slot);
    }
    return slot;
  };
  const texture = (name: string) => {
    const picture = assets.texture(name);
    return { picture, slot: slotOf(`texture:${name}`, picture) };
  };
  const skySlot = heavens && sky ? slotOf(`texture:${sky}`, heavens) : 0;

  const surfaces = [""];
  const ids = new Map<string, number>();
  const idOf = (key: string) => {
    let id = ids.get(key);
    if (id === undefined) {
      id = surfaces.length;
      surfaces.push(key);
      ids.set(key, id);
    }
    return id;
  };

  const solid: number[] = [];
  const flats: number[] = [];
  const masked: number[] = [];
  const seeThrough = new Set<number>();

  const walls = wallsBySector(map);
  for (const current of map.sectors) {
    for (const wall of walls.get(current.id) ?? []) {
      addWall(current, wall);
    }
  }

  function addWall(current: Sector, wall: Wall) {
    const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
    const offsetX = wall.side?.offsetX ?? 0;
    const offsetY = wall.side?.offsetY ?? 0;
    const contrast = wall.a.x === wall.b.x ? 1 : wall.a.y === wall.b.y ? -1 : 0;
    const { light } = current;
    const partId = (part: WallPart) =>
      idOf(
        surfaceKey({ kind: "wall", sector: current.id, wall: wall.key, part }),
      );
    const paint = (
      low: number,
      high: number,
      part: WallPart,
      picked: { picture: Picture; slot: number },
      rowTop: number,
    ) =>
      pushWall(
        solid,
        wall.a,
        wall.b,
        low,
        high,
        offsetX,
        length + offsetX,
        rowTop + offsetY,
        picked.slot,
        partId(part),
        light,
        contrast,
        0,
      );
    const partTexture = (part: WallPart) =>
      texture(wallPartTexture(map, current, wall.key, part));

    const next = wall.neighbor;
    if (!next) {
      const name =
        wall.switchTexture ?? (current.door ? doorTrackTexture : null);
      const picked = name ? texture(name) : partTexture("middle");
      const pegged = wall.line?.lowerFixed ?? name !== null;
      paint(
        current.floor,
        current.ceiling,
        "middle",
        picked,
        pegged ? picked.picture.height + current.floor : current.ceiling,
      );
      return;
    }

    const upperPlane = Math.min(current.ceiling, next.ceiling);
    const lowerPlane = Math.max(current.floor, next.floor);
    const openSky =
      heavens !== null &&
      current.ceilingTexture === skyFlat &&
      next.ceilingTexture === skyFlat;
    if (next.ceiling < current.ceiling) {
      if (openSky) {
        // Between two rooms open to the sky the engine draws no wall, only
        // more sky.
        pushWall(
          solid,
          wall.a,
          wall.b,
          next.ceiling,
          current.ceiling,
          0,
          0,
          0,
          skySlot,
          idOf(surfaceKey({ kind: "ceiling", sector: current.id })),
          light,
          0,
          meshFlags.sky,
        );
      } else {
        const picked = next.door
          ? texture(wall.side?.upper ?? next.door.texture)
          : partTexture("upper");
        paint(
          next.ceiling,
          current.ceiling,
          "upper",
          picked,
          wall.line?.upperFixed
            ? current.ceiling
            : upperPlane + picked.picture.height,
        );
      }
    }
    if (next.floor > current.floor) {
      paint(
        current.floor,
        next.floor,
        "lower",
        partTexture("lower"),
        wall.line?.lowerFixed ? current.ceiling : lowerPlane,
      );
    }

    const middle = wall.side?.middle;
    if (!middle || next.door || current.door) return;
    const picked = texture(middle);
    if (picked.picture.width <= 1) return;
    const { picture } = picked;
    // The texture hangs from the top of the opening, or stands on its bottom
    // when the line is pegged there, and isn't repeated.
    const peak =
      (wall.line?.lowerFixed ? lowerPlane + picture.height : upperPlane) +
      offsetY;
    const top = Math.min(openSky ? next.ceiling : upperPlane, peak);
    const bottom = Math.max(lowerPlane, peak - picture.height);
    const id = partId("middle");
    seeThrough.add(id);
    pushWall(
      masked,
      wall.a,
      wall.b,
      bottom,
      top,
      offsetX,
      length + offsetX,
      peak,
      picked.slot,
      id,
      light,
      contrast,
      meshFlags.masked,
    );
    // A line inside a room is one wall seen from both sides, and the engine
    // runs its texture from the viewer's left on each.
    if (next === current) {
      pushWall(
        masked,
        wall.b,
        wall.a,
        bottom,
        top,
        offsetX,
        length + offsetX,
        peak,
        picked.slot,
        id,
        light,
        contrast,
        meshFlags.masked,
      );
    }
  }

  for (const piece of flatPieces(map)) {
    const { sector } = piece;
    const floorId = idOf(surfaceKey({ kind: "floor", sector: sector.id }));
    const ceilingId = idOf(surfaceKey({ kind: "ceiling", sector: sector.id }));
    const plane = (height: number, name: string, id: number) => {
      const isSky = heavens !== null && name === skyFlat;
      const slot = isSky ? skySlot : slotOf(`flat:${name}`, assets.flat(name));
      const flags = isSky ? meshFlags.sky : meshFlags.flat;
      for (const index of [0, 1, 2, 0, 2, 3]) {
        const point = piece.corners[index];
        pushVertex(
          flats,
          point.x,
          point.y,
          height,
          point.x,
          -point.y,
          slot,
          id,
          sector.light,
          0,
          flags,
        );
      }
    };
    plane(sector.floor, sector.floorTexture, floorId);
    plane(sector.ceiling, sector.ceilingTexture, ceilingId);
  }

  const sprites: number[] = [];
  for (const thing of map.things) {
    const picture = thingPicture(assets, thing, customSprites);
    if (!picture) continue;
    const owner = thingOwner(map, thing);
    if (!owner) continue;
    pushSprite(
      sprites,
      thing,
      picture.picture,
      slotOf(picture.key, picture.picture),
      spriteBase(owner, thing.kind),
      idOf(surfaceKey({ kind: "thing", thing: thing.id })),
      owner.light,
    );
  }

  const vertices = new Float32Array(
    solid.length + flats.length + masked.length,
  );
  vertices.set(solid);
  vertices.set(flats, solid.length);
  vertices.set(masked, solid.length + flats.length);
  return {
    vertices,
    flatStart: solid.length / vertexFloats,
    maskedStart: (solid.length + flats.length) / vertexFloats,
    maskedCount: masked.length / vertexFloats,
    sprites: Float32Array.from(sprites),
    pictures,
    heavens,
    surfaces,
    ids,
    seeThrough: [...seeThrough],
  };
}

// The sprite of a thing being placed, read with the same pictures as the
// mesh it is drawn over and added to them when it is new.
export function buildGhost(
  map: GameMap,
  mesh: SceneMesh,
  assets: SceneAssets,
  ghost: GhostThing,
  customSprites?: ReadonlyMap<number, string | null>,
) {
  const picture = thingPicture(assets, ghost, customSprites);
  const owner = sectorAt(map, ghost);
  if (!picture || !owner) return null;
  let slot = mesh.pictures.findIndex((item) => item.key === picture.key);
  if (slot < 0) {
    slot = mesh.pictures.length;
    mesh.pictures.push(picture);
  }
  const out: number[] = [];
  pushSprite(
    out,
    ghost,
    picture.picture,
    slot,
    spriteBase(owner, ghost.kind),
    0,
    owner.light,
  );
  return Float32Array.from(out);
}

interface FlatPiece {
  sector: Sector;
  corners: [Point, Point, Point, Point];
}

interface Segment {
  a: Point;
  b: Point;
  index: number;
}

// The floor and ceiling of every room, cut into trapezoids between the
// map's walls. Each one belongs to the room found in its middle, so a room
// drawn inside another and a pillar take their share out of it, the way the
// 3D view finds the room under a point.
export function flatPieces(map: GameMap): FlatPiece[] {
  const segments: Segment[] = [];
  const seen = new Set<string>();
  for (const sector of map.sectors) {
    for (const loop of sectorLoops(sector)) {
      for (const { from, to } of loopEdges(loop)) {
        const key = wallKey(from, to);
        if (seen.has(key)) continue;
        seen.add(key);
        const first = map.vertices[from];
        const second = map.vertices[to];
        if (!first || !second || first.x === second.x) continue;
        const [a, b] = first.x < second.x ? [first, second] : [second, first];
        segments.push({ a, b, index: segments.length });
      }
    }
  }
  const xs = [...new Set(segments.flatMap(({ a, b }) => [a.x, b.x]))].toSorted(
    (first, second) => first - second,
  );
  const ordered = segments.toSorted((first, second) => first.a.x - second.a.x);
  const yAt = ({ a, b }: Segment, x: number) =>
    a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);

  const pieces: FlatPiece[] = [];
  const owners = new Map<string, Sector | null>();
  // A trapezoid between the same two walls carries on into the next slab,
  // so it is only closed once those walls stop being neighbours.
  const open = new Map<string, { below: Segment; above: Segment; x: number }>();
  const close = (key: string, x: number) => {
    const piece = open.get(key);
    open.delete(key);
    if (!piece || piece.x === x) return;
    const owner = owners.get(key);
    if (!owner) return;
    const { below, above } = piece;
    pieces.push({
      sector: owner,
      corners: [
        { x: piece.x, y: yAt(below, piece.x) },
        { x, y: yAt(below, x) },
        { x, y: yAt(above, x) },
        { x: piece.x, y: yAt(above, piece.x) },
      ],
    });
  };

  let active: Segment[] = [];
  let next = 0;
  for (let slab = 0; slab + 1 < xs.length; slab += 1) {
    const left = xs[slab];
    const right = xs[slab + 1];
    active = active.filter((segment) => segment.b.x > left);
    while (next < ordered.length && ordered[next].a.x <= left) {
      if (ordered[next].b.x > left) active.push(ordered[next]);
      next += 1;
    }
    const middle = (left + right) / 2;
    const crossing = active
      .map((segment) => ({ segment, y: yAt(segment, middle) }))
      .toSorted((first, second) => first.y - second.y);
    const here = new Set<string>();
    for (let index = 0; index + 1 < crossing.length; index += 1) {
      const below = crossing[index];
      const above = crossing[index + 1];
      const key = `${below.segment.index}:${above.segment.index}`;
      here.add(key);
      if (!owners.has(key)) {
        owners.set(
          key,
          sectorAt(map, { x: middle, y: (below.y + above.y) / 2 }) ?? null,
        );
      }
      if (!open.has(key)) {
        open.set(key, { below: below.segment, above: above.segment, x: left });
      }
    }
    for (const key of open.keys()) {
      if (!here.has(key)) close(key, left);
    }
  }
  const last = xs.at(-1) ?? 0;
  for (const key of open.keys()) close(key, last);
  return pieces;
}

// A wall runs from a, on the viewer's left, to b, between two heights. Its
// texel rows count down from `rowTop` at height zero.
function pushWall(
  out: number[],
  a: Point,
  b: Point,
  low: number,
  high: number,
  uA: number,
  uB: number,
  rowTop: number,
  slot: number,
  id: number,
  light: number,
  contrast: number,
  flags: number,
) {
  if (high <= low) return;
  const corner = (point: Point, u: number, z: number) =>
    pushVertex(
      out,
      point.x,
      point.y,
      z,
      u,
      rowTop - z,
      slot,
      id,
      light,
      contrast,
      flags,
    );
  corner(a, uA, low);
  corner(b, uB, low);
  corner(b, uB, high);
  corner(a, uA, low);
  corner(b, uB, high);
  corner(a, uA, high);
}

function pushVertex(
  out: number[],
  x: number,
  y: number,
  z: number,
  u: number,
  v: number,
  slot: number,
  id: number,
  light: number,
  contrast: number,
  flags: number,
) {
  out.push(x, y, z, u, v, slot, id, light, contrast, flags, 0, 0);
}

function thingPicture(
  assets: SceneAssets,
  thing: { kind: ThingKind; type?: number },
  customSprites?: ReadonlyMap<number, string | null>,
) {
  const custom =
    thing.kind === "custom" && thing.type !== undefined
      ? customSprites?.get(thing.type)
      : undefined;
  const frame = custom ? assets.frame(custom) : null;
  if (frame && custom) return { key: `frame:${custom}`, picture: frame };
  const picture = assets.sprite(thing.kind);
  return picture ? { key: `sprite:${thing.kind}`, picture } : null;
}

function pushSprite(
  out: number[],
  at: Point,
  picture: Picture,
  slot: number,
  base: number,
  id: number,
  light: number,
) {
  const left = -picture.leftOffset;
  const right = left + picture.width;
  const top = picture.topOffset;
  const bottom = top - picture.height;
  const corner = (side: number, rise: number, u: number, v: number) =>
    out.push(
      at.x,
      at.y,
      base,
      u,
      v,
      slot,
      id,
      light,
      0,
      meshFlags.sprite,
      side,
      rise,
    );
  corner(left, bottom, 0, picture.height);
  corner(right, bottom, picture.width, picture.height);
  corner(right, top, picture.width, 0);
  corner(left, bottom, 0, picture.height);
  corner(right, top, picture.width, 0);
  corner(left, top, 0, 0);
}

function spriteBase(owner: Sector, kind: ThingKind) {
  const { hangs } = thingCatalog[kind];
  return hangs === undefined ? owner.floor : owner.ceiling - hangs;
}
