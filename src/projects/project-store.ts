import {
  parseStoredMap,
  type Project,
  type ProjectMap,
  type ProjectStore,
} from "./project-data";

const databaseName = "wadsmith";
const databaseVersion = 1;

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

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      database.createObjectStore("projects", { keyPath: "id" });
      database
        .createObjectStore("maps", { keyPath: "id" })
        .createIndex("projectId", "projectId");
      request.transaction
        ?.objectStore("maps")
        .createIndex("slot", ["projectId", "slot"], { unique: true });
      database.createObjectStore("settings", { keyPath: "key" });
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

async function openProjectStore(): Promise<ProjectStore> {
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
    listProjects: async () =>
      (await read<Project[]>("projects", (items) => items.getAll())).toSorted(
        (a, b) => a.createdAt - b.createdAt,
      ),
    listMaps: async (projectId) =>
      (
        await read<ProjectMap[]>("maps", (items) =>
          items.index("projectId").getAll(projectId),
        )
      ).map(parseStoredMap),
    getMap: async (id) => {
      const entry = await read<ProjectMap | undefined>("maps", (items) =>
        items.get(id),
      );
      return entry ? parseStoredMap(entry) : null;
    },
    putProject: (project) =>
      write(["projects"], (transaction) => {
        transaction.objectStore("projects").put(project);
      }),
    addProject: (project, maps) =>
      write(["projects", "maps"], (transaction) => {
        transaction.objectStore("projects").put(project);
        const items = transaction.objectStore("maps");
        for (const entry of maps) items.put(entry);
      }),
    putMap: (entry) =>
      write(["maps"], (transaction) => {
        transaction.objectStore("maps").put(entry);
      }),
    countMaps: (projectId) =>
      read<number>("maps", (items) =>
        items.index("projectId").count(projectId),
      ),
    // Each map passes through a slot no map can hold, since the slot index is
    // unique and two maps may trade places.
    moveMaps: (moves) =>
      write(["maps"], (transaction) => {
        const items = transaction.objectStore("maps");
        const moved: ProjectMap[] = [];
        let pending = moves.length;
        for (const move of moves) {
          const request = items.get(move.id) as IDBRequest<
            ProjectMap | undefined
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
      let updated: ProjectMap | null = null;
      await write(["maps"], (transaction) => {
        const items = transaction.objectStore("maps");
        const request = items.get(id) as IDBRequest<ProjectMap | undefined>;
        request.addEventListener("success", () => {
          if (!request.result) return;
          updated = change(request.result);
          items.put(updated);
        });
      });
      return updated;
    },
    deleteProject: async (id) => {
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

function createMemoryStore(): ProjectStore {
  const projects = new Map<string, Project>();
  const maps = new Map<string, ProjectMap>();
  const settings = new Map<string, string>();
  const store = (entry: ProjectMap) => {
    for (const other of maps.values()) {
      if (
        other.id !== entry.id &&
        other.projectId === entry.projectId &&
        other.slot === entry.slot
      ) {
        throw new DOMException("That slot is taken.", "ConstraintError");
      }
    }
    maps.set(entry.id, structuredClone(entry));
  };
  return {
    durable: false,
    listProjects: async () =>
      [...projects.values()].toSorted((a, b) => a.createdAt - b.createdAt),
    listMaps: async (projectId) =>
      [...maps.values()]
        .filter((entry) => entry.projectId === projectId)
        .map((entry) => parseStoredMap(structuredClone(entry))),
    getMap: async (id) => {
      const entry = maps.get(id);
      return entry ? parseStoredMap(structuredClone(entry)) : null;
    },
    putProject: async (project) => {
      projects.set(project.id, project);
    },
    addProject: async (project, entries) => {
      projects.set(project.id, project);
      entries.forEach(store);
    },
    putMap: async (entry) => store(entry),
    countMaps: async (projectId) =>
      [...maps.values()].filter((entry) => entry.projectId === projectId)
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
    deleteProject: async (id) => {
      projects.delete(id);
      for (const entry of maps.values()) {
        if (entry.projectId === id) maps.delete(entry.id);
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

export { createMemoryStore, openProjectStore };
