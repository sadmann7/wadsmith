import {
  parseStoredMap,
  type Episode,
  type EpisodeMap,
  type EpisodeStore,
} from "./episode-data";

const databaseName = "wadsmith";
const databaseVersion = 2;

export interface StoredFile {
  key: string;
  name: string;
  data: Uint8Array;
}

type SavedMap = Omit<EpisodeMap, "episodeId"> & { projectId: string };

// Saved maps keep the field name from before episodes, so browsers that
// already hold maps still find them.
function saved({ episodeId, ...entry }: EpisodeMap): SavedMap {
  return { ...entry, projectId: episodeId };
}

function loaded({ projectId, ...entry }: SavedMap): EpisodeMap {
  return { ...entry, episodeId: projectId };
}

function requested<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function finished(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}

// Version 2 added the files store, which holds the game IWAD a person brings.
function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("projects")) {
        database.createObjectStore("projects", { keyPath: "id" });
        database
          .createObjectStore("maps", { keyPath: "id" })
          .createIndex("projectId", "projectId");
        request.transaction
          ?.objectStore("maps")
          .createIndex("slot", ["projectId", "slot"], { unique: true });
        database.createObjectStore("settings", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("files")) {
        database.createObjectStore("files", { keyPath: "key" });
      }
    });
    request.addEventListener("success", () => {
      const database = request.result;
      database.addEventListener("versionchange", () => database.close());
      resolve(database);
    });
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("blocked", () =>
      reject(new Error("The database is in use.")),
    );
  });
}

// Files open their own short connection, so the engine can read the IWAD
// without the episode store.
async function withFiles<T>(
  mode: IDBTransactionMode,
  run: (files: IDBObjectStore) => IDBRequest,
) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["files"], mode);
    const result = (await requested(
      run(transaction.objectStore("files")),
    )) as T;
    await finished(transaction);
    return result;
  } finally {
    database.close();
  }
}

export async function readStoredFile(key: string): Promise<StoredFile | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    return (
      (await withFiles<StoredFile | undefined>("readonly", (files) =>
        files.get(key),
      )) ?? null
    );
  } catch {
    return null;
  }
}

export async function writeStoredFile(key: string, file: StoredFile | null) {
  await withFiles<unknown>("readwrite", (files) =>
    file ? files.put({ ...file, key }) : files.delete(key),
  );
}

export async function openEpisodeStore(): Promise<EpisodeStore> {
  let database: IDBDatabase | null = null;

  const connect = async () => {
    const opened = await openDatabase();
    opened.addEventListener("close", () => {
      if (database === opened) database = null;
    });
    opened.addEventListener("versionchange", () => {
      if (database === opened) database = null;
    });
    database = opened;
    return opened;
  };

  await connect();
  void navigator.storage?.persist?.().catch(() => false);

  // Starting without a wait when connected keeps overlapping saves in order.
  const begin = async (stores: string[], mode: IDBTransactionMode) => {
    const active = database ?? (await connect());
    try {
      return active.transaction(stores, mode);
    } catch (error) {
      if ((error as Error).name !== "InvalidStateError") throw error;
      database = null;
      return (await connect()).transaction(stores, mode);
    }
  };

  const write = async (
    stores: string[],
    run: (transaction: IDBTransaction) => void,
  ) => {
    const transaction = await begin(stores, "readwrite");
    run(transaction);
    await finished(transaction);
  };

  const read = async <T>(
    store: string,
    run: (items: IDBObjectStore) => IDBRequest<T>,
  ) => requested(run((await begin([store], "readonly")).objectStore(store)));

  return {
    durable: true,
    listEpisodes: async () =>
      (await read<Episode[]>("projects", (items) => items.getAll())).toSorted(
        (a, b) => a.createdAt - b.createdAt,
      ),
    listMaps: async (episodeId) =>
      (
        await read<SavedMap[]>("maps", (items) =>
          items.index("projectId").getAll(episodeId),
        )
      ).map((entry) => parseStoredMap(loaded(entry))),
    getMap: async (id) => {
      const entry = await read<SavedMap | undefined>("maps", (items) =>
        items.get(id),
      );
      return entry ? parseStoredMap(loaded(entry)) : null;
    },
    putEpisode: (episode) =>
      write(["projects"], (transaction) => {
        transaction.objectStore("projects").put(episode);
      }),
    addEpisode: (episode, maps) =>
      write(["projects", "maps"], (transaction) => {
        transaction.objectStore("projects").put(episode);
        const items = transaction.objectStore("maps");
        for (const entry of maps) items.put(saved(entry));
      }),
    putMap: (entry) =>
      write(["maps"], (transaction) => {
        transaction.objectStore("maps").put(saved(entry));
      }),
    countMaps: (episodeId) =>
      read<number>("maps", (items) =>
        items.index("projectId").count(episodeId),
      ),
    // Each map passes through a slot no map can hold, since the slot index is
    // unique and two maps may trade places.
    moveMaps: (moves) =>
      write(["maps"], (transaction) => {
        const items = transaction.objectStore("maps");
        const moved: SavedMap[] = [];
        let pending = moves.length;
        for (const move of moves) {
          const request = items.get(move.id) as IDBRequest<
            SavedMap | undefined
          >;
          request.addEventListener("success", () => {
            if (request.result)
              moved.push({ ...request.result, slot: move.slot });
            pending -= 1;
            if (pending > 0) return;
            for (const entry of moved) {
              items.put({ ...entry, slot: `~${entry.id}` });
            }
            for (const entry of moved) items.put(entry);
          });
        }
      }),
    updateMap: async (id, change) => {
      let updated: EpisodeMap | null = null;
      await write(["maps"], (transaction) => {
        const items = transaction.objectStore("maps");
        const request = items.get(id) as IDBRequest<SavedMap | undefined>;
        request.addEventListener("success", () => {
          if (!request.result) return;
          updated = change(loaded(request.result));
          items.put(saved(updated));
        });
      });
      return updated;
    },
    deleteEpisode: async (id) => {
      const keys = await read<IDBValidKey[]>("maps", (items) =>
        items.index("projectId").getAllKeys(id),
      );
      await write(["projects", "maps"], (transaction) => {
        transaction.objectStore("projects").delete(id);
        const maps = transaction.objectStore("maps");
        for (const key of keys) maps.delete(key);
      });
    },
    deleteMap: (id) =>
      write(["maps"], (transaction) => {
        transaction.objectStore("maps").delete(id);
      }),
    getSetting: async (key) =>
      (
        await read<{ value: string } | undefined>("settings", (items) =>
          items.get(key),
        )
      )?.value ?? null,
    setSetting: (key, value) =>
      write(["settings"], (transaction) => {
        const settings = transaction.objectStore("settings");
        if (value === null) settings.delete(key);
        else settings.put({ key, value });
      }),
  };
}

export function createMemoryStore(): EpisodeStore {
  const episodes = new Map<string, Episode>();
  const maps = new Map<string, EpisodeMap>();
  const settings = new Map<string, string>();
  const store = (entry: EpisodeMap) => {
    for (const other of maps.values()) {
      if (
        other.id !== entry.id &&
        other.episodeId === entry.episodeId &&
        other.slot === entry.slot
      ) {
        throw new DOMException("That slot is taken.", "ConstraintError");
      }
    }
    maps.set(entry.id, structuredClone(entry));
  };
  return {
    durable: false,
    listEpisodes: async () =>
      [...episodes.values()].toSorted((a, b) => a.createdAt - b.createdAt),
    listMaps: async (episodeId) =>
      [...maps.values()]
        .filter((entry) => entry.episodeId === episodeId)
        .map((entry) => parseStoredMap(structuredClone(entry))),
    getMap: async (id) => {
      const entry = maps.get(id);
      return entry ? parseStoredMap(structuredClone(entry)) : null;
    },
    putEpisode: async (episode) => {
      episodes.set(episode.id, episode);
    },
    addEpisode: async (episode, entries) => {
      episodes.set(episode.id, episode);
      entries.forEach(store);
    },
    putMap: async (entry) => store(entry),
    countMaps: async (episodeId) =>
      [...maps.values()].filter((entry) => entry.episodeId === episodeId)
        .length,
    moveMaps: async (moves) => {
      const moved = moves.flatMap(({ id, slot }) => {
        const entry = maps.get(id);
        return entry ? [{ ...entry, slot }] : [];
      });
      for (const entry of moved) maps.set(entry.id, { ...entry, slot: "" });
      moved.forEach(store);
    },
    updateMap: async (id, change) => {
      const entry = maps.get(id);
      if (!entry) return null;
      const updated = change(structuredClone(entry));
      store(updated);
      return structuredClone(updated);
    },
    deleteEpisode: async (id) => {
      episodes.delete(id);
      for (const entry of maps.values()) {
        if (entry.episodeId === id) maps.delete(entry.id);
      }
    },
    deleteMap: async (id) => {
      maps.delete(id);
    },
    getSetting: async (key) => settings.get(key) ?? null,
    setSetting: async (key, value) => {
      if (value === null) settings.delete(key);
      else settings.set(key, value);
    },
  };
}
