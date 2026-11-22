import type { Complevel, GameMap } from "@/lib/map/types";
import type { CheckContext } from "@/lib/map/validate";

import { defined } from "@/lib/defined";
import {
  defaultGame,
  type GameInfo,
  slotCount as gameSlots,
} from "@/lib/engine/game";
import { type CloudLink, parseCloudLink } from "@/lib/episodes/cloud";
import { checkMap } from "@/lib/map/checks";
import { addRoomOnSide, type RoomSide } from "@/lib/map/edit";
import { featuredMaps } from "@/lib/map/featured";
import { blankMap, starterMap } from "@/lib/map/starter-map";
import { loadSavedMap, MapFileError, parseMap } from "@/lib/map/storage";
import { compileLumps } from "@/lib/wad/compile";

export interface Episode {
  id: string;
  name: string;
  createdAt: number;
}

// Music, sky and intermission text are the game's own unless set; they travel
// in the episode's UMAPINFO lump.
export interface EpisodeMap {
  id: string;
  episodeId: string;
  slot: string;
  description: string;
  par: number | null;
  music?: string;
  sky?: string;
  intertext?: string;
  editedAt: number;
  mapRevision: number;
  map: GameMap;
  broken?: boolean;
  cloud?: CloudLink;
}

export type LevelDetails = Partial<
  Pick<EpisodeMap, "description" | "par" | "music" | "sky" | "intertext">
>;

export type MapTemplate = "blank" | "room" | "hub";

export type EpisodeStart = "empty" | "one" | "featured" | "freedoom";

export interface SlotMove {
  id: string;
  slot: string;
}

export interface EpisodeStore {
  durable: boolean;
  listEpisodes(): Promise<Episode[]>;
  listMaps(episodeId: string): Promise<EpisodeMap[]>;
  getMap(id: string): Promise<EpisodeMap | null>;
  putEpisode(episode: Episode): Promise<void>;
  addEpisode(episode: Episode, maps: EpisodeMap[]): Promise<void>;
  putMap(entry: EpisodeMap): Promise<void>;
  countMaps(episodeId: string): Promise<number>;
  moveMaps(moves: SlotMove[]): Promise<void>;
  updateMap(
    id: string,
    change: (entry: EpisodeMap) => EpisodeMap,
  ): Promise<EpisodeMap | null>;
  deleteEpisode(id: string): Promise<void>;
  deleteMap(id: string): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
}

const backupFormat = "wadsmith-project";
const backupVersion = 1;
export const maxBackupBytes = 64 * 1024 * 1024;
export const maxNameLength = 80;
export const maxDescriptionLength = 160;
export const maxIntertextLength = 2000;
// Longer than any par the dialog accepts, and still a plain number in a lump.
const maxPar = 99_999;

// Doom II has 32 map slots; Ultimate Doom's four episodes hold 36.
const maxSlots = 36;
const firstEpisodeId = "first-project";
const firstMapId = "first-map";
export const lastMapKey = "lastMap";
export const lastEpisodeKey = "lastProject";
const firstEpisodeName = "Episode 1";
const oldFirstNames = new Set(["My project", "My episode"]);
const hubSides: RoomSide[] = ["north", "east", "south", "west"];

export const mapSlots = Array.from(
  { length: maxSlots },
  (_, index) => `MAP${String(index + 1).padStart(2, "0")}`,
);

export const templates: { value: MapTemplate; label: string; map: GameMap }[] =
  [
    {
      value: "blank",
      label: "Blank",
      map: { vertices: {}, sectors: [], things: [], switches: [] },
    },
    { value: "room", label: "Starter room", map: blankMap },
    { value: "hub", label: "Hub and spokes", map: hubMap() },
  ];

// Each game has only as many slots as its maps or episodes hold.
export function freeSlots(
  maps: EpisodeMap[],
  keep?: string,
  game: GameInfo = defaultGame,
) {
  const used = new Set(maps.map((entry) => entry.slot));
  return mapSlots
    .slice(0, gameSlots(game))
    .filter((slot) => slot === keep || !used.has(slot));
}

export function bySlot(maps: EpisodeMap[]) {
  return maps.toSorted((a, b) => a.slot.localeCompare(b.slot));
}

export function mapName({ map }: EpisodeMap) {
  return map.name ?? "Untitled map";
}

export function buildMap(map: GameMap) {
  try {
    return { problem: null, lumps: compileLumps(map) };
  } catch (error) {
    return { problem: (error as Error).message, lumps: null };
  }
}

export function buildProblem(map: GameMap) {
  return buildMap(map).problem;
}

// A problem of undefined means the build hasn't been checked yet.
export function mapStatus(
  entry: EpisodeMap,
  problem?: string | null,
  context?: CheckContext,
) {
  if (entry.broken) return { kind: "error" as const, label: "Can't open" };
  const checks = checksOf(entry, context);
  const errors = checks.filter((issue) => issue.severity === "error").length;
  const warnings = checks.length - errors;
  if (errors > 0) {
    return {
      kind: "error" as const,
      label: `${errors} ${errors === 1 ? "error" : "errors"}`,
    };
  }
  if (problem) {
    return { kind: "error" as const, label: "Won't build", detail: problem };
  }
  if (problem === undefined) {
    return { kind: "checking" as const, label: "Checking" };
  }
  if (warnings === 1 && checks[0].id === "no-exit") {
    return { kind: "warning" as const, label: "No exit yet" };
  }
  if (warnings > 0) {
    return {
      kind: "warning" as const,
      label: `${warnings} ${warnings === 1 ? "warning" : "warnings"}`,
    };
  }
  return { kind: "ready" as const, label: "Playable" };
}

export function createEpisode(name: string): Episode {
  return { id: newEpisodeId(), name, createdAt: Date.now() };
}

// Vanilla is the default, so a map set to it carries no level at all.
export function withComplevel(map: GameMap, complevel: Complevel): GameMap {
  const next: GameMap = { ...map, complevel };
  if (complevel === "vanilla") delete next.complevel;
  return next;
}

// Unset details stay off the entry, so a saved map carries only what it set.
export function levelDetails(details: LevelDetails) {
  return {
    description: details.description ?? "",
    par: details.par ?? null,
    ...(details.music ? { music: details.music } : {}),
    ...(details.sky ? { sky: details.sky } : {}),
    ...(details.intertext ? { intertext: details.intertext } : {}),
  };
}

export function createMapEntry(
  episodeId: string,
  slot: string,
  map: GameMap,
  details: LevelDetails = {},
): EpisodeMap {
  return {
    id: newId(),
    episodeId,
    slot,
    ...levelDetails(details),
    editedAt: Date.now(),
    mapRevision: 0,
    map,
  };
}

// The episode keeps the slots it uses, and the maps take them in the new order.
export function slotMoves(maps: EpisodeMap[], order: string[]): SlotMove[] {
  const slots = bySlot(maps).map((entry) => entry.slot);
  return order
    .map((id, index) => ({ id, slot: slots[index] }))
    .filter(
      ({ id, slot }) => maps.find((entry) => entry.id === id)?.slot !== slot,
    );
}

export function episodeMaps(
  episodeId: string,
  start: Exclude<EpisodeStart, "freedoom">,
) {
  if (start === "empty") return [];
  if (start === "one") {
    return [
      createMapEntry(episodeId, mapSlots[0], mapFromTemplate("room", "Map 1")),
    ];
  }
  return featuredMaps.map((featured, index) =>
    createMapEntry(episodeId, mapSlots[index], structuredClone(featured.map), {
      description: featured.blurb,
      par: featured.par,
    }),
  );
}

export function getIsSlotConflict(error: unknown) {
  return (error as Error | null)?.name === "ConstraintError";
}

export function mapFromTemplate(template: MapTemplate, name: string): GameMap {
  const { map } = defined(templates.find((item) => item.value === template));
  return { ...structuredClone(map), name };
}

export function parseStoredMap(value: EpisodeMap): EpisodeMap {
  try {
    return {
      ...value,
      map: parseMap(value.map),
      broken: undefined,
      cloud: parseCloudLink(value.cloud),
    };
  } catch {
    return {
      ...value,
      broken: true,
      map: { vertices: {}, sectors: [], things: [], switches: [] },
    };
  }
}

// Fixed ids let tabs opened together create the same first episode. The old
// single-map save stays in place as a backup after it is copied.
export async function prepareEpisodes(store: EpisodeStore) {
  const listed = await store.listEpisodes();
  // Browsers from before the fixed id gave the first episode a random one.
  const episodes = await Promise.all(
    listed.map(async (episode, index) => {
      if (index > 0 || !oldFirstNames.has(episode.name)) return episode;
      const renamed = { ...episode, name: firstEpisodeName };
      await store.putEpisode(renamed);
      return renamed;
    }),
  );
  if (episodes.length === 0) {
    const saved = loadSavedMap();
    const episode = {
      ...createEpisode(firstEpisodeName),
      id: firstEpisodeId,
    };
    const entry = {
      ...createMapEntry(episode.id, mapSlots[0], saved ?? starterMap),
      id: firstMapId,
    };
    await store.addEpisode(episode, [entry]);
    await store.setSetting(lastEpisodeKey, episode.id);
    await store.setSetting(lastMapKey, entry.id);
    return { episodes: [episode], episodeId: episode.id, entry, created: true };
  }
  const lastEpisode = await store.getSetting(lastEpisodeKey);
  const lastMap = await store.getSetting(lastMapKey);
  const candidate = lastMap ? await store.getMap(lastMap) : null;
  const entry = candidate && !candidate.broken ? candidate : null;
  const episodeId =
    entry?.episodeId ??
    episodes.find((episode) => episode.id === lastEpisode)?.id ??
    episodes[0].id;
  return { episodes, episodeId, entry, created: false };
}

export function createMapSaver(
  store: EpisodeStore,
  initial: EpisodeMap,
  {
    onStatus,
    onSaved = () => {},
    onMissing = () => {},
  }: {
    onStatus: (status: "saving" | "saved" | "failed") => void;
    onSaved?: (entry: EpisodeMap) => void;
    onMissing?: () => void;
  },
) {
  let latest = initial.map;
  let revision = initial.mapRevision;
  let failed = false;
  let pending = 0;
  let queue: Promise<unknown> = Promise.resolve();

  // Each edit starts its transaction at once, so a closing tab still commits it.
  const write = (map: GameMap) => {
    pending += 1;
    onStatus("saving");
    const saving = store
      .updateMap(initial.id, (entry) => ({
        ...entry,
        map: { ...map, name: entry.map.name },
        mapRevision: entry.mapRevision + 1,
        editedAt: Date.now(),
        // An edit the online copy doesn't have yet, even if the tab closes
        // before it is sent.
        ...(entry.cloud && { cloud: { ...entry.cloud, pending: true } }),
      }))
      .then((saved) => {
        if (!saved) {
          onMissing();
          return;
        }
        revision = Math.max(revision, saved.mapRevision);
        if (map === latest) failed = false;
        onSaved(saved);
      })
      .catch(() => {
        failed = true;
      })
      .finally(() => {
        pending -= 1;
        if (pending === 0) onStatus(failed ? "failed" : "saved");
      });
    queue = Promise.all([queue, saving]);
  };

  return {
    get id() {
      return initial.id;
    },
    get map() {
      return latest;
    },
    get busy() {
      return pending > 0;
    },
    get failed() {
      return failed;
    },
    get revision() {
      return revision;
    },
    saveMap(map: GameMap) {
      latest = map;
      write(map);
    },
    adopt(entry: EpisodeMap) {
      latest = entry.map;
      revision = entry.mapRevision;
      failed = false;
    },
    flush: async () => {
      await queue;
      if (failed) {
        write(latest);
        await queue;
      }
      return !failed;
    },
  };
}

export function serializeEpisode(episode: Episode, maps: EpisodeMap[]) {
  return JSON.stringify({
    format: backupFormat,
    version: backupVersion,
    project: { name: episode.name },
    maps: bySlot(maps)
      .filter((entry) => !entry.broken)
      .map(({ slot, description, par, music, sky, intertext, map }) => ({
        slot,
        description,
        par,
        ...(music ? { music } : {}),
        ...(sky ? { sky } : {}),
        ...(intertext ? { intertext } : {}),
        map,
      })),
  });
}

export function parseEpisodeBackup(text: string) {
  if (text.length > maxBackupBytes) {
    throw new MapFileError("The file is too large.");
  }
  let data: {
    format?: unknown;
    version?: unknown;
    project?: { name?: unknown };
    maps?: unknown;
  };
  try {
    data = JSON.parse(text);
  } catch {
    throw new MapFileError("The file isn't valid JSON.");
  }
  if (data?.format !== backupFormat) {
    throw new MapFileError("This isn't a Wadsmith episode backup.");
  }
  if (data.version !== backupVersion || !Array.isArray(data.maps)) {
    throw new MapFileError("This episode was saved by a different version.");
  }
  const episode = createEpisode(
    typeof data.project?.name === "string" && data.project.name.trim()
      ? data.project.name.trim().slice(0, maxNameLength)
      : "Imported episode",
  );
  const used = new Set<string>();
  const maps = data.maps.map((value: Record<string, unknown>) => {
    const slot = String(value?.slot);
    if (!mapSlots.includes(slot) || used.has(slot)) {
      throw new MapFileError("The episode has an invalid map slot.");
    }
    used.add(slot);
    const par =
      Number.isInteger(value.par) &&
      (value.par as number) > 0 &&
      (value.par as number) <= maxPar
        ? (value.par as number)
        : null;
    return createMapEntry(episode.id, slot, parseMap(value.map), {
      par,
      description:
        typeof value.description === "string"
          ? value.description.slice(0, maxDescriptionLength)
          : "",
      music: lumpField(value.music),
      sky: lumpField(value.sky),
      intertext:
        typeof value.intertext === "string"
          ? value.intertext.trim().slice(0, maxIntertextLength) || undefined
          : undefined,
    });
  });
  return { episode, maps };
}

export function formatPar(par: number | null) {
  if (par === null) return "";
  return `${Math.floor(par / 60)}:${String(par % 60).padStart(2, "0")}`;
}

export function parsePar(text: string) {
  const value = text.trim();
  if (!value) return null;
  const match = /^(?:(\d{1,3}):)?(\d{1,4})$/.exec(value);
  if (!match) return undefined;
  const seconds = Number(match[2]);
  if (match[1] && seconds > 59) return undefined;
  const total = Number(match[1] ?? 0) * 60 + seconds;
  return total > 0 ? total : undefined;
}

function hubMap() {
  return hubSides.reduce((map, side) => {
    const center = map.sectors[0];
    return (
      addRoomOnSide(map, center.id, side, 192, {
        floor: center.floor,
        ceiling: center.ceiling,
        light: center.light,
      })?.map ?? map
    );
  }, blankMap);
}

interface CheckedMap {
  revision: number;
  game: string;
  names: CheckContext["names"];
  checks: ReturnType<typeof checkMap>;
}

const checked = new Map<string, CheckedMap>();

// Every edit to a saved map bumps its revision, and new maps get new ids. A
// change of game or of its textures checks every map again.
function checksOf(entry: EpisodeMap, context?: CheckContext) {
  const game = context?.game?.id ?? "";
  const names = context?.names;
  const known = checked.get(entry.id);
  if (
    known?.revision === entry.mapRevision &&
    known.game === game &&
    known.names === names
  ) {
    return known.checks;
  }
  const checks = checkMap(entry.map, context);
  checked.set(entry.id, { revision: entry.mapRevision, game, names, checks });
  return checks;
}

function newEpisodeId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
}

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

const lumpName = /^[A-Z0-9_\-\\[\]]{1,8}$/;

function lumpField(field: unknown) {
  if (field === undefined) return undefined;
  if (typeof field !== "string" || !lumpName.test(field)) {
    throw new MapFileError("The episode names a lump that can't exist.");
  }
  return field;
}
