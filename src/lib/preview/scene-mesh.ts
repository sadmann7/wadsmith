import type { WallPart } from "@/lib/map/surfaces";
import type { GameMap, Point, Sector, Thing, ThingKind } from "@/lib/map/types";
import type { Picture, SceneAssets } from "@/lib/wad/assets";

import { doorTrackTexture, thingCatalog } from "@/lib/map/catalog";
import {
  loopEdges,
  loopPolygon,
  sectorAt,
  sectorContainers,
  sectorDetails,
  sectorEdges,
  sectorLoops,
  sectorVertices,
  signedArea,
  wallKey,
  wallOwners,
  wallPartTexture,
} from "@/lib/map/geometry";
import { surfaceKey } from "@/lib/map/surfaces";

import { skyFlat, type Wall } from "./render";

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

// A room's share of the scene. Walls are drawn from their front only, floors
// and ceilings from either side, and see-through middle textures again to
// find the span each one covers.
export interface SectorChunk {
  solid: Float32Array;
  flats: Float32Array;
  masked: Float32Array;
  seeThrough: number[];
}

type Corners = [Point, Point, Point, Point];

// A wall as found, with its room beside it by id, so it can be drawn again
// with that room, its line and its switch as a later map has them.
interface WallRecord {
  a: Point;
  b: Point;
  key: string;
  neighbor: string | null;
}

// The scene as triangles, one chunk per room and one sprite per thing, kept
// up to date by `updateSceneMesh`. Picture slots and surface ids only grow,
// so the ones a chunk was built with stay valid.
export interface SceneMesh {
  map: GameMap;
  assets: SceneAssets;
  sky: string | null;
  customSprites: ReadonlyMap<number, string | null> | undefined;
  heavens: Picture | null;
  skySlot: number;
  pictures: { key: string; picture: Picture }[];
  slots: Map<string, number>;
  surfaces: string[];
  ids: Map<string, number>;
  chunks: Map<string, SectorChunk>;
  sprites: Map<string, Float32Array>;
  sectors: Map<string, Sector>;
  walls: Map<string, WallRecord[]>;
  wallSectors: Map<string, Set<string>>;
  pieces: Map<string, Corners[]>;
  switches: Map<string, string>;
  things: Map<string, { thing: Thing; owner: string | null }>;
}

// The rooms and things whose triangles changed. A full change replaces them
// all.
export interface MeshChanges {
  full: boolean;
  sectors: string[];
  things: string[];
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

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function buildSceneMesh(map: GameMap, options: MeshOptions) {
  return updateSceneMesh(null, map, options).mesh;
}

// Brings a mesh up to date with a map, rebuilding only the rooms an edit
// reached: those it changed, the rooms beside them, and, when corners moved
// or rooms were reshaped, the rooms whose floors lie in the area it touched.
export function updateSceneMesh(
  mesh: SceneMesh | null,
  map: GameMap,
  options: MeshOptions,
): { mesh: SceneMesh; changes: MeshChanges } {
  const sky = options.sky ?? null;
  if (
    !mesh ||
    mesh.assets !== options.assets ||
    mesh.sky !== sky ||
    mesh.customSprites !== options.customSprites
  ) {
    return {
      mesh: createMesh(map, options.assets, sky, options.customSprites),
      changes: { full: true, sectors: [], things: [] },
    };
  }
  if (mesh.map === map) {
    return { mesh, changes: { full: false, sectors: [], things: [] } };
  }
  const previous = mesh.map;
  const sectors = new Map(map.sectors.map((sector) => [sector.id, sector]));
  const changed = new Set<string>();
  const reshaped = new Set<string>();
  for (const sector of map.sectors) {
    const before = mesh.sectors.get(sector.id);
    if (!before) {
      changed.add(sector.id);
      reshaped.add(sector.id);
    } else if (before !== sector) {
      if (!getIsSameRecord(before, sector)) changed.add(sector.id);
      if (
        before.vertices !== sector.vertices ||
        before.holes !== sector.holes ||
        before.details !== sector.details
      ) {
        reshaped.add(sector.id);
      }
    }
  }
  for (const id of mesh.sectors.keys()) {
    if (!sectors.has(id)) {
      changed.add(id);
      reshaped.add(id);
    }
  }
  const moved =
    previous.vertices === map.vertices
      ? []
      : changedKeys(previous.vertices, map.vertices, (a, b) =>
          Boolean(a && b && a.x === b.x && a.y === b.y),
        );
  const lineKeys =
    previous.lines === map.lines
      ? []
      : changedKeys(previous.lines ?? {}, map.lines ?? {}, (a, b) => a === b);
  const switches =
    previous.switches === map.switches ? mesh.switches : switchesOf(map);
  const wallKeys = [
    ...lineKeys,
    ...changedKeys(
      Object.fromEntries(mesh.switches),
      Object.fromEntries(switches),
      (a, b) => a === b,
    ),
  ];
  const isReshaped =
    reshaped.size > 0 ||
    moved.length > 0 ||
    lineKeys.some(
      (key) => !previous.lines?.[key]?.solid !== !map.lines?.[key]?.solid,
    );

  // A room's walls read the rooms beside them, its lines and its switches.
  const dirty = new Set(changed);
  const reach = () => {
    for (const id of changed) {
      for (const wall of mesh.walls.get(id) ?? []) {
        if (wall.neighbor) dirty.add(wall.neighbor);
      }
    }
    for (const key of wallKeys) {
      for (const id of mesh.wallSectors.get(key) ?? []) dirty.add(id);
    }
  };
  reach();
  let region: Box | null = null;
  if (isReshaped) {
    const owners = wallOwners(map);
    const ownersBefore = wallOwners(previous);
    const containers = sectorContainers(map);
    const containersBefore = sectorContainers(previous);
    const movedSet = new Set(moved);
    const reached = new Set(reshaped);
    for (const sector of map.sectors) {
      if (
        containers.get(sector.id)?.id !== containersBefore.get(sector.id)?.id ||
        (movedSet.size > 0 &&
          sectorVertices(sector).some((id) => movedSet.has(id)))
      ) {
        reached.add(sector.id);
      }
    }
    // Every room on a wall these rooms have, before or after, may see that
    // wall differently, and a room drawn inside another lends it its walls.
    const keys = new Set(lineKeys);
    const rebuilt = new Set(reached);
    for (const id of reached) {
      for (const [sector, around] of [
        [mesh.sectors.get(id), containersBefore],
        [sectors.get(id), containers],
      ] as const) {
        if (!sector) continue;
        for (const { from, to } of sectorEdges(sector)) {
          keys.add(wallKey(from, to));
        }
        const container = around.get(id);
        if (container) rebuilt.add(container.id);
      }
    }
    for (const key of keys) {
      for (const list of [ownersBefore.get(key), owners.get(key)]) {
        for (const sector of list ?? []) rebuilt.add(sector.id);
      }
    }
    const children = new Map<string, Sector[]>();
    for (const sector of map.sectors) {
      const container = containers.get(sector.id);
      if (!container) continue;
      const list = children.get(container.id) ?? [];
      list.push(sector);
      children.set(container.id, list);
    }
    for (const id of rebuilt) {
      const sector = sectors.get(id);
      setWalls(
        mesh,
        id,
        sector ? sectorWalls(map, sector, owners, children.get(id)) : null,
      );
      dirty.add(id);
    }
    reach();

    // A moved corner sweeps the whole of each wall it ends, so the touched
    // area spans those walls, before and after.
    const touched: Point[] = [];
    for (const id of reached) {
      const sector = sectors.get(id);
      for (const { from, to } of sector ? sectorEdges(sector) : []) {
        if (!movedSet.has(from) && !movedSet.has(to)) continue;
        for (const source of [previous, map]) {
          for (const point of [source.vertices[from], source.vertices[to]]) {
            if (point) touched.push(point);
          }
        }
      }
    }
    for (const id of reshaped) {
      for (const [source, sector] of [
        [previous, mesh.sectors.get(id)],
        [map, sectors.get(id)],
      ] as const) {
        for (const vertex of sector ? sectorVertices(sector) : []) {
          const point = source.vertices[vertex];
          if (point) touched.push(point);
        }
      }
    }
    region = boxOf(touched);
    for (const id of reshaped) mesh.pieces.delete(id);
    if (region) {
      // Only the floors of rooms around the touched area can be cut or
      // owned differently, so only they are cut again, from the walls of
      // the rooms around them.
      const floors = new Set<string>();
      const nearby: Sector[] = [];
      let area: Box | null = null;
      const boxes = map.sectors.map((sector) => ({
        sector,
        box: boxOf(sector.vertices.flatMap((id) => map.vertices[id] ?? [])),
      }));
      for (const { sector, box } of boxes) {
        if (!box || !getIsOverlapping(box, region)) continue;
        floors.add(sector.id);
        area = area ? boxOf([...corners(area), ...corners(box)]) : box;
      }
      if (area) {
        for (const { sector, box } of boxes) {
          if (box && getIsOverlapping(box, area)) nearby.push(sector);
        }
      }
      for (const id of floors) {
        mesh.pieces.delete(id);
        dirty.add(id);
      }
      if (area) {
        for (const piece of flatPieces(map, area, nearby)) {
          if (!floors.has(piece.sector.id)) continue;
          const list = mesh.pieces.get(piece.sector.id) ?? [];
          list.push(piece.corners);
          mesh.pieces.set(piece.sector.id, list);
        }
      }
    }
  }
  mesh.map = map;
  mesh.sectors = sectors;
  mesh.switches = switches;
  for (const id of dirty) {
    const sector = sectors.get(id);
    if (sector) mesh.chunks.set(id, sectorChunk(mesh, sector));
    else mesh.chunks.delete(id);
  }
  const things =
    previous.things === map.things && changed.size === 0 && !region
      ? []
      : updateThings(mesh, changed, region);
  return { mesh, changes: { full: false, sectors: [...dirty], things } };
}

// The sprite of a thing being placed, read with the same pictures as the
// mesh it is drawn over and added to them when it is new.
export function buildGhost(map: GameMap, mesh: SceneMesh, ghost: GhostThing) {
  const picture = thingPicture(mesh.assets, ghost, mesh.customSprites);
  const owner = sectorAt(map, ghost);
  if (!picture || !owner) return null;
  const out: number[] = [];
  pushSprite(
    out,
    ghost,
    picture.picture,
    slotOf(mesh, picture.key, picture.picture),
    spriteBase(owner, ghost.kind),
    0,
    owner.light,
  );
  return Float32Array.from(out);
}

interface FlatPiece {
  sector: Sector;
  corners: Corners;
}

interface Segment {
  a: Point;
  b: Point;
  index: number;
}

// The floor and ceiling of every room, cut into trapezoids between the
// map's walls, each owned by the room the 3D view finds in its middle. Within
// a region only the walls that reach it are read, which cuts the floors of
// the rooms inside it the same.
export function flatPieces(
  map: GameMap,
  region?: Box,
  sectors = map.sectors,
): FlatPiece[] {
  const segments: Segment[] = [];
  const upright = new Map<number, [number, number][]>();
  const seen = new Set<string>();
  for (const sector of sectors) {
    for (const loop of sectorLoops(sector)) {
      for (const { from, to } of loopEdges(loop)) {
        const key = wallKey(from, to);
        if (seen.has(key)) continue;
        seen.add(key);
        const first = map.vertices[from];
        const second = map.vertices[to];
        if (!first || !second) continue;
        if (first.x === second.x) {
          const spans = upright.get(first.x) ?? [];
          spans.push([
            Math.min(first.y, second.y),
            Math.max(first.y, second.y),
          ]);
          upright.set(first.x, spans);
          continue;
        }
        const [a, b] = first.x < second.x ? [first, second] : [second, first];
        if (
          region &&
          !getIsOverlapping(region, {
            left: a.x,
            right: b.x,
            top: Math.min(a.y, b.y),
            bottom: Math.max(a.y, b.y),
          })
        ) {
          continue;
        }
        segments.push({ a, b, index: segments.length });
      }
    }
  }
  let xs = [...new Set(segments.flatMap(({ a, b }) => [a.x, b.x]))];
  if (region) {
    xs = [
      ...new Set([
        region.left,
        region.right,
        ...xs.filter((x) => x > region.left && x < region.right),
      ]),
    ];
  }
  xs.sort((first, second) => first - second);
  const ordered = segments.toSorted((first, second) => first.a.x - second.a.x);
  const yAt = ({ a, b }: Segment, x: number) =>
    a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);

  const pieces: FlatPiece[] = [];
  const owners = new Map<string, Sector | null>();
  // A trapezoid between the same two walls carries on into the next slab,
  // so it is only closed once those walls stop being neighbours or an
  // upright wall stands between them.
  const open = new Map<string, { below: Segment; above: Segment; x: number }>();
  const close = (key: string, x: number) => {
    const piece = open.get(key);
    open.delete(key);
    const owner = owners.get(key);
    owners.delete(key);
    if (!piece || piece.x === x) return;
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
      const y = (below.y + above.y) / 2;
      if (region && (y < region.top || y > region.bottom)) continue;
      const key = `${below.segment.index}:${above.segment.index}`;
      here.add(key);
      if (open.has(key)) {
        const low = yAt(below.segment, left);
        const high = yAt(above.segment, left);
        const isSplit = (upright.get(left) ?? []).some(
          ([top, bottom]) => top < high && bottom > low,
        );
        if (isSplit) close(key, left);
      }
      if (!owners.has(key)) {
        owners.set(key, sectorAt(map, { x: middle, y }) ?? null);
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

function createMesh(
  map: GameMap,
  assets: SceneAssets,
  sky: string | null,
  customSprites: ReadonlyMap<number, string | null> | undefined,
): SceneMesh {
  const skyPicture = sky ? assets.texture(sky) : null;
  const heavens = skyPicture && skyPicture.width > 1 ? skyPicture : null;
  const pieces = new Map<string, Corners[]>();
  for (const piece of flatPieces(map)) {
    const list = pieces.get(piece.sector.id) ?? [];
    list.push(piece.corners);
    pieces.set(piece.sector.id, list);
  }
  const mesh: SceneMesh = {
    map,
    assets,
    sky,
    customSprites,
    heavens,
    skySlot: 0,
    pictures: [],
    slots: new Map(),
    surfaces: [""],
    ids: new Map(),
    chunks: new Map(),
    sprites: new Map(),
    sectors: new Map(map.sectors.map((sector) => [sector.id, sector])),
    walls: new Map(),
    wallSectors: new Map(),
    pieces,
    switches: switchesOf(map),
    things: new Map(),
  };
  if (heavens && sky) mesh.skySlot = slotOf(mesh, `texture:${sky}`, heavens);
  const owners = wallOwners(map);
  const containers = sectorContainers(map);
  const children = new Map<string, Sector[]>();
  for (const sector of map.sectors) {
    const container = containers.get(sector.id);
    if (!container) continue;
    const list = children.get(container.id) ?? [];
    list.push(sector);
    children.set(container.id, list);
  }
  for (const sector of map.sectors) {
    setWalls(
      mesh,
      sector.id,
      sectorWalls(map, sector, owners, children.get(sector.id)),
    );
  }
  for (const sector of map.sectors) {
    mesh.chunks.set(sector.id, sectorChunk(mesh, sector));
  }
  updateThings(mesh, new Set(), null);
  return mesh;
}

function slotOf(mesh: SceneMesh, key: string, picture: Picture) {
  let slot = mesh.slots.get(key);
  if (slot === undefined) {
    slot = mesh.pictures.length;
    mesh.pictures.push({ key, picture });
    mesh.slots.set(key, slot);
  }
  return slot;
}

function getIsSameRecord(before: object, after: object) {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  );
}

function changedKeys<T>(
  before: Readonly<Record<string, T>>,
  after: Readonly<Record<string, T>>,
  isSame: (a: T | undefined, b: T | undefined) => boolean,
) {
  const keys: string[] = [];
  for (const key in after) {
    if (!isSame(before[key], after[key])) keys.push(key);
  }
  for (const key in before) {
    if (!(key in after)) keys.push(key);
  }
  return keys;
}

function switchesOf(map: GameMap) {
  return new Map(
    map.switches.map((item) => [wallKey(item.from, item.to), item.texture]),
  );
}

function setWalls(mesh: SceneMesh, id: string, walls: WallRecord[] | null) {
  for (const wall of mesh.walls.get(id) ?? []) {
    mesh.wallSectors.get(wall.key)?.delete(id);
  }
  if (!walls) {
    mesh.walls.delete(id);
    return;
  }
  mesh.walls.set(id, walls);
  for (const wall of walls) {
    const ids = mesh.wallSectors.get(wall.key);
    if (ids) ids.add(id);
    else mesh.wallSectors.set(wall.key, new Set([id]));
  }
}

// A room's walls as `wallsBySector` finds them: its own, the walls of the
// rooms drawn inside it that open onto it, and the lines drawn inside it.
function sectorWalls(
  map: GameMap,
  sector: Sector,
  owners: Map<string, Sector[]>,
  inside: readonly Sector[] = [],
): WallRecord[] {
  const walls: WallRecord[] = [];
  const drawn = new Set(
    sectorEdges(sector).map(({ from, to }) => wallKey(from, to)),
  );
  const add = (from: Sector, reversed: boolean) => {
    sectorLoops(from).forEach((loop, at) => {
      // The engine runs textures left to right as seen from inside the room,
      // and a pillar's walls face the other way round.
      const clockwise = signedArea(loopPolygon(map, loop)) < 0;
      const flipped = (at > 0 ? !clockwise : clockwise) !== reversed;
      for (const { from: start, to } of loopEdges(loop)) {
        const key = wallKey(start, to);
        const owning = owners.get(key) ?? [];
        if (!owning.includes(from)) continue;
        const neighbor = owning.find((item) => item !== from) ?? null;
        if (reversed && (neighbor !== sector || drawn.has(key))) continue;
        walls.push({
          a: map.vertices[flipped ? to : start],
          b: map.vertices[flipped ? start : to],
          key,
          neighbor: reversed ? from.id : (neighbor?.id ?? null),
        });
      }
    });
  };
  add(sector, false);
  for (const room of inside) add(room, true);
  for (const { from, to } of sectorDetails(sector)) {
    walls.push({
      a: map.vertices[from],
      b: map.vertices[to],
      key: wallKey(from, to),
      neighbor: sector.id,
    });
  }
  return walls;
}

function boxOf(points: readonly Point[]): Box | null {
  if (points.length === 0) return null;
  const box = {
    left: Infinity,
    top: Infinity,
    right: -Infinity,
    bottom: -Infinity,
  };
  for (const { x, y } of points) {
    box.left = Math.min(box.left, x);
    box.right = Math.max(box.right, x);
    box.top = Math.min(box.top, y);
    box.bottom = Math.max(box.bottom, y);
  }
  return box;
}

function getIsOverlapping(a: Box, b: Box) {
  return (
    a.left <= b.right &&
    b.left <= a.right &&
    a.top <= b.bottom &&
    b.top <= a.bottom
  );
}

function corners(box: Box): Point[] {
  return [
    { x: box.left, y: box.top },
    { x: box.right, y: box.bottom },
  ];
}

function sectorChunk(mesh: SceneMesh, current: Sector): SectorChunk {
  const { map, assets, heavens, skySlot } = mesh;
  const solid: number[] = [];
  const flats: number[] = [];
  const masked: number[] = [];
  const seeThrough = new Set<number>();
  const texture = (name: string) => {
    const picture = assets.texture(name);
    return { picture, slot: slotOf(mesh, `texture:${name}`, picture) };
  };

  // Walls are kept from the map they were found in, so the rooms, lines and
  // switches they read are looked up in this one.
  for (const found of mesh.walls.get(current.id) ?? []) {
    const line = map.lines?.[found.key];
    addWall({
      ...found,
      neighbor: found.neighbor
        ? (mesh.sectors.get(found.neighbor) ?? null)
        : null,
      switchTexture: mesh.switches.get(found.key) ?? null,
      line,
      side: line?.sides?.[current.id],
    });
  }

  function addWall(wall: Wall) {
    const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
    const offsetX = wall.side?.offsetX ?? 0;
    const offsetY = wall.side?.offsetY ?? 0;
    const contrast = wall.a.x === wall.b.x ? 1 : wall.a.y === wall.b.y ? -1 : 0;
    const { light } = current;
    const partId = (part: WallPart) =>
      idOf(
        mesh,
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
          idOf(mesh, surfaceKey({ kind: "ceiling", sector: current.id })),
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

  const floorId = idOf(mesh, surfaceKey({ kind: "floor", sector: current.id }));
  const ceilingId = idOf(
    mesh,
    surfaceKey({ kind: "ceiling", sector: current.id }),
  );
  const plane = (
    pieceCorners: Corners,
    height: number,
    name: string,
    id: number,
  ) => {
    const isSky = heavens !== null && name === skyFlat;
    const slot = isSky
      ? skySlot
      : slotOf(mesh, `flat:${name}`, assets.flat(name));
    const flags = isSky ? meshFlags.sky : meshFlags.flat;
    for (const index of [0, 1, 2, 0, 2, 3]) {
      const point = pieceCorners[index];
      pushVertex(
        flats,
        point.x,
        point.y,
        height,
        point.x,
        -point.y,
        slot,
        id,
        current.light,
        0,
        flags,
      );
    }
  };
  for (const piece of mesh.pieces.get(current.id) ?? []) {
    plane(piece, current.floor, current.floorTexture, floorId);
    plane(piece, current.ceiling, current.ceilingTexture, ceilingId);
  }
  return {
    solid: Float32Array.from(solid),
    flats: Float32Array.from(flats),
    masked: Float32Array.from(masked),
    seeThrough: [...seeThrough],
  };
}

function updateThings(
  mesh: SceneMesh,
  changed: ReadonlySet<string>,
  region: Box | null,
) {
  const { map } = mesh;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const thing of map.things) {
    seen.add(thing.id);
    const known = mesh.things.get(thing.id);
    let owner = known?.owner ?? null;
    // A spot changes rooms only where corners moved.
    if (
      !known ||
      known.thing.x !== thing.x ||
      known.thing.y !== thing.y ||
      (region && getIsInside(region, thing)) ||
      (owner && !mesh.sectors.has(owner))
    ) {
      owner = sectorAt(map, thing)?.id ?? null;
    }
    if (
      known &&
      known.thing === thing &&
      known.owner === owner &&
      !(owner && changed.has(owner))
    ) {
      continue;
    }
    mesh.things.set(thing.id, { thing, owner });
    mesh.sprites.set(thing.id, thingSprite(mesh, thing, owner));
    out.push(thing.id);
  }
  for (const id of mesh.things.keys()) {
    if (seen.has(id)) continue;
    mesh.things.delete(id);
    mesh.sprites.delete(id);
    out.push(id);
  }
  return out;
}

function getIsInside(box: Box, point: Point) {
  return (
    point.x >= box.left &&
    point.x <= box.right &&
    point.y >= box.top &&
    point.y <= box.bottom
  );
}

function thingSprite(mesh: SceneMesh, thing: Thing, ownerId: string | null) {
  const owner = ownerId ? mesh.sectors.get(ownerId) : undefined;
  const picture = thingPicture(mesh.assets, thing, mesh.customSprites);
  if (!picture || !owner) return new Float32Array();
  const out: number[] = [];
  pushSprite(
    out,
    thing,
    picture.picture,
    slotOf(mesh, picture.key, picture.picture),
    spriteBase(owner, thing.kind),
    idOf(mesh, surfaceKey({ kind: "thing", thing: thing.id })),
    owner.light,
  );
  return Float32Array.from(out);
}

function idOf(mesh: SceneMesh, key: string) {
  let id = mesh.ids.get(key);
  if (id === undefined) {
    id = mesh.surfaces.length;
    mesh.surfaces.push(key);
    mesh.ids.set(key, id);
  }
  return id;
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
