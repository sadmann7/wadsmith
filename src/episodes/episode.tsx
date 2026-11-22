"use client";

import * as React from "react";

import { wadFileName } from "@/editor/build-dialog";
import { Editor } from "@/editor/editor";
import { PlayTogether, type HostedGame } from "@/engine/play-together";
import { GameView, type Level } from "@/engine/play-panel";
import { loadIwad } from "@/engine/iwad";
import type { GameFiles, Skill } from "@/engine/runtime";
import { featuredMaps, type FeaturedMap } from "@/map/featured";
import {
  MapFileError,
  maxFileBytes,
  parseMapFile,
  serializeMap,
} from "@/map/storage";
import type { GameMap } from "@/map/types";
import { validateMap } from "@/map/validate";
import { compileEpisode, compileMap } from "@/wad/compile";
import { decompileMap } from "@/wad/decompile";
import {
  WadFileError,
  inspectWads,
  isWad,
  type GameFile,
  type WadSummary,
} from "@/wad/inspect";
import { readMaps } from "@/wad/read-map";
import { isZip, unzip } from "@/wad/zip";
import { MapDialog, type MapDetails } from "./map-dialog";
import {
  bySlot,
  createMapEntry,
  createMapSaver,
  createEpisode,
  episodeMaps,
  freeSlots,
  isSlotConflict,
  lastMapKey,
  lastEpisodeKey,
  mapFromTemplate,
  mapName,
  mapStatus,
  maxBackupBytes,
  parseEpisodeBackup,
  prepareEpisodes,
  serializeEpisode,
  slotMoves,
  type Episode,
  type EpisodeMap,
  type EpisodeStore,
  withComplevel,
} from "./episode-data";
import { SidebarDrawer, type SidebarProps } from "./app-sidebar";
import {
  checkBuild,
  knownBuildProblem,
  knownLumps,
  useBuildChecks,
} from "./build-checks";
import { EpisodeBuildDialog } from "./episode-build-dialog";
import { FeaturedMaps } from "./featured-maps";
import { EpisodeHome } from "./episode-home";
import { WadImportDialog, type ImportedMap } from "./wad-import-dialog";
import { WadPlayDialog } from "./wad-play-dialog";
import { findEpisode, parseRoute, pathOf, type Route } from "./routes";
import { createMemoryStore, openEpisodeStore } from "./episode-store";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert } from "@/components/ui/alert";

interface Session {
  id: string;
  episodeId: string;
  initialMap: GameMap;
  saver: ReturnType<typeof createMapSaver>;
}

interface SessionDetails {
  name: string;
  slot: string;
  par: number | null;
}
type SaveStatus = "saving" | "saved" | "failed";
type HomeView = "episodes" | "featured";

const channelName = "wadsmith";
const saveFailure = "Your browser couldn't save that change.";

let preparing: ReturnType<typeof openPreparedStore> | null = null;

function viewOfPath(): HomeView {
  return parseRoute(location.pathname).kind === "featured"
    ? "featured"
    : "episodes";
}

async function prepared(store: EpisodeStore) {
  return { store, ready: await prepareEpisodes(store) };
}

async function openPreparedStore() {
  try {
    return await prepared(await openEpisodeStore());
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

function blockedOf(
  ordered: EpisodeMap[],
  problems: (string | null | undefined)[],
) {
  return ordered
    .filter(
      (entry, index) => mapStatus(entry, problems[index]).kind === "error",
    )
    .map((entry) => entry.slot);
}

function levelsOf(ordered: EpisodeMap[]): Level[] {
  return ordered.map((entry) => ({
    map: entry.map,
    title: mapName(entry),
    slot: entry.slot,
    par: entry.par,
    lumps: knownLumps(entry),
  }));
}

async function episodeGame(list: EpisodeMap[]) {
  const ordered = bySlot(list);
  if (ordered.length === 0) return null;
  const problems = await Promise.all(
    ordered.map((entry) => (entry.broken ? null : checkBuild(entry))),
  );
  const blocked = blockedOf(ordered, problems);
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

function detailsOf(entry: EpisodeMap): SessionDetails {
  return { name: mapName(entry), slot: entry.slot, par: entry.par };
}

function problemOf(error: unknown, slot: string) {
  return isSlotConflict(error) ? `${slot} is already in use.` : saveFailure;
}

async function readGameFiles(picked: File[]) {
  const files = await Promise.all(
    picked.map(async (file): Promise<GameFile[]> => {
      const data = new Uint8Array(await file.arrayBuffer());
      return isZip(data)
        ? unzip({ name: file.name, data })
        : [{ name: file.name, data }];
    }),
  );
  return files.flat();
}

function EpisodeApp() {
  const [store, setStore] = React.useState<EpisodeStore | null>(null);
  const [episodes, setEpisodes] = React.useState<Episode[]>([]);
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [episodeId, setEpisodeId] = React.useState("");
  const [maps, setMaps] = React.useState<EpisodeMap[]>([]);
  const [session, setSession] = React.useState<Session | null>(null);
  // Only the editor's map switcher shows them; the home page's rows check their own.
  useBuildChecks(session ? maps : []);
  const [details, setDetails] = React.useState<SessionDetails | null>(null);
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("saved");
  const [message, setMessage] = React.useState<string | null>(null);
  const [mapDialog, setMapDialog] = React.useState<"new" | "settings" | null>(
    null,
  );
  const [buildingEpisode, setBuildingEpisode] = React.useState<string | null>(
    null,
  );
  const [blockedLeave, setBlockedLeave] = React.useState<(() => void) | null>(
    null,
  );
  const [view, setView] = React.useState(viewOfPath);
  const [homeId, setHomeId] = React.useState<string | null>(null);
  const [featuredId, setFeaturedId] = React.useState(() => {
    const route = parseRoute(location.pathname);
    return route.kind === "featured" ? knownFeatured(route.map) : null;
  });
  const [mapPlaying, setMapPlaying] = React.useState(false);
  const [coopPlaying, setCoopPlaying] = React.useState(false);
  const [lobby, setLobby] = React.useState<FeaturedMap | null>(null);
  const [episodePlay, setEpisodePlay] = React.useState<Level[] | null>(null);
  const [playing, setPlaying] = React.useState<{
    entry: FeaturedMap;
    hosted: HostedGame | null;
  } | null>(null);
  const [wadImport, setWadImport] = React.useState<{
    episodeId: string;
    fileName: string;
    maps: ImportedMap[];
    slots: string[];
  } | null>(null);
  const [wadPick, setWadPick] = React.useState<{
    title: string;
    summary: WadSummary;
  } | null>(null);
  const [wadPlay, setWadPlay] = React.useState<{
    title: string;
    files: GameFiles;
    skill: Skill;
  } | null>(null);
  const synced = React.useRef<{ key: string; play: boolean } | null>(null);
  const playPushed = React.useRef(false);
  const routeRun = React.useRef(0);
  const wadRun = React.useRef(0);
  const importRun = React.useRef(0);
  const settling = React.useRef(true);
  const settleCount = React.useRef(0);
  const historySettle = React.useRef(0);
  const [settles, setSettles] = React.useState(0);
  const channel = React.useRef<BroadcastChannel | null>(null);
  const sessionRef = React.useRef<Session | null>(null);
  const episodeIdRef = React.useRef("");
  const refreshRun = React.useRef(0);
  const externalListeners = React.useRef(new Set<(map: GameMap) => void>());

  const announce = React.useCallback((mapId?: string) => {
    channel.current?.postMessage({ mapId });
  }, []);

  const selectEpisode = React.useCallback((id: string) => {
    episodeIdRef.current = id;
    setEpisodeId(id);
  }, []);

  const refresh = React.useCallback(
    async (active: EpisodeStore, id: string) => {
      refreshRun.current += 1;
      const run = refreshRun.current;
      const nextEpisodes = await active.listEpisodes();
      const shown = nextEpisodes.some((item) => item.id === id)
        ? id
        : nextEpisodes[0]?.id;
      const nextMaps = shown ? await active.listMaps(shown) : [];
      const nextCounts = Object.fromEntries(
        await Promise.all(
          nextEpisodes.map(
            async (item) => [item.id, await active.countMaps(item.id)] as const,
          ),
        ),
      );
      if (run !== refreshRun.current) return;
      setEpisodes(nextEpisodes);
      setCounts(nextCounts);
      setMaps(nextMaps);
      if (shown) selectEpisode(shown);
    },
    [selectEpisode],
  );

  const closeSession = React.useCallback(
    async (active: EpisodeStore, note: string | null = null) => {
      const id = sessionRef.current?.episodeId ?? episodeIdRef.current;
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

  const startSession = React.useCallback(
    (active: EpisodeStore, entry: EpisodeMap) => {
      const saver = createMapSaver(active, entry, {
        onStatus: setSaveStatus,
        onSaved: (saved) => announce(saved.id),
        onMissing: () =>
          void closeSession(active, "This map was deleted in another tab."),
      });
      const next = {
        id: entry.id,
        episodeId: entry.episodeId,
        initialMap: entry.map,
        saver,
      };
      sessionRef.current = next;
      setSession(next);
      setDetails(detailsOf(entry));
      setSaveStatus("saved");
      setMapPlaying(false);
      setBuildingEpisode(null);
      selectEpisode(entry.episodeId);
    },
    [announce, closeSession, selectEpisode],
  );

  React.useEffect(() => {
    let cancelled = false;
    let run = routeRun.current;
    const stale = () => cancelled || run !== routeRun.current;
    preparing ??= openPreparedStore();
    preparing
      .then(async ({ store: opened, ready }) => {
        if (cancelled) return;
        run = ++routeRun.current;
        const parsed = parseRoute(location.pathname);
        const play = parsed.kind !== "home" && parsed.play && !coopEntry();
        setStore(opened);
        const badSlot = /^\/episodes\/([^/]+)\/[^/]+\/?$/.exec(
          location.pathname,
        );
        const named =
          parsed.kind === "episode" || parsed.kind === "map"
            ? parsed.id
            : badSlot
              ? decodeURIComponent(badSlot[1])
              : null;
        const found =
          named === null
            ? null
            : findEpisode(await opened.listEpisodes(), named);
        const missing = named !== null && !found;
        const route =
          found && (parsed.kind === "episode" || parsed.kind === "map")
            ? { ...parsed, id: found.id }
            : parsed;
        const wanted = found?.id ?? ready.episodeId;
        selectEpisode(wanted);
        if (location.pathname === "/") setHomeId(wanted);
        await refresh(opened, wanted);
        if (stale()) return;
        if (missing) {
          setMessage(
            "That episode isn't in this browser. Episodes are saved per browser, so import its backup to bring it here.",
          );
        } else if (route.kind === "home" && badSlot) {
          setMessage("That isn't a map slot. Slots run from MAP01 to MAP32.");
        } else if (
          route.kind === "home" &&
          location.pathname.startsWith("/join/")
        ) {
          setMessage(
            "That invite link isn't valid. Ask the host for a new one.",
          );
        } else if (route.kind === "home" && location.pathname !== "/") {
          setMessage("That address doesn't match a page in Wadsmith.");
        } else if (route.kind === "map") {
          const entry = (await opened.listMaps(route.id)).find(
            (item) => item.slot === route.slot && !item.broken,
          );
          if (stale()) return;
          if (entry) {
            startSession(opened, entry);
            if (play && playable(entry.map)) setMapPlaying(true);
          } else setMessage(`${route.slot} isn't in this episode.`);
        } else if (route.kind === "episode" && play) {
          const started = await episodeGame(await opened.listMaps(route.id));
          if (stale() || !started) return;
          if (started.problem) setMessage(started.problem);
          else setEpisodePlay(started.levels);
        } else if (route.kind === "featured" && play) {
          const entry = soloFeatured(route.map);
          if (entry) setPlaying({ entry, hosted: null });
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
  }, [refresh, selectEpisode, startSession]);

  React.useEffect(() => {
    if (!store?.durable || typeof BroadcastChannel === "undefined") return;
    const opened = new BroadcastChannel(channelName);
    channel.current = opened;
    const onMessage = async ({ data }: MessageEvent<{ mapId?: string }>) => {
      const active = sessionRef.current;
      if (!active) {
        await refresh(store, episodeIdRef.current);
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

  const openMap = async (entry: EpisodeMap) => {
    if (!store) return;
    try {
      const latest = await store.getMap(entry.id);
      if (!latest || latest.broken) {
        setMessage(`${entry.slot} couldn't be opened.`);
        return;
      }
      await store.setSetting(lastMapKey, latest.id);
      await store.setSetting(lastEpisodeKey, latest.episodeId);
      setMessage(null);
      startSession(store, latest);
      await refresh(store, latest.episodeId);
    } catch {
      setMessage(saveFailure);
    }
  };

  const endPlay = () => {
    playing?.hosted?.close();
    setPlaying(null);
  };

  const playEpisode = async (list: EpisodeMap[]) => {
    const run = routeRun.current;
    const episodeAt = episodeIdRef.current;
    const checking = "Checking that every map builds…";
    if (list.some((entry) => knownBuildProblem(entry) === undefined)) {
      setMessage(checking);
    }
    const started = await episodeGame(list);
    if (!started) return;
    if (
      run !== routeRun.current ||
      episodeAt !== episodeIdRef.current ||
      sessionRef.current
    ) {
      setMessage((shown) => (shown === checking ? null : shown));
      return;
    }
    setMessage(started.problem);
    if (!started.problem) setEpisodePlay(started.levels);
  };

  // Routes from history change state over several awaits. The URL is already
  // right, so syncing pauses until they settle to keep history unchanged.
  const routeTo = async (target: Route, fromHistory = false) => {
    if (!store) return;
    const found =
      target.kind === "episode" || target.kind === "map"
        ? findEpisode(episodes, target.id)
        : null;
    const route = found ? { ...target, id: found.id } : target;
    setHomeId(route.kind === "home" ? episodeIdRef.current : null);
    const run = ++routeRun.current;
    const current = () => run === routeRun.current;
    const play = route.kind !== "home" && Boolean(route.play);
    playPushed.current = play;
    setMessage(null);
    setBuildingEpisode(null);
    if (fromHistory) settling.current = true;
    try {
      const active = sessionRef.current;
      if (
        route.kind === "map" &&
        active?.episodeId === route.id &&
        details?.slot === route.slot
      ) {
        setMapPlaying(play && playable(active.saver.map));
        return;
      }
      setEpisodePlay(null);
      wadRun.current += 1;
      importRun.current += 1;
      setWadImport(null);
      setWadPick(null);
      setWadPlay(null);
      endPlay();
      await whenSaved(async () => {
        if (route.kind === "map") {
          const entry = (await store.listMaps(route.id)).find(
            (item) => item.slot === route.slot,
          );
          if (!current()) return;
          if (entry) {
            setView("episodes");
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
        setView(route.kind === "featured" ? "featured" : "episodes");
        if (route.kind === "featured") {
          setFeaturedId(knownFeatured(route.map));
          const entry = play ? soloFeatured(route.map) : null;
          if (entry) setPlaying({ entry, hosted: null });
        }
        if (route.kind === "episode" || route.kind === "map") {
          selectEpisode(route.id);
          void store.setSetting(lastEpisodeKey, route.id).catch(() => {});
          await refresh(store, route.id).catch(() => setMessage(saveFailure));
          if (route.kind === "episode" && play) {
            const list = await store.listMaps(route.id);
            if (current()) await playEpisode(list);
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

  const applyRoute = React.useEffectEvent(
    (route: Route) => void routeTo(route, true),
  );

  React.useEffect(() => {
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
    !store || !episodeId
      ? null
      : session && details
        ? {
            key: `map:${session.id}`,
            route: {
              kind: "map",
              id: session.episodeId,
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
              key: `episode:${episodeId}`,
              route:
                episodeId === homeId && !episodePlay
                  ? { kind: "home" }
                  : { kind: "episode", id: episodeId, play: !!episodePlay },
            };
  const wantedPath = page ? pathOf(page.route) : null;
  const wantedPlay = page?.route.kind !== "home" && Boolean(page?.route.play);
  const pageKey = page?.key ?? null;
  const coop = mapPlaying ? coopPlaying : Boolean(playing?.hosted);

  // Changes within one page, such as a slot rename, keep their history entry.
  // Leaving a game the app pushed goes back rather than adding an entry.
  React.useEffect(() => {
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

  React.useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (sessionRef.current?.saver.failed) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const onSave = React.useCallback((map: GameMap) => {
    sessionRef.current?.saver.saveMap(map);
  }, []);

  const watchExternal = React.useCallback(
    (listener: (map: GameMap) => void) => {
      externalListeners.current.add(listener);
      return () => {
        externalListeners.current.delete(listener);
      };
    },
    [],
  );

  if (!store || episodes.length === 0 || settles === 0) {
    return message ? (
      <Alert variant="destructive" className="m-4" role="alert">
        {message}
      </Alert>
    ) : (
      <div className="editor-loading" role="status">
        Loading episodes…
      </div>
    );
  }

  const episode = episodes.find((item) => item.id === episodeId) ?? episodes[0];

  const attempt = async (run: () => Promise<void>) => {
    try {
      await run();
      announce();
    } catch {
      setMessage(saveFailure);
    }
  };

  const sidebar: SidebarProps = {
    episodes,
    counts,
    current:
      session && details
        ? { kind: "map", id: session.episodeId, slot: details.slot }
        : view === "featured"
          ? { kind: "featured" }
          : { kind: "episode", id: episode.id },
    durable: store.durable,
    onNavigate: (route) => void routeTo(route),
    onCreateEpisode: (name, start) => {
      const created = createEpisode(name);
      void attempt(async () => {
        const maps =
          start === "freedoom"
            ? await freedoomMaps(created.id)
            : episodeMaps(created.id, start);
        if (!maps) return;
        await store.addEpisode(created, maps);
        await store.setSetting(lastEpisodeKey, created.id);
        await routeTo({ kind: "episode", id: created.id });
      });
    },
  };

  const freedoomMaps = async (episodeId: string) => {
    const run = ++importRun.current;
    setMessage("Loading Freedoom…");
    let data: Uint8Array;
    try {
      data = await loadIwad();
    } catch {
      if (run === importRun.current) {
        setMessage(
          "Couldn't load Freedoom. Check your connection and try again.",
        );
      }
      return null;
    }
    const found = readMaps([{ name: "freedoom2.wad", data }]);
    const maps: EpisodeMap[] = [];
    for (const [index, doom] of found.entries()) {
      setMessage(`Reading ${doom.slot}, ${index + 1} of ${found.length}…`);
      await new Promise((done) => setTimeout(done));
      if (run !== importRun.current) return null;
      maps.push(
        createMapEntry(episodeId, doom.slot, decompileMap(doom).map, {
          description: "A level from Freedoom: Phase 2.",
        }),
      );
    }
    setMessage(null);
    return maps;
  };

  const openCopy = (featured: FeaturedMap) =>
    void attempt(async () => {
      const slots = freeSlots(await store.listMaps(episode.id));
      const slot = slots.includes(featured.slot) ? featured.slot : slots[0];
      if (!slot) {
        setMessage("All 32 map slots are in use.");
        return;
      }
      const entry = createMapEntry(
        episode.id,
        slot,
        structuredClone(featured.map),
        { description: featured.blurb, par: featured.par },
      );
      await store.putMap(entry);
      await openMap(entry);
    });

  const createMap = async (form: MapDetails) => {
    const entry = createMapEntry(
      episode.id,
      form.slot,
      withComplevel(
        form.featured
          ? { ...structuredClone(form.featured.map), name: form.name }
          : mapFromTemplate(form.template, form.name),
        form.complevel,
      ),
      { description: form.description, par: form.par },
    );
    try {
      await store.putMap(entry);
    } catch (error) {
      await refresh(store, episode.id).catch(() => {});
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
        map: withComplevel({ ...entry.map, name: form.name }, form.complevel),
        editedAt: Date.now(),
      }));
      if (!saved) return "This map no longer exists.";
      announce(id);
      if (sessionRef.current?.id === id) setDetails(detailsOf(saved));
      else await refresh(store, saved.episodeId);
      return null;
    } catch (error) {
      return problemOf(error, form.slot);
    }
  };

  const openWads = async (picked: File[]) => {
    const run = ++wadRun.current;
    try {
      const files = await readGameFiles(picked);
      if (run !== wadRun.current) return;
      setMessage(null);
      setWadPick({
        title: (
          picked.find((file) => !/\.(deh|bex)$/i.test(file.name)) ?? picked[0]
        ).name.replace(/\.[^.]+$/, ""),
        summary: inspectWads(files),
      });
    } catch (error) {
      if (run !== wadRun.current) return;
      setMessage(
        error instanceof WadFileError
          ? `Couldn't play that WAD. ${error.message}`
          : "Couldn't open those files.",
      );
    }
  };

  const playFreedoom = () =>
    setWadPlay({
      title: "Freedoom: Phase 2",
      files: { wads: [], dehacked: [], complevel: "boom", warp: 1 },
      skill: "medium",
    });

  const importWadMaps = async (picked: File[]) => {
    const run = ++importRun.current;
    const episodeAt = episode.id;
    const label = picked.length === 1 ? picked[0].name : "those files";
    try {
      const files = (await readGameFiles(picked)).filter((file) =>
        isWad(file.data),
      );
      if (files.length === 0) {
        throw new WadFileError("Choose a map file, a WAD or a zip.");
      }
      const found = readMaps(files);
      const converted: ImportedMap[] = [];
      for (const [index, doom] of found.entries()) {
        setMessage(`Reading ${doom.slot}, ${index + 1} of ${found.length}…`);
        // Big WADs take a while, so the page gets a frame between maps.
        await new Promise((done) => setTimeout(done));
        if (run !== importRun.current) return;
        converted.push({ slot: doom.slot, ...decompileMap(doom) });
      }
      const slots = freeSlots(await store.listMaps(episodeAt));
      if (run !== importRun.current) return;
      if (slots.length === 0) {
        setMessage("All 32 map slots are in use.");
        return;
      }
      setMessage(null);
      setWadImport({
        episodeId: episodeAt,
        fileName:
          files.length === 1
            ? files[0].name
            : `${files[0].name} and ${files.length - 1} more`,
        maps: converted,
        slots,
      });
    } catch (error) {
      if (run !== importRun.current) return;
      setMessage(
        error instanceof WadFileError
          ? `Couldn't import ${label}. ${error.message}`
          : `Couldn't import ${label}.`,
      );
    }
  };

  const saveImported = async (
    fileName: string,
    picked: { map: GameMap; slot: string }[],
  ) => {
    setWadImport(null);
    const base = fileName.replace(/\.[^.]+( and \d+ more)?$/, "");
    const nameOf = (map: GameMap) =>
      /^MAP\d\d$/.test(map.name ?? "") ? `${base} ${map.name}` : map.name;
    try {
      for (const { map, slot } of picked) {
        await store.putMap(
          createMapEntry(episode.id, slot, { ...map, name: nameOf(map) }),
        );
      }
      announce();
      setMessage(
        picked.length === 1
          ? `${nameOf(picked[0].map)} was added as ${picked[0].slot}.`
          : `${picked.length} maps were added as ${picked[0].slot} to ${picked.at(-1)!.slot}.`,
      );
    } catch (error) {
      setMessage(
        isSlotConflict(error)
          ? "A slot was just taken. Try again."
          : "Couldn't save the imported maps.",
      );
    }
    await refresh(store, episode.id);
  };

  const importFiles = async (picked: File[]) => {
    const maps = picked.filter((file) => /\.json$/i.test(file.name));
    for (const file of maps) await importMap(file);
    const rest = picked.filter((file) => !maps.includes(file));
    if (rest.length > 0) await importWadMaps(rest);
  };

  const importMap = async (file: File) => {
    try {
      if (file.size > maxFileBytes) {
        throw new MapFileError("The file is too large.");
      }
      const map = parseMapFile(await file.text());
      const latest = await store.listMaps(episode.id);
      const slot = freeSlots(latest)[0];
      if (!slot) throw new MapFileError("All 32 map slots are in use.");
      const entry = createMapEntry(episode.id, slot, {
        ...map,
        name: map.name ?? file.name.replace(/\.json$/i, ""),
      });
      await store.putMap(entry);
      announce();
      setMessage(`${mapName(entry)} was added as ${slot}.`);
      await refresh(store, episode.id);
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

  const importEpisode = async (file: File) => {
    let backup;
    try {
      if (file.size > maxBackupBytes) {
        throw new MapFileError("The file is too large.");
      }
      backup = parseEpisodeBackup(await file.text());
    } catch (error) {
      setMessage(
        error instanceof MapFileError
          ? `Couldn't import ${file.name}. ${error.message}`
          : `Couldn't read ${file.name}.`,
      );
      return;
    }
    const { episode: imported, maps: importedMaps } = backup;
    await attempt(async () => {
      await store.addEpisode(imported, importedMaps);
      selectEpisode(imported.id);
      await refresh(store, imported.id);
      setMessage(`${imported.name} was imported.`);
    });
  };

  const buildEpisode = (fileName: string) => {
    const ordered = bySlot(maps);
    const problems = ordered.map((entry) => knownBuildProblem(entry));
    if (blockedOf(ordered, problems).length > 0)
      return "Fix the maps listed above first.";
    try {
      download(
        fileName,
        compileEpisode(
          ordered.map((entry) => ({ ...entry, lumps: knownLumps(entry) })),
        ).slice().buffer,
        "application/octet-stream",
      );
      setBuildingEpisode(null);
      return null;
    } catch (error) {
      return `Couldn't build the episode. ${(error as Error).message}`;
    }
  };

  const exportEpisode = () => {
    const broken = maps.filter((entry) => entry.broken);
    download(
      `${wadFileName(episode.name.toLowerCase()).replace(/\.wad$/, "")}-backup.json`,
      serializeEpisode(episode, maps),
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
        void refresh(store, session.episodeId)
          .then(() => setMapDialog(dialog))
          .catch(() => setMessage(saveFailure));
      });
    const current = maps.find((entry) => entry.id === session.id);
    return (
      <>
        <Editor
          key={session.id}
          initialMap={session.initialMap}
          mapName={details.name}
          slot={details.slot}
          par={details.par}
          saveStatus={store.durable ? saveStatus : "session"}
          onSave={onSave}
          watchExternal={watchExternal}
          onOpenEpisodes={() =>
            void whenSaved(() => {
              setView("episodes");
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
            name: episode.name,
            maps: bySlot(maps).map((entry) => ({
              id: entry.id,
              slot: entry.slot,
              name: mapName(entry),
              health: mapStatus(entry, knownBuildProblem(entry)).kind,
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
            <AlertDialogBackdrop />
            <AlertDialogContent className="w-[460px]">
              <AlertDialogTitle>
                Your latest changes aren't saved
              </AlertDialogTitle>
              <AlertDialogDescription>
                Your browser couldn't store them. Download the map to keep a
                copy before you leave.
              </AlertDialogDescription>
              <div className="flex flex-wrap justify-end gap-2">
                <Button onClick={() => setBlockedLeave(null)}>Stay here</Button>
                <Button
                  onClick={() => {
                    const leave = blockedLeave;
                    setBlockedLeave(null);
                    leave();
                  }}
                >
                  Leave without saving
                </Button>
                <Button
                  variant="primary"

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
                </Button>
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

  if (wadPlay) {
    return (
      <GameView
        map={null}
        files={wadPlay.files}
        title={wadPlay.title}
        slot={`MAP${String(wadPlay.files.warp).padStart(2, "0")}`}
        par={null}
        skill={wadPlay.skill}
        exit="maps"
        onExit={() => setWadPlay(null)}
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
          onPlayWad={(files) => void openWads(files)}
          onPlayFreedoom={playFreedoom}
          onOpenFreedoom={() =>
            sidebar.onCreateEpisode?.("Freedoom", "freedoom")
          }
          selectedId={featuredId}
          onSelect={setFeaturedId}
        />
        {wadPick ? (
          <WadPlayDialog
            title={wadPick.title}
            summary={wadPick.summary}
            onPlay={(files, skill) => {
              setWadPlay({ title: wadPick.title, files, skill });
              setWadPick(null);
            }}
            onClose={() => setWadPick(null)}
          />
        ) : null}
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
    <>
      {wadImport?.episodeId === episode.id ? (
        <WadImportDialog
          fileName={wadImport.fileName}
          maps={wadImport.maps}
          slots={wadImport.slots}
          onImport={(picked) => void saveImported(wadImport.fileName, picked)}
          onClose={() => setWadImport(null)}
        />
      ) : null}
      {buildingEpisode === episode.id ? (
        <EpisodeBuildDialog
          name={episode.name}
          maps={bySlot(maps)}
          onBuild={buildEpisode}
          onOpenMap={(entry) => {
            setBuildingEpisode(null);
            void openMap(entry);
          }}
          onClose={() => setBuildingEpisode(null)}
        />
      ) : null}
      <EpisodeHome
        sidebar={sidebar}
        episode={episode}
        maps={maps}
        message={message}
        onRenameEpisode={(name) =>
          void attempt(async () => {
            await store.putEpisode({ ...episode, name });
            await refresh(store, episodeIdRef.current);
          })
        }
        onDeleteEpisode={() =>
          void attempt(async () => {
            await store.deleteEpisode(episode.id);
            const [next] = await store.listEpisodes();
            selectEpisode(next.id);
            await store.setSetting(lastEpisodeKey, next.id);
            await refresh(store, next.id);
          })
        }
        onExportEpisode={exportEpisode}
        onImportEpisode={(file) => void importEpisode(file)}
        onImportFiles={(files) => void importFiles(files)}
        onBuildEpisode={() => setBuildingEpisode(episode.id)}
        onPlayEpisode={() => void playEpisode(maps)}
        onOpenMap={(entry) => void openMap(entry)}
        onCreateMap={createMap}
        onUpdateMap={(entry, form) => updateMap(entry.id, form)}
        onDuplicateMap={(entry) =>
          void attempt(async () => {
            const latest = await store.listMaps(entry.episodeId);
            const slot = freeSlots(latest)[0];
            if (!slot) {
              setMessage("All 32 map slots are in use.");
              return;
            }
            await store.putMap(
              createMapEntry(
                entry.episodeId,
                slot,
                {
                  ...structuredClone(entry.map),
                  name: `${mapName(entry)} copy`,
                },
                { description: entry.description, par: entry.par },
              ),
            );
            await refresh(store, entry.episodeId);
          })
        }
        onReorderMaps={(order) =>
          attempt(async () => {
            await store.moveMaps(slotMoves(maps, order));
            await refresh(store, episodeIdRef.current);
          })
        }
        onDeleteMap={(entry) =>
          void attempt(async () => {
            await store.deleteMap(entry.id);
            announce(entry.id);
            await refresh(store, entry.episodeId);
          })
        }
      />
    </>
  );
}

export { EpisodeApp };
