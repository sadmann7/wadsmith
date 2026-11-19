"use client";

import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@ui-sdk/react/alert-dialog";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { wadFileName } from "../editor/build-dialog";
import { App } from "../editor/editor-app";
import { PlayTogether, type HostedGame } from "../engine/play-together";
import { GameView, type Level } from "../engine/play-panel";
import { checkMap } from "../map/checks";
import type { FeaturedMap } from "../map/featured";
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
  episodeMaps,
  freeSlots,
  isSlotConflict,
  lastMapKey,
  lastProjectKey,
  mapFromTemplate,
  mapName,
  mapSlots,
  mapStatus,
  maxBackupBytes,
  parseProjectBackup,
  prepareProjects,
  serializeProject,
  slotMoves,
  type EpisodeStart,
  type Project,
  type ProjectMap,
  type ProjectStore,
} from "./project-data";
import { FeaturedMaps } from "./featured-maps";
import type { HomeView } from "./home-header";
import { ProjectHome } from "./project-home";
import { parseRoute, pathOf, type Route } from "./routes";
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

function viewOfPath(): HomeView {
  return parseRoute(location.pathname).kind === "featured"
    ? "featured"
    : "projects";
}

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
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [projectId, setProjectId] = useState("");
  const [maps, setMaps] = useState<ProjectMap[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [details, setDetails] = useState<SessionDetails | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const [mapDialog, setMapDialog] = useState<"new" | "settings" | null>(null);
  const [blockedLeave, setBlockedLeave] = useState<(() => void) | null>(null);
  const [view, setView] = useState(viewOfPath);
  const [lobby, setLobby] = useState<FeaturedMap | null>(null);
  const [episodePlay, setEpisodePlay] = useState<Level[] | null>(null);
  const [playing, setPlaying] = useState<{
    entry: FeaturedMap;
    hosted: HostedGame | null;
  } | null>(null);
  const syncedPath = useRef<string | null>(null);
  const syncedSession = useRef<string | null>(null);
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
      const nextCounts = Object.fromEntries(
        await Promise.all(
          nextProjects.map(
            async (item) => [item.id, await active.countMaps(item.id)] as const,
          ),
        ),
      );
      if (run !== refreshRun.current) return;
      setProjects(nextProjects);
      setCounts(nextCounts);
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
        const route = parseRoute(location.pathname);
        const wanted =
          route.kind === "episode" || route.kind === "map"
            ? route.id
            : ready.projectId;
        selectProject(wanted);
        await refresh(opened, wanted);
        if (cancelled) return;
        if (route.kind === "map") {
          const entry = (await opened.listMaps(route.id)).find(
            (item) => item.slot === route.slot && !item.broken,
          );
          if (cancelled) return;
          if (entry) startSession(opened, entry);
          else setMessage(`${route.slot} isn't in this episode.`);
        } else if (route.kind === "home" && ready.created && ready.entry) {
          startSession(opened, ready.entry);
        }
      })
      .catch(() => {
        if (!cancelled) setMessage("Your episodes couldn't be opened.");
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

  const whenSaved = async (next: () => void) => {
    const active = sessionRef.current;
    const saved = !active || (await active.saver.flush());
    if (sessionRef.current !== active) return;
    if (saved) next();
    else setBlockedLeave(() => next);
  };

  const openMap = async (entry: ProjectMap) => {
    if (!store) return;
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
      await refresh(store, latest.projectId);
    } catch {
      setMessage(saveFailure);
    }
  };

  const applyRoute = useEffectEvent((route: Route) => {
    if (!store) return;
    setEpisodePlay(null);
    void whenSaved(async () => {
      if (route.kind === "map") {
        const entry = (await store.listMaps(route.id)).find(
          (item) => item.slot === route.slot,
        );
        if (entry) {
          setView("projects");
          await openMap(entry);
          return;
        }
      }
      if (sessionRef.current) await closeSession(store);
      setView(route.kind === "featured" ? "featured" : "projects");
      if (route.kind === "episode" || route.kind === "map") {
        selectProject(route.id);
        await refresh(store, route.id).catch(() => setMessage(saveFailure));
      }
    });
  });

  useEffect(() => {
    const onPop = () => applyRoute(parseRoute(location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const wantedPath =
    !store || !projectId
      ? null
      : session && details
        ? pathOf({ kind: "map", id: session.projectId, slot: details.slot })
        : view === "featured"
          ? pathOf({ kind: "featured" })
          : pathOf({ kind: "episode", id: projectId });

  // A slot change keeps its history entry, since it names the same map.
  useEffect(() => {
    if (!wantedPath) return;
    const sessionId = session?.id ?? null;
    if (wantedPath !== location.pathname) {
      const replace =
        syncedPath.current === null ||
        (sessionId !== null && sessionId === syncedSession.current);
      if (replace) history.replaceState(null, "", wantedPath);
      else history.pushState(null, "", wantedPath);
    }
    syncedPath.current = wantedPath;
    syncedSession.current = sessionId;
  }, [wantedPath, session?.id]);

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
        Loading episodes…
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

  const navigate = (next: HomeView) => {
    setView(next);
    setMessage(null);
  };

  const openCopy = (featured: FeaturedMap) =>
    void attempt(async () => {
      const slots = freeSlots(await store.listMaps(project.id));
      const slot = slots.includes(featured.slot) ? featured.slot : slots[0];
      if (!slot) {
        setMessage("All 32 map slots are in use.");
        return;
      }
      const entry = createMapEntry(
        project.id,
        slot,
        structuredClone(featured.map),
        { description: featured.blurb, par: featured.par },
      );
      await store.putMap(entry);
      await openMap(entry);
    });

  const createMap = async (form: MapDetails) => {
    const entry = createMapEntry(
      project.id,
      form.slot,
      form.featured
        ? { ...structuredClone(form.featured.map), name: form.name }
        : mapFromTemplate(form.template, form.name),
      { description: form.description, par: form.par },
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

  const blockedSlots = (ordered: ProjectMap[], verb: string) => {
    const blocked = ordered.filter(
      (entry) =>
        entry.broken ||
        checkMap(entry.map).some((issue) => issue.severity === "error"),
    );
    if (blocked.length === 0) return false;
    setMessage(
      `Fix ${blocked.map((entry) => entry.slot).join(", ")} before ${verb}.`,
    );
    return true;
  };

  const playEpisode = () => {
    const ordered = bySlot(maps);
    if (blockedSlots(ordered, "playing")) return;
    setMessage(null);
    setEpisodePlay(
      ordered.map((entry) => ({
        map: entry.map,
        title: mapName(entry),
        slot: entry.slot,
        par: entry.par,
      })),
    );
  };

  const buildEpisode = () => {
    const ordered = bySlot(maps);
    if (blockedSlots(ordered, "building")) return;
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
          onOpenProjects={() =>
            void whenSaved(() => {
              setView("projects");
              void closeSession(store);
            })
          }
          onNewMap={() => openDialog("new")}
          onMapSettings={() => openDialog("settings")}
          episode={{
            name: project.name,
            maps: bySlot(maps).map((entry) => ({
              id: entry.id,
              slot: entry.slot,
              name: mapName(entry),
              health: mapStatus(entry).kind,
            })),
            currentId: session.id,
            canAddMap: freeSlots(maps).length > 0,
            onOpenMap: (id) => {
              const entry = maps.find((item) => item.id === id);
              if (entry) void whenSaved(() => void openMap(entry));
            },
          }}
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

  const endPlay = () => {
    playing?.hosted?.close();
    setPlaying(null);
  };

  if (episodePlay) {
    const [first] = episodePlay;
    return (
      <GameView
        map={first.map}
        title={first.title}
        slot={first.slot}
        par={first.par}
        episode={episodePlay}
        exit="episode"
        onExit={() => setEpisodePlay(null)}
      />
    );
  }

  if (playing) {
    const { entry, hosted } = playing;
    return (
      <GameView
        map={entry.map}
        title={entry.title}
        slot={entry.slot}
        par={entry.par}
        coop={hosted?.session ?? null}
        exit="maps"
        onExit={endPlay}
      />
    );
  }

  if (view === "featured") {
    return (
      <>
        <FeaturedMaps
          message={message}
          onNavigate={navigate}
          onPlaySolo={(entry) => setPlaying({ entry, hosted: null })}
          onPlayTogether={setLobby}
          onOpenCopy={openCopy}
        />
        {lobby ? (
          <PlayTogether
            map={lobby.map}
            title={lobby.title}
            slot={lobby.slot}
            par={lobby.par}
            initialMode={lobby.mode === "deathmatch" ? "deathmatch" : "coop"}
            onStart={(hosted) => {
              setPlaying({ entry: lobby, hosted });
              setLobby(null);
            }}
            onClose={() => setLobby(null)}
          />
        ) : null}
      </>
    );
  }

  return (
    <ProjectHome
      onNavigate={navigate}
      projects={projects}
      counts={counts}
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
      onCreateProject={(name: string, start: EpisodeStart) => {
        const created = createProject(name);
        void attempt(async () => {
          await store.addProject(created, episodeMaps(created.id, start));
          selectProject(created.id);
          await store.setSetting(lastProjectKey, created.id);
          await refresh(store, created.id);
        });
      }}
      onRenameProject={(name) =>
        void attempt(async () => {
          await store.putProject({ ...project, name });
          await refresh(store, projectIdRef.current);
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
      onPlayEpisode={playEpisode}
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
      onReorderMaps={(order) =>
        void attempt(async () => {
          await store.moveMaps(slotMoves(maps, order));
          await refresh(store, projectIdRef.current);
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
