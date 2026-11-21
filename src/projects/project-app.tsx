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
import { featuredMaps, type FeaturedMap } from "../map/featured";
import {
  MapFileError,
  maxFileBytes,
  parseMapFile,
  serializeMap,
} from "../map/storage";
import type { GameMap } from "../map/types";
import { validateMap } from "../map/validate";
import { compileEpisode, compileMap } from "../wad/compile";
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
  type Project,
  type ProjectMap,
  type ProjectStore,
} from "./project-data";
import { SidebarDrawer, type SidebarProps } from "./app-sidebar";
import { FeaturedMaps } from "./featured-maps";
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
type HomeView = "projects" | "featured";

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

function blockedOf(ordered: ProjectMap[]) {
  return ordered
    .filter(
      (entry) =>
        entry.broken ||
        checkMap(entry.map).some((issue) => issue.severity === "error"),
    )
    .map((entry) => entry.slot);
}

function levelsOf(ordered: ProjectMap[]): Level[] {
  return ordered.map((entry) => ({
    map: entry.map,
    title: mapName(entry),
    slot: entry.slot,
    par: entry.par,
  }));
}

function episodeGame(list: ProjectMap[]) {
  const ordered = bySlot(list);
  const blocked = blockedOf(ordered);
  if (ordered.length === 0) return null;
  return blocked.length > 0
    ? { problem: `Fix ${blocked.join(", ")} before playing.`, levels: [] }
    : { problem: null, levels: levelsOf(ordered) };
}

function playable(map: GameMap) {
  if (validateMap(map).length > 0) return false;
  try {
    compileMap(map);
    return true;
  } catch {
    return false;
  }
}

function knownFeatured(id: string | undefined) {
  return featuredMaps.some((item) => item.id === id) ? id! : null;
}

function soloFeatured(id: string | undefined) {
  const entry = featuredMaps.find((item) => item.id === id);
  return entry && entry.mode !== "deathmatch" ? entry : null;
}

// A co-op game can't survive a reload, so its history entry is marked.
function coopEntry() {
  return Boolean((history.state as { coop?: boolean } | null)?.coop);
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
  const [featuredId, setFeaturedId] = useState(() => {
    const route = parseRoute(location.pathname);
    return route.kind === "featured" ? knownFeatured(route.map) : null;
  });
  const [mapPlaying, setMapPlaying] = useState(false);
  const [coopPlaying, setCoopPlaying] = useState(false);
  const [lobby, setLobby] = useState<FeaturedMap | null>(null);
  const [episodePlay, setEpisodePlay] = useState<Level[] | null>(null);
  const [playing, setPlaying] = useState<{
    entry: FeaturedMap;
    hosted: HostedGame | null;
  } | null>(null);
  const synced = useRef<{ key: string; play: boolean } | null>(null);
  const playPushed = useRef(false);
  const routeRun = useRef(0);
  const settling = useRef(true);
  const settleCount = useRef(0);
  const historySettle = useRef(0);
  const [settles, setSettles] = useState(0);
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
      setMapPlaying(false);
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
      setMapPlaying(false);
      selectProject(entry.projectId);
    },
    [announce, closeSession, selectProject],
  );

  useEffect(() => {
    let cancelled = false;
    let run = routeRun.current;
    const stale = () => cancelled || run !== routeRun.current;
    preparing ??= openPreparedStore();
    preparing
      .then(async ({ store: opened, ready }) => {
        if (cancelled) return;
        run = ++routeRun.current;
        const route = parseRoute(location.pathname);
        const play = route.kind !== "home" && route.play && !coopEntry();
        setStore(opened);
        const wanted =
          route.kind === "episode" || route.kind === "map"
            ? route.id
            : ready.projectId;
        selectProject(wanted);
        await refresh(opened, wanted);
        if (stale()) return;
        if (route.kind === "map") {
          const entry = (await opened.listMaps(route.id)).find(
            (item) => item.slot === route.slot && !item.broken,
          );
          if (stale()) return;
          if (entry) {
            startSession(opened, entry);
            if (play && playable(entry.map)) setMapPlaying(true);
          } else setMessage(`${route.slot} isn't in this episode.`);
        } else if (route.kind === "episode" && play) {
          const started = episodeGame(await opened.listMaps(route.id));
          if (stale() || !started) return;
          if (started.problem) setMessage(started.problem);
          else setEpisodePlay(started.levels);
        } else if (route.kind === "featured" && play) {
          const entry = soloFeatured(route.map);
          if (entry) setPlaying({ entry, hosted: null });
        } else if (route.kind === "home" && ready.created && ready.entry) {
          startSession(opened, ready.entry);
        }
      })
      .catch(() => {
        if (!cancelled) setMessage("Your episodes couldn't be opened.");
      })
      .finally(() => {
        if (stale()) return;
        settling.current = false;
        settleCount.current += 1;
        historySettle.current = settleCount.current;
        setSettles(settleCount.current);
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

  const whenSaved = async (next: () => void | Promise<void>) => {
    const active = sessionRef.current;
    const saved = !active || (await active.saver.flush());
    if (sessionRef.current !== active) return;
    if (saved) await next();
    else setBlockedLeave(() => () => void next());
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

  const endPlay = () => {
    playing?.hosted?.close();
    setPlaying(null);
  };

  const playEpisode = (list: ProjectMap[]) => {
    const started = episodeGame(list);
    if (!started) return;
    setMessage(started.problem);
    if (!started.problem) setEpisodePlay(started.levels);
  };

  // Routes from history change state over several awaits. The URL is already
  // right, so syncing pauses until they settle to keep history unchanged.
  const routeTo = async (route: Route, fromHistory = false) => {
    if (!store) return;
    const run = ++routeRun.current;
    const current = () => run === routeRun.current;
    const play = route.kind !== "home" && Boolean(route.play);
    playPushed.current = play;
    setMessage(null);
    if (fromHistory) settling.current = true;
    try {
      const active = sessionRef.current;
      if (
        route.kind === "map" &&
        active?.projectId === route.id &&
        details?.slot === route.slot
      ) {
        setMapPlaying(play && playable(active.saver.map));
        return;
      }
      setEpisodePlay(null);
      endPlay();
      await whenSaved(async () => {
        if (route.kind === "map") {
          const entry = (await store.listMaps(route.id)).find(
            (item) => item.slot === route.slot,
          );
          if (!current()) return;
          if (entry) {
            setView("projects");
            await openMap(entry);
            if (
              current() &&
              play &&
              sessionRef.current?.id === entry.id &&
              playable(entry.map)
            ) {
              setMapPlaying(true);
            }
            return;
          }
        }
        if (sessionRef.current) await closeSession(store);
        if (!current()) return;
        setView(route.kind === "featured" ? "featured" : "projects");
        if (route.kind === "featured") {
          setFeaturedId(knownFeatured(route.map));
          const entry = play ? soloFeatured(route.map) : null;
          if (entry) setPlaying({ entry, hosted: null });
        }
        if (route.kind === "episode" || route.kind === "map") {
          selectProject(route.id);
          void store.setSetting(lastProjectKey, route.id).catch(() => {});
          await refresh(store, route.id).catch(() => setMessage(saveFailure));
          if (route.kind === "episode" && play) {
            const list = await store.listMaps(route.id);
            if (current()) playEpisode(list);
          }
        }
      });
    } finally {
      if (current()) {
        settleCount.current += 1;
        if (fromHistory) historySettle.current = settleCount.current;
        settling.current = false;
        setSettles(settleCount.current);
      }
    }
  };

  const applyRoute = useEffectEvent(
    (route: Route) => void routeTo(route, true),
  );

  useEffect(() => {
    const onPop = () => {
      const route = parseRoute(location.pathname);
      if (route.kind !== "home" && route.play && coopEntry()) {
        const page = { ...route, play: false };
        history.replaceState(null, "", pathOf(page));
        applyRoute(page);
      } else applyRoute(route);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const page: { key: string; route: Route } | null =
    !store || !projectId
      ? null
      : session && details
        ? {
            key: `map:${session.id}`,
            route: {
              kind: "map",
              id: session.projectId,
              slot: details.slot,
              play: mapPlaying,
            },
          }
        : view === "featured"
          ? {
              key: "featured",
              route: {
                kind: "featured",
                map: playing?.entry.id ?? featuredId ?? undefined,
                play: Boolean(playing),
              },
            }
          : {
              key: `episode:${projectId}`,
              route: { kind: "episode", id: projectId, play: !!episodePlay },
            };
  const wantedPath = page ? pathOf(page.route) : null;
  const wantedPlay = page?.route.kind !== "home" && Boolean(page?.route.play);
  const pageKey = page?.key ?? null;
  const coop = mapPlaying ? coopPlaying : Boolean(playing?.hosted);

  // Changes within one page, such as a slot rename, keep their history entry.
  // Leaving a game the app pushed goes back rather than adding an entry.
  useEffect(() => {
    if (settling.current || !wantedPath || !pageKey) return;
    const last = synced.current;
    const samePage = last?.key === pageKey;
    if (wantedPath !== location.pathname) {
      if (samePage && last.play && !wantedPlay && playPushed.current) {
        playPushed.current = false;
        history.back();
      } else if (
        !last ||
        settles === historySettle.current ||
        (samePage && (last.play === wantedPlay || !wantedPlay))
      ) {
        history.replaceState(null, "", wantedPath);
      } else {
        playPushed.current = wantedPlay && samePage;
        history.pushState(wantedPlay && coop ? { coop } : null, "", wantedPath);
      }
    }
    historySettle.current = -1;
    synced.current = { key: pageKey, play: wantedPlay };
  }, [settles, wantedPath, pageKey, wantedPlay, coop]);

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

  const sidebar: SidebarProps = {
    projects,
    counts,
    current:
      session && details
        ? { kind: "map", id: session.projectId, slot: details.slot }
        : view === "featured"
          ? { kind: "featured" }
          : { kind: "episode", id: project.id },
    durable: store.durable,
    onNavigate: (route) => void routeTo(route),
    onCreateProject: (name, start) => {
      const created = createProject(name);
      void attempt(async () => {
        await store.addProject(created, episodeMaps(created.id, start));
        await store.setSetting(lastProjectKey, created.id);
        await routeTo({ kind: "episode", id: created.id });
      });
    },
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
    const blocked = blockedOf(ordered);
    if (blocked.length === 0) return false;
    setMessage(`Fix ${blocked.join(", ")} before ${verb}.`);
    return true;
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
          navigation={<SidebarDrawer {...sidebar} />}
          onNewMap={() => openDialog("new")}
          onMapSettings={() => openDialog("settings")}
          playing={mapPlaying}
          onPlayingChange={(next, hosted) => {
            setMapPlaying(next);
            setCoopPlaying(next && hosted);
          }}
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
          sidebar={sidebar}
          message={message}
          onPlaySolo={(entry) => {
            setFeaturedId(entry.id);
            setPlaying({ entry, hosted: null });
          }}
          onPlayTogether={setLobby}
          onOpenCopy={openCopy}
          selectedId={featuredId}
          onSelect={setFeaturedId}
        />
        {lobby ? (
          <PlayTogether
            map={lobby.map}
            title={lobby.title}
            slot={lobby.slot}
            par={lobby.par}
            initialMode={lobby.mode === "deathmatch" ? "deathmatch" : "coop"}
            onStart={(hosted) => {
              setFeaturedId(lobby.id);
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
      sidebar={sidebar}
      project={project}
      maps={maps}
      message={message}
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
      onPlayEpisode={() => playEpisode(maps)}
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
