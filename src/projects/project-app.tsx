"use client";

import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@ui-sdk/react/alert-dialog";
import { useCallback, useEffect, useRef, useState } from "react";

import { wadFileName } from "../editor/build-dialog";
import { App } from "../editor/editor-app";
import { checkMap } from "../map/checks";
import {
  MapFileError,
  maxFileBytes,
  parseMapFile,
  serializeMap,
} from "../map/storage";
import type { GameMap } from "../map/types";
import { compileEpisode } from "../wad/compile";
import {
  dialogClass,
  MapDialog,
  titleClass,
  type MapDetails,
} from "./map-dialog";
import {
  bySlot,
  createMapEntry,
  createMapSaver,
  createProject,
  freeSlots,
  isSlotConflict,
  lastMapKey,
  lastProjectKey,
  mapFromTemplate,
  mapName,
  mapSlots,
  maxBackupBytes,
  parseProjectBackup,
  prepareProjects,
  serializeProject,
  type Project,
  type ProjectMap,
  type ProjectStore,
} from "./project-data";
import { ProjectHome } from "./project-home";
import { createMemoryStore, openProjectStore } from "./project-store";

type Session = {
  id: string;
  projectId: string;
  initialMap: GameMap;
  saver: ReturnType<typeof createMapSaver>;
};

type SessionDetails = { name: string; slot: string; par: number | null };
type SaveStatus = "saving" | "saved" | "failed";

const channelName = "wadsmith";
const saveFailure = "Your browser couldn't save that change.";

let preparing: ReturnType<typeof openPreparedStore> | null = null;

async function prepared(store: ProjectStore) {
  return { store, ready: await prepareProjects(store) };
}

async function openPreparedStore() {
  try {
    return await prepared(await openProjectStore());
  } catch {
    return prepared(createMemoryStore());
  }
}

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function detailsOf(entry: ProjectMap): SessionDetails {
  return { name: mapName(entry), slot: entry.slot, par: entry.par };
}

function problemOf(error: unknown, slot: string) {
  return isSlotConflict(error) ? `${slot} is already in use.` : saveFailure;
}

function ProjectApp() {
  const [store, setStore] = useState<ProjectStore | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [maps, setMaps] = useState<ProjectMap[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [details, setDetails] = useState<SessionDetails | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const [mapDialog, setMapDialog] = useState<"new" | "settings" | null>(null);
  const [blockedLeave, setBlockedLeave] = useState<(() => void) | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const projectIdRef = useRef("");
  const refreshRun = useRef(0);
  const externalListeners = useRef(new Set<(map: GameMap) => void>());

  const announce = useCallback((mapId?: string) => {
    channel.current?.postMessage({ mapId });
  }, []);

  const selectProject = useCallback((id: string) => {
    projectIdRef.current = id;
    setProjectId(id);
  }, []);

  const refresh = useCallback(
    async (active: ProjectStore, id: string) => {
      refreshRun.current += 1;
      const run = refreshRun.current;
      const nextProjects = await active.listProjects();
      const shown = nextProjects.some((item) => item.id === id)
        ? id
        : nextProjects[0]?.id;
      const nextMaps = shown ? await active.listMaps(shown) : [];
      if (run !== refreshRun.current) return;
      setProjects(nextProjects);
      setMaps(nextMaps);
      if (shown) selectProject(shown);
    },
    [selectProject],
  );

  const closeSession = useCallback(
    async (active: ProjectStore, note: string | null = null) => {
      const id = sessionRef.current?.projectId ?? projectIdRef.current;
      sessionRef.current = null;
      setMapDialog(null);
      setBlockedLeave(null);
      setMessage(note);
      await active.setSetting(lastMapKey, null).catch(() => {});
      await refresh(active, id).catch(() => setMessage(saveFailure));
      setSession(null);
      setDetails(null);
    },
    [refresh],
  );

  const startSession = useCallback(
    (active: ProjectStore, entry: ProjectMap) => {
      const saver = createMapSaver(active, entry, {
        onStatus: setSaveStatus,
        onSaved: (saved) => announce(saved.id),
        onMissing: () =>
          void closeSession(active, "This map was deleted in another tab."),
      });
      const next = {
        id: entry.id,
        projectId: entry.projectId,
        initialMap: entry.map,
        saver,
      };
      sessionRef.current = next;
      setSession(next);
      setDetails(detailsOf(entry));
      setSaveStatus("saved");
      selectProject(entry.projectId);
    },
    [announce, closeSession, selectProject],
  );

  useEffect(() => {
    let cancelled = false;
    preparing ??= openPreparedStore();
    preparing
      .then(async ({ store: opened, ready }) => {
        if (cancelled) return;
        setStore(opened);
        selectProject(ready.projectId);
        await refresh(opened, ready.projectId);
        if (!cancelled && ready.entry) startSession(opened, ready.entry);
      })
      .catch(() => {
        if (!cancelled) setMessage("Your projects couldn't be opened.");
      });
    return () => {
      cancelled = true;
    };
  }, [refresh, selectProject, startSession]);

  useEffect(() => {
    if (!store?.durable || typeof BroadcastChannel === "undefined") return;
    const opened = new BroadcastChannel(channelName);
    channel.current = opened;
    const onMessage = async ({ data }: MessageEvent<{ mapId?: string }>) => {
      const active = sessionRef.current;
      if (!active) {
        await refresh(store, projectIdRef.current);
        return;
      }
      if (data.mapId && data.mapId !== active.id) return;
      const entry = await store.getMap(active.id);
      if (sessionRef.current !== active) return;
      if (!entry) {
        await closeSession(store, "This map was deleted in another tab.");
        return;
      }
      if (entry.broken) return;
      setDetails(detailsOf(entry));
      if (
        entry.mapRevision > active.saver.revision &&
        !active.saver.busy &&
        !active.saver.failed
      ) {
        active.saver.adopt(entry);
        for (const listener of externalListeners.current) listener(entry.map);
      }
    };
    const listener = (event: MessageEvent<{ mapId?: string }>) =>
      void onMessage(event).catch(() => {});
    opened.addEventListener("message", listener);
    return () => {
      opened.close();
      channel.current = null;
    };
  }, [closeSession, refresh, store]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (sessionRef.current?.saver.failed) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const onSave = useCallback((map: GameMap) => {
    sessionRef.current?.saver.saveMap(map);
  }, []);

  const watchExternal = useCallback((listener: (map: GameMap) => void) => {
    externalListeners.current.add(listener);
    return () => {
      externalListeners.current.delete(listener);
    };
  }, []);

  if (!store || projects.length === 0) {
    return message ? (
      <p className="notice m-4" role="alert">
        {message}
      </p>
    ) : (
      <div className="editor-loading" role="status">
        Loading projects…
      </div>
    );
  }

  const project = projects.find((item) => item.id === projectId) ?? projects[0];

  const attempt = async (run: () => Promise<void>) => {
    try {
      await run();
      announce();
    } catch {
      setMessage(saveFailure);
    }
  };

  const whenSaved = async (next: () => void) => {
    const active = sessionRef.current;
    const saved = !active || (await active.saver.flush());
    if (sessionRef.current !== active) return;
    if (saved) next();
    else setBlockedLeave(() => next);
  };

  const openMap = async (entry: ProjectMap) => {
    try {
      const latest = await store.getMap(entry.id);
      if (!latest || latest.broken) {
        setMessage(`${entry.slot} couldn't be opened.`);
        return;
      }
      await store.setSetting(lastMapKey, latest.id);
      await store.setSetting(lastProjectKey, latest.projectId);
      setMessage(null);
      startSession(store, latest);
    } catch {
      setMessage(saveFailure);
    }
  };

  const createMap = async (form: MapDetails) => {
    const entry = createMapEntry(
      project.id,
      form.slot,
      mapFromTemplate(form.template, form.name),
    );
    try {
      await store.putMap(entry);
    } catch (error) {
      await refresh(store, project.id).catch(() => {});
      return problemOf(error, form.slot);
    }
    announce();
    setMapDialog(null);
    await whenSaved(() => void openMap(entry));
    return null;
  };

  const updateMap = async (id: string, form: MapDetails) => {
    try {
      const saved = await store.updateMap(id, (entry) => ({
        ...entry,
        slot: form.slot,
        description: form.description,
        par: form.par,
        map: { ...entry.map, name: form.name },
        editedAt: Date.now(),
      }));
      if (!saved) return "This map no longer exists.";
      announce(id);
      if (sessionRef.current?.id === id) setDetails(detailsOf(saved));
      else await refresh(store, saved.projectId);
      return null;
    } catch (error) {
      return problemOf(error, form.slot);
    }
  };

  const importMap = async (file: File) => {
    try {
      if (file.size > maxFileBytes) {
        throw new MapFileError("The file is too large.");
      }
      const map = parseMapFile(await file.text());
      const latest = await store.listMaps(project.id);
      const slot = freeSlots(latest)[0];
      if (!slot) throw new MapFileError("All 32 map slots are in use.");
      const entry = createMapEntry(project.id, slot, {
        ...map,
        name: map.name ?? file.name.replace(/\.json$/i, ""),
      });
      await store.putMap(entry);
      announce();
      setMessage(`${mapName(entry)} was added as ${slot}.`);
      await refresh(store, project.id);
    } catch (error) {
      setMessage(
        error instanceof MapFileError
          ? `Couldn't import ${file.name}. ${error.message}`
          : isSlotConflict(error)
            ? "That slot was just taken. Try again."
            : `Couldn't import ${file.name}.`,
      );
    }
  };

  const importProject = async (file: File) => {
    let backup;
    try {
      if (file.size > maxBackupBytes) {
        throw new MapFileError("The file is too large.");
      }
      backup = parseProjectBackup(await file.text());
    } catch (error) {
      setMessage(
        error instanceof MapFileError
          ? `Couldn't import ${file.name}. ${error.message}`
          : `Couldn't read ${file.name}.`,
      );
      return;
    }
    const { project: imported, maps: importedMaps } = backup;
    await attempt(async () => {
      await store.addProject(imported, importedMaps);
      selectProject(imported.id);
      await refresh(store, imported.id);
      setMessage(`${imported.name} was imported.`);
    });
  };

  const buildEpisode = () => {
    const ordered = bySlot(maps);
    const blocked = ordered.filter(
      (entry) =>
        entry.broken ||
        checkMap(entry.map).some((issue) => issue.severity === "error"),
    );
    if (blocked.length > 0) {
      setMessage(
        `Fix ${blocked.map((entry) => entry.slot).join(", ")} before building.`,
      );
      return;
    }
    try {
      download(
        wadFileName(project.name.toLowerCase()),
        compileEpisode(ordered).slice().buffer,
        "application/octet-stream",
      );
      const last = mapSlots.indexOf(ordered.at(-1)!.slot);
      const gaps = mapSlots
        .slice(0, last)
        .filter((slot) => !ordered.some((entry) => entry.slot === slot));
      setMessage(
        gaps.length > 0
          ? `Built. ${gaps.join(", ")} will use Freedoom's own levels.`
          : null,
      );
    } catch (error) {
      setMessage(`Couldn't build the episode. ${(error as Error).message}`);
    }
  };

  const exportProject = () => {
    const broken = maps.filter((entry) => entry.broken);
    download(
      `${wadFileName(project.name.toLowerCase()).replace(/\.wad$/, "")}-backup.json`,
      serializeProject(project, maps),
      "application/json",
    );
    setMessage(
      broken.length > 0
        ? `${broken.map((entry) => entry.slot).join(", ")} couldn't be read and were left out.`
        : null,
    );
  };

  if (session && details) {
    const openDialog = (dialog: "new" | "settings") =>
      void whenSaved(() => {
        void refresh(store, session.projectId)
          .then(() => setMapDialog(dialog))
          .catch(() => setMessage(saveFailure));
      });
    const current = maps.find((entry) => entry.id === session.id);
    return (
      <>
        <App
          key={session.id}
          initialMap={session.initialMap}
          mapName={details.name}
          slot={details.slot}
          par={details.par}
          saveStatus={store.durable ? saveStatus : "session"}
          onSave={onSave}
          watchExternal={watchExternal}
          onOpenProjects={() => void whenSaved(() => void closeSession(store))}
          onNewMap={() => openDialog("new")}
          onMapSettings={() => openDialog("settings")}
        />
        {mapDialog === "new" ? (
          <MapDialog
            maps={maps}
            onClose={() => setMapDialog(null)}
            onSubmit={createMap}
          />
        ) : null}
        {mapDialog === "settings" && current ? (
          <MapDialog
            maps={maps}
            entry={current}
            onClose={() => setMapDialog(null)}
            onSubmit={(form) => updateMap(session.id, form)}
          />
        ) : null}
        {blockedLeave ? (
          <AlertDialog
            open
            onOpenChange={(open) => {
              if (!open) setBlockedLeave(null);
            }}
          >
            <AlertDialogBackdrop className="fixed inset-0 z-40 bg-scrim" />
            <AlertDialogContent
              className={`${dialogClass} w-[460px] gap-3 p-5`}
            >
              <AlertDialogTitle className={titleClass}>
                Your latest changes aren't saved
              </AlertDialogTitle>
              <AlertDialogDescription className="m-0 text-fg-muted">
                Your browser couldn't store them. Download the map to keep a
                copy before you leave.
              </AlertDialogDescription>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className="button"
                  onClick={() => setBlockedLeave(null)}
                >
                  Stay here
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    const leave = blockedLeave;
                    setBlockedLeave(null);
                    leave();
                  }}
                >
                  Leave without saving
                </button>
                <button
                  type="button"
                  className="button primary"
                  onClick={() =>
                    download(
                      "wadsmith-map.json",
                      serializeMap({
                        ...session.saver.map,
                        name: details.name,
                      }),
                      "application/json",
                    )
                  }
                >
                  Download map
                </button>
              </div>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </>
    );
  }

  return (
    <ProjectHome
      projects={projects}
      project={project}
      maps={maps}
      durable={store.durable}
      message={message}
      onSelectProject={(id) => {
        selectProject(id);
        setMessage(null);
        void store.setSetting(lastProjectKey, id).catch(() => {});
        void refresh(store, id).catch(() => setMessage(saveFailure));
      }}
      onCreateProject={(name) => {
        const created = createProject(name);
        void attempt(async () => {
          await store.putProject(created);
          selectProject(created.id);
          await store.setSetting(lastProjectKey, created.id);
          await refresh(store, created.id);
        });
      }}
      onRenameProject={(name) =>
        void attempt(async () => {
          await store.putProject({ ...project, name });
          await refresh(store, project.id);
        })
      }
      onDeleteProject={() =>
        void attempt(async () => {
          await store.deleteProject(project.id);
          const [next] = await store.listProjects();
          selectProject(next.id);
          await store.setSetting(lastProjectKey, next.id);
          await refresh(store, next.id);
        })
      }
      onExportProject={exportProject}
      onImportProject={(file) => void importProject(file)}
      onImportMap={(file) => void importMap(file)}
      onBuildEpisode={buildEpisode}
      onOpenMap={(entry) => void openMap(entry)}
      onCreateMap={createMap}
      onUpdateMap={(entry, form) => updateMap(entry.id, form)}
      onDuplicateMap={(entry) =>
        void attempt(async () => {
          const latest = await store.listMaps(entry.projectId);
          const slot = freeSlots(latest)[0];
          if (!slot) {
            setMessage("All 32 map slots are in use.");
            return;
          }
          await store.putMap(
            createMapEntry(
              entry.projectId,
              slot,
              { ...structuredClone(entry.map), name: `${mapName(entry)} copy` },
              { description: entry.description, par: entry.par },
            ),
          );
          await refresh(store, entry.projectId);
        })
      }
      onDeleteMap={(entry) =>
        void attempt(async () => {
          await store.deleteMap(entry.id);
          announce(entry.id);
          await refresh(store, entry.projectId);
        })
      }
    />
  );
}

export { ProjectApp };
