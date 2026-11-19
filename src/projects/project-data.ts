import { addRoomOnSide, type RoomSide } from "../map/edit";
import { checkMap } from "../map/checks";
import { blankMap, starterMap } from "../map/starter-map";
import { loadSavedMap, MapFileError, parseMap } from "../map/storage";
import type { GameMap } from "../map/types";
import { featuredMaps } from "../map/featured";

type Project = { id: string; name: string; createdAt: number };

type ProjectMap = {
  id: string;
  projectId: string;
  slot: string;
  description: string;
  par: number | null;
  editedAt: number;
  mapRevision: number;
  map: GameMap;
  broken?: boolean;
};

type MapTemplate = "blank" | "room" | "hub";

type EpisodeStart = "empty" | "one" | "featured";

type SlotMove = { id: string; slot: string };

type ProjectStore = {
  durable: boolean;
  listProjects(): Promise<Project[]>;
  listMaps(projectId: string): Promise<ProjectMap[]>;
  getMap(id: string): Promise<ProjectMap | null>;
  putProject(project: Project): Promise<void>;
  addProject(project: Project, maps: ProjectMap[]): Promise<void>;
  putMap(entry: ProjectMap): Promise<void>;
  countMaps(projectId: string): Promise<number>;
  moveMaps(moves: SlotMove[]): Promise<void>;
  updateMap(
    id: string,
    change: (entry: ProjectMap) => ProjectMap,
  ): Promise<ProjectMap | null>;
  deleteProject(id: string): Promise<void>;
  deleteMap(id: string): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
};

const backupFormat = "wadsmith-project";
const backupVersion = 1;
const maxBackupBytes = 64 * 1024 * 1024;
const maxNameLength = 80;
const maxDescriptionLength = 160;
const slotCount = 32;
const firstProjectId = "first-project";
const firstMapId = "first-map";
const lastMapKey = "lastMap";
const lastProjectKey = "lastProject";
const firstEpisodeName = "Episode 1";
const oldFirstNames = new Set(["My project", "My episode"]);
const hubSides: RoomSide[] = ["north", "east", "south", "west"];

const mapSlots = Array.from(
  { length: slotCount },
  (_, index) => `MAP${String(index + 1).padStart(2, "0")}`,
);

const templates: { value: MapTemplate; label: string; map: GameMap }[] = [
  {
    value: "blank",
    label: "Blank",
    map: { vertices: {}, sectors: [], things: [], switches: [] },
  },
  { value: "room", label: "Starter room", map: blankMap },
  { value: "hub", label: "Hub and spokes", map: hubMap() },
];

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

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function freeSlots(maps: ProjectMap[], keep?: string) {
  const used = new Set(maps.map((entry) => entry.slot));
  return mapSlots.filter((slot) => slot === keep || !used.has(slot));
}

function bySlot(maps: ProjectMap[]) {
  return maps.toSorted((a, b) => a.slot.localeCompare(b.slot));
}

function mapName({ map }: ProjectMap) {
  return map.name ?? "Untitled map";
}

function mapStatus(entry: ProjectMap) {
  if (entry.broken) return { kind: "error" as const, label: "Can't open" };
  const checks = checkMap(entry.map);
  const errors = checks.filter((issue) => issue.severity === "error").length;
  const warnings = checks.length - errors;
  if (warnings === 1 && checks[0].id === "no-exit") {
    return { kind: "warning" as const, label: "No exit yet" };
  }
  if (errors > 0) {
    return {
      kind: "error" as const,
      label: `${errors} ${errors === 1 ? "error" : "errors"}`,
    };
  }
  if (warnings > 0) {
    return {
      kind: "warning" as const,
      label: `${warnings} ${warnings === 1 ? "warning" : "warnings"}`,
    };
  }
  return { kind: "ready" as const, label: "Playable" };
}

function createProject(name: string): Project {
  return { id: newId(), name, createdAt: Date.now() };
}

function createMapEntry(
  projectId: string,
  slot: string,
  map: GameMap,
  details: Partial<Pick<ProjectMap, "description" | "par">> = {},
): ProjectMap {
  return {
    id: newId(),
    projectId,
    slot,
    description: details.description ?? "",
    par: details.par ?? null,
    editedAt: Date.now(),
    mapRevision: 0,
    map,
  };
}

// The episode keeps the slots it uses, and the maps take them in the new order.
function slotMoves(maps: ProjectMap[], order: string[]): SlotMove[] {
  const slots = bySlot(maps).map((entry) => entry.slot);
  return order
    .map((id, index) => ({ id, slot: slots[index] }))
    .filter(
      ({ id, slot }) => maps.find((entry) => entry.id === id)?.slot !== slot,
    );
}

function episodeMaps(projectId: string, start: EpisodeStart) {
  if (start === "empty") return [];
  if (start === "one") {
    return [
      createMapEntry(projectId, mapSlots[0], mapFromTemplate("room", "Map 1")),
    ];
  }
  return featuredMaps.map((featured, index) =>
    createMapEntry(projectId, mapSlots[index], structuredClone(featured.map), {
      description: featured.blurb,
      par: featured.par,
    }),
  );
}

function isSlotConflict(error: unknown) {
  return (error as Error | null)?.name === "ConstraintError";
}

function mapFromTemplate(template: MapTemplate, name: string): GameMap {
  const { map } = templates.find((item) => item.value === template)!;
  return { ...structuredClone(map), name };
}

function parseStoredMap(value: ProjectMap): ProjectMap {
  try {
    return { ...value, map: parseMap(value.map), broken: undefined };
  } catch {
    return {
      ...value,
      broken: true,
      map: { vertices: {}, sectors: [], things: [], switches: [] },
    };
  }
}

// Fixed ids let tabs opened together create the same first project. The old
// single-map save stays in place as a backup after it is copied.
async function prepareProjects(store: ProjectStore) {
  const listed = await store.listProjects();
  const projects = await Promise.all(
    listed.map(async (project) => {
      if (project.id !== firstProjectId || !oldFirstNames.has(project.name)) {
        return project;
      }
      const renamed = { ...project, name: firstEpisodeName };
      await store.putProject(renamed);
      return renamed;
    }),
  );
  if (projects.length === 0) {
    const saved = loadSavedMap();
    const project = {
      ...createProject(firstEpisodeName),
      id: firstProjectId,
    };
    const entry = {
      ...createMapEntry(project.id, mapSlots[0], saved ?? starterMap),
      id: firstMapId,
    };
    await store.addProject(project, [entry]);
    await store.setSetting(lastProjectKey, project.id);
    await store.setSetting(lastMapKey, entry.id);
    return { projects: [project], projectId: project.id, entry, created: true };
  }
  const lastProject = await store.getSetting(lastProjectKey);
  const lastMap = await store.getSetting(lastMapKey);
  const candidate = lastMap ? await store.getMap(lastMap) : null;
  const entry = candidate && !candidate.broken ? candidate : null;
  const projectId =
    entry?.projectId ??
    projects.find((project) => project.id === lastProject)?.id ??
    projects[0].id;
  return { projects, projectId, entry, created: false };
}

function createMapSaver(
  store: ProjectStore,
  initial: ProjectMap,
  {
    onStatus,
    onSaved = () => {},
    onMissing = () => {},
  }: {
    onStatus: (status: "saving" | "saved" | "failed") => void;
    onSaved?: (entry: ProjectMap) => void;
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
    adopt(entry: ProjectMap) {
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

function serializeProject(project: Project, maps: ProjectMap[]) {
  return JSON.stringify({
    format: backupFormat,
    version: backupVersion,
    project: { name: project.name },
    maps: bySlot(maps)
      .filter((entry) => !entry.broken)
      .map(({ slot, description, par, map }) => ({
        slot,
        description,
        par,
        map,
      })),
  });
}

function parseProjectBackup(text: string) {
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
  const project = createProject(
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
      Number.isInteger(value.par) && (value.par as number) > 0
        ? (value.par as number)
        : null;
    return createMapEntry(project.id, slot, parseMap(value.map), {
      par,
      description:
        typeof value.description === "string"
          ? value.description.slice(0, maxDescriptionLength)
          : "",
    });
  });
  return { project, maps };
}

function formatPar(par: number | null) {
  if (par === null) return "";
  return `${Math.floor(par / 60)}:${String(par % 60).padStart(2, "0")}`;
}

function parsePar(text: string) {
  const value = text.trim();
  if (!value) return null;
  const match = /^(?:(\d{1,3}):)?(\d{1,4})$/.exec(value);
  if (!match) return undefined;
  const seconds = Number(match[2]);
  if (match[1] && seconds > 59) return undefined;
  const total = Number(match[1] ?? 0) * 60 + seconds;
  return total > 0 ? total : undefined;
}

export {
  bySlot,
  createMapEntry,
  createMapSaver,
  createProject,
  episodeMaps,
  formatPar,
  freeSlots,
  isSlotConflict,
  lastMapKey,
  lastProjectKey,
  mapFromTemplate,
  mapName,
  mapSlots,
  mapStatus,
  maxBackupBytes,
  maxDescriptionLength,
  maxNameLength,
  parsePar,
  parseProjectBackup,
  parseStoredMap,
  prepareProjects,
  serializeProject,
  slotMoves,
  templates,
  type EpisodeStart,
  type MapTemplate,
  type Project,
  type ProjectMap,
  type ProjectStore,
  type SlotMove,
};
