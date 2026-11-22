"use client";

import { diffMaps, getIsEmptyPatch, type MapPatch } from "@rooms/map-patch";
import * as React from "react";

import type { GameFiles, Skill } from "@/lib/engine/runtime";
import type { GameMap } from "@/lib/map/types";

import { SidebarDrawer, type SidebarProps } from "@/components/app-sidebar";
import { wadFileName } from "@/components/editor/build-dialog";
import { EditorScreen } from "@/components/editor/editor-screen";
import { GameView, type Level } from "@/components/play/play-panel";
import { type HostedGame, PlayTogether } from "@/components/play/play-together";
import { Alert } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useBuildChecks } from "@/hooks/use-build-checks";
import { useIwad } from "@/hooks/use-iwad";
import { clearPlaytest } from "@/lib/editor/playtests";
import { loadName } from "@/lib/engine/coop";
import {
  defaultGame,
  engineSlot,
  type GameInfo,
  getIsMapLump,
  indexSlot,
  lumpSlotIndex,
  slotCount,
  slotName,
} from "@/lib/engine/game";
import {
  addResource,
  adoptOwnIwad,
  identifyIwad,
  type Iwad,
  loadIwad,
  removeResource,
  restoreBundledIwad,
  texturesOf,
} from "@/lib/engine/iwad";
import {
  type AddedTextures,
  addTextureFiles,
} from "@/lib/engine/texture-files";
import {
  checkBuild,
  knownBuildProblem,
  knownLumps,
} from "@/lib/episodes/build-checks";
import {
  cloudBase,
  createCloudApi,
  sharedTarget,
  syncMap,
} from "@/lib/episodes/cloud";
import {
  bySlot,
  createEpisode,
  createMapEntry,
  createMapSaver,
  type Episode,
  type EpisodeMap,
  episodeMaps,
  type EpisodeStore,
  freeSlots,
  getIsSlotConflict,
  lastEpisodeKey,
  lastMapKey,
  levelDetails,
  mapFromTemplate,
  mapName,
  mapSlots,
  mapStatus,
  maxBackupBytes,
  parseEpisodeBackup,
  prepareEpisodes,
  serializeEpisode,
  slotMoves,
  withComplevel,
} from "@/lib/episodes/episode-data";
import {
  createMemoryStore,
  openEpisodeStore,
} from "@/lib/episodes/episode-store";
import {
  type LiveMap,
  type LivePeer,
  liveUrl,
  openLiveMap,
} from "@/lib/episodes/live";
import {
  findEpisode,
  parseRoute,
  pathOf,
  type Route,
} from "@/lib/episodes/routes";
import { type FeaturedMap, featuredMaps } from "@/lib/map/featured";
import {
  MapFileError,
  maxFileBytes,
  parseMapFile,
  serializeMap,
} from "@/lib/map/storage";
import { type CheckContext, validateMap } from "@/lib/map/validate";
import { readWadAssets } from "@/lib/wad/assets";
import { compileEpisode, compileMap } from "@/lib/wad/compile";
import { decompileMap } from "@/lib/wad/decompile";
import {
  type GameFile,
  getIsWad,
  inspectWads,
  readLumps,
  WadFileError,
  type WadSummary,
} from "@/lib/wad/inspect";
import { readMaps } from "@/lib/wad/read-map";
import { getHasTextures } from "@/lib/wad/resources";
import { getIsZip, unzip } from "@/lib/wad/zip";

import { EpisodeBuildDialog } from "./episode-build-dialog";
import { EpisodeHome } from "./episode-home";
import { FeaturedMaps } from "./featured-maps";
import { type MapDetails, MapDialog } from "./map-dialog";
import { ResourcesDialog } from "./resources-dialog";
import { ShareDialog } from "./share-dialog";
import { type ImportedMap, WadImportDialog } from "./wad-import-dialog";
import { WadPlayDialog } from "./wad-play-dialog";

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
  music?: string;
  sky?: string;
  intertext?: string;
}
type SaveStatus = "saving" | "saved" | "failed";
type HomeView = "episodes" | "featured";

const channelName = "wadsmith";
const cloudDelayMs = 1500;
// How long a dropped live link waits before trying again.
const reconnectMs = 3000;
const cloudUrl = cloudBase();
const cloudApi = cloudUrl ? createCloudApi(cloudUrl) : null;
const saveFailure = "Your browser couldn't save that change.";

let preparing: ReturnType<typeof openPreparedStore> | null = null;

export function EpisodeScreen() {
  const [store, setStore] = React.useState<EpisodeStore | null>(null);
  const [episodes, setEpisodes] = React.useState<Episode[]>([]);
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [episodeId, setEpisodeId] = React.useState("");
  const [maps, setMaps] = React.useState<EpisodeMap[]>([]);
  const [session, setSession] = React.useState<Session | null>(null);
  // Only the editor's map switcher shows them; the home page's rows check their own.
  const checks = useBuildChecks(session ? maps : []);
  const [details, setDetails] = React.useState<SessionDetails | null>(null);
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("saved");
  const [message, setMessage] = React.useState<string | null>(null);
  const iwad = useIwad();
  const game = iwad?.game ?? defaultGame;
  // The game's own texture names, so the checks and the importer know what
  // it has.
  const names = React.useMemo(
    () =>
      iwad
        ? readWadAssets(iwad.data, texturesOf(iwad).resources).names
        : undefined,
    [iwad],
  );
  const context = React.useMemo<CheckContext>(
    () => ({ game: iwad?.game, names }),
    [iwad, names],
  );
  const currentContext = React.useEffectEvent(() => context);
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
    // The imported WADs that carry textures of their own.
    textures: GameFile[];
  } | null>(null);
  const [texturesOpen, setTexturesOpen] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
  const [cloudProblem, setCloudProblem] = React.useState<string | null>(null);
  const [clash, setClash] = React.useState<{
    revision: number;
    map: GameMap;
  } | null>(null);
  // A wait before each map's next sync, so a burst of edits goes as one.
  const live = React.useRef<{ mapId: string; link: LiveMap } | null>(null);
  const remoteListeners = React.useRef(new Set<(patch: MapPatch) => void>());
  const [peers, setPeers] = React.useState<LivePeer[]>([]);
  const cloudTimers = React.useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
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
      live.current?.link.close();
      live.current = null;
      setPeers([]);
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

  const stopLive = React.useCallback(() => {
    live.current?.link.close();
    live.current = null;
    setPeers([]);
  }, []);
  // The live link's steps, which need the sync loop declared after them.
  const cloudSteps = React.useRef({
    goLive: (_active: EpisodeStore, _mapId: string) => {},
    settle: (_active: EpisodeStore, _mapId: string) => {},
  });

  // Brings a map and its online copy together: sends edits made here, takes a
  // newer copy when nothing here clashes with it, and otherwise asks. It runs
  // for the map it was asked about even once another map is open, so a push
  // that lands after leaving still records its revision.
  const runCloudSync = React.useCallback(
    async (active: EpisodeStore, mapId: string) => {
      if (!cloudApi) return;
      const opened = () =>
        sessionRef.current?.id === mapId ? sessionRef.current : null;
      await opened()?.saver.flush();
      const entry = await active.getMap(mapId);
      if (!entry?.cloud || entry.broken) return;
      let outcome: Awaited<ReturnType<typeof syncMap>>;
      try {
        outcome = await syncMap(cloudApi, entry.cloud, entry.map);
      } catch (error) {
        if (opened()) setCloudProblem((error as Error).message);
        return;
      }
      if (opened()) setCloudProblem(null);
      if (outcome.kind === "same") {
        cloudSteps.current.goLive(active, mapId);
        return;
      }
      if (outcome.kind === "conflict") {
        // A map that isn't open asks when it next opens.
        if (opened())
          setClash({ revision: outcome.revision, map: outcome.map });
        return;
      }
      if (outcome.kind === "pushed") {
        // Edits made while the copy was on its way scheduled a sync of their
        // own, which runs next and sends them.
        const settled = await active.updateMap(mapId, (latest) =>
          // A map no longer kept online stays that way.
          latest.cloud?.id === entry.cloud?.id
            ? {
                ...latest,
                cloud:
                  latest.mapRevision === entry.mapRevision
                    ? outcome.link
                    : { ...outcome.link, pending: true },
              }
            : latest,
        );
        if (settled?.cloud && !settled.cloud.pending) {
          cloudSteps.current.goLive(active, mapId);
        }
        return;
      }
      const pulled = await active.updateMap(mapId, (latest) =>
        latest.cloud?.pending || latest.cloud?.id !== entry.cloud?.id
          ? latest
          : {
              ...latest,
              map: outcome.map,
              mapRevision: latest.mapRevision + 1,
              editedAt: Date.now(),
              cloud: outcome.link,
            },
      );
      if (!pulled) return;
      const current = opened();
      if (pulled.cloud?.pending) {
        if (current) {
          setClash({ revision: outcome.link.revision, map: outcome.map });
        }
        return;
      }
      announce(mapId);
      if (!current) return;
      current.saver.adopt(pulled);
      setDetails(detailsOf(pulled));
      for (const listener of externalListeners.current) listener(pulled.map);
      cloudSteps.current.goLive(active, mapId);
    },
    [announce],
  );
  const cloudQueue = React.useRef<Promise<void>>(Promise.resolve());
  const syncCloud = React.useCallback(
    (active: EpisodeStore, mapId: string) => {
      cloudQueue.current = cloudQueue.current
        .then(() => runCloudSync(active, mapId))
        .catch(() => {});
      return cloudQueue.current;
    },
    [runCloudSync],
  );

  React.useEffect(() => {
    // Records that the online copy holds everything this browser has, once
    // the live link has nothing on its way.
    const settle = (active: EpisodeStore, mapId: string) => {
      const link = live.current?.mapId === mapId ? live.current.link : null;
      if (!link?.idle) return;
      const { revision, map } = link;
      void active
        .updateMap(mapId, (latest) =>
          latest.cloud && getIsEmptyPatch(diffMaps(map, latest.map))
            ? {
                ...latest,
                cloud: { ...latest.cloud, revision, pending: undefined },
              }
            : latest,
        )
        .catch(() => {});
    };
    // Opens the live link for the open map once it agrees with its online
    // copy, so the link starts from the same map the server holds.
    const goLive = (active: EpisodeStore, mapId: string) => {
      const current = sessionRef.current;
      if (!cloudUrl || current?.id !== mapId || live.current?.mapId === mapId) {
        return;
      }
      void active.getMap(mapId).then((entry) => {
        const secret = entry?.cloud?.secret;
        if (
          !entry?.cloud ||
          !secret ||
          entry.cloud.pending ||
          sessionRef.current !== current ||
          live.current?.mapId === mapId
        ) {
          return;
        }
        stopLive();
        const link = openLiveMap({
          url: liveUrl(cloudUrl, entry.cloud.id),
          secret,
          name: loadName(),
          map: entry.map,
          onRemote: (patch) => {
            for (const listener of remoteListeners.current) listener(patch);
          },
          // A whole map saved elsewhere is read again before going live anew.
          onReload: () => {
            stopLive();
            void syncCloud(active, mapId);
          },
          onPeers: setPeers,
          onIdle: () => settle(active, mapId),
          onClosed: (refused) => {
            if (live.current?.link !== link) return;
            live.current = null;
            setPeers([]);
            if (refused) {
              setCloudProblem("This link can no longer edit the map.");
              return;
            }
            setTimeout(() => {
              if (sessionRef.current === current) {
                void syncCloud(active, mapId);
              }
            }, reconnectMs);
          },
        });
        live.current = { mapId, link };
      });
    };
    cloudSteps.current = { goLive, settle };
  });

  const startSession = React.useCallback(
    (active: EpisodeStore, entry: EpisodeMap) => {
      const saver = createMapSaver(active, entry, {
        onStatus: setSaveStatus,
        onSaved: (saved) => {
          announce(saved.id);
          if (!saved.cloud) return;
          const linked = live.current;
          if (linked?.mapId === saved.id) {
            linked.link.send(saved.map);
            cloudSteps.current.settle(active, saved.id);
            return;
          }
          const timers = cloudTimers.current;
          clearTimeout(timers.get(saved.id));
          timers.set(
            saved.id,
            setTimeout(() => {
              timers.delete(saved.id);
              void syncCloud(active, saved.id);
            }, cloudDelayMs),
          );
        },
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
      setClash(null);
      setCloudProblem(null);
      live.current?.link.close();
      live.current = null;
      setPeers([]);
      selectEpisode(entry.episodeId);
      if (entry.cloud) void syncCloud(active, entry.id);
    },
    [announce, closeSession, selectEpisode, syncCloud],
  );

  // Another device may have changed the copy while this tab was away, and a
  // connection that came back can send what waited.
  React.useEffect(() => {
    if (!store) return;
    const resume = () => {
      const open = sessionRef.current;
      if (open && document.visibilityState === "visible") {
        void syncCloud(store, open.id);
      }
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [store, syncCloud]);

  React.useEffect(() => {
    let cancelled = false;
    let run = routeRun.current;
    const stale = () => cancelled || run !== routeRun.current;
    preparing ??= openPreparedStore();
    preparing
      .then(async ({ store: opened, ready }) => {
        if (cancelled) return;
        run = ++routeRun.current;
        const shared = sharedTarget(location.pathname, location.hash);
        // The secret stays out of the address bar and history once read.
        if (shared) history.replaceState(null, "", location.pathname);
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
        if (shared) {
          const found_ = await openShared(
            opened,
            shared,
            wanted,
            currentContext().game,
          );
          if (stale()) return;
          if (typeof found_ === "string") setMessage(found_);
          else {
            await refresh(opened, found_.episodeId);
            if (stale()) return;
            startSession(opened, found_);
          }
        } else if (missing) {
          setMessage(
            "That episode isn't in this browser. Episodes are saved per browser, so import its backup to bring it here.",
          );
        } else if (route.kind === "home" && badSlot) {
          setMessage(
            `That isn't a map slot. Slots run from MAP01 to ${mapSlots.at(-1)}.`,
          );
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
          const started = await episodeGame(
            await opened.listMaps(route.id),
            currentContext(),
          );
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
    const started = await episodeGame(list, context);
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

  const watchRemote = React.useCallback(
    (listener: (patch: MapPatch) => void) => {
      remoteListeners.current.add(listener);
      return () => {
        remoteListeners.current.delete(listener);
      };
    },
    [],
  );

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
    game,
    onNavigate: (route) => void routeTo(route),
    onCreateEpisode: (name, start) => {
      const created = createEpisode(name);
      void attempt(async () => {
        const maps =
          start === "freedoom"
            ? await gameMaps(created.id)
            : episodeMaps(created.id, start);
        if (!maps) return;
        await store.addEpisode(created, maps);
        await store.setSetting(lastEpisodeKey, created.id);
        await routeTo({ kind: "episode", id: created.id });
      });
    },
  };

  const gameMaps = async (episodeId: string) => {
    const run = ++importRun.current;
    setMessage(`Loading ${game.label}…`);
    let loaded: Iwad;
    try {
      loaded = await loadIwad();
    } catch {
      if (run === importRun.current) {
        setMessage(
          `Couldn't load ${game.label}. Check your connection and try again.`,
        );
      }
      return null;
    }
    const found = readMaps([{ name: loaded.game.file, data: loaded.data }]);
    const maps: EpisodeMap[] = [];
    for (const [index, doom] of found.entries()) {
      setMessage(`Reading ${doom.slot}, ${index + 1} of ${found.length}…`);
      await new Promise((done) => setTimeout(done));
      if (run !== importRun.current) return null;
      // A Doom 1 game's E2M1 takes the editor's tenth slot, and maps past
      // the game's last slot have nowhere to go.
      const slot = lumpSlotIndex(doom.slot) ?? index + 1;
      if (slot > slotCount(loaded.game)) continue;
      maps.push(
        createMapEntry(
          episodeId,
          indexSlot(slot),
          decompileMap(doom, names).map,
          {
            description: `A level from ${loaded.game.label}.`,
          },
        ),
      );
    }
    setMessage(null);
    return maps;
  };

  const openCopy = (featured: FeaturedMap) =>
    void attempt(async () => {
      const slots = freeSlots(
        await store.listMaps(episode.id),
        undefined,
        game,
      );
      const slot = slots.includes(featured.slot) ? featured.slot : slots[0];
      if (!slot) {
        setMessage(`All ${slotCount(game)} map slots are in use.`);
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
      form,
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
      const saved = await store.updateMap(id, (entry) => {
        const { music, sky, intertext, ...rest } = entry;
        void music;
        void sky;
        void intertext;
        return {
          ...rest,
          slot: form.slot,
          ...levelDetails(form),
          map: withComplevel({ ...entry.map, name: form.name }, form.complevel),
          editedAt: Date.now(),
          ...(entry.cloud && { cloud: { ...entry.cloud, pending: true } }),
        };
      });
      if (!saved) return "This map no longer exists.";
      announce(id);
      if (saved.cloud) void syncCloud(store, id);
      if (sessionRef.current?.id === id) setDetails(detailsOf(saved));
      else await refresh(store, saved.episodeId);
      return null;
    } catch (error) {
      return problemOf(error, form.slot);
    }
  };

  const setPar = async (id: string, par: number) => {
    const saved = await store
      .updateMap(id, (entry) => ({ ...entry, par, editedAt: Date.now() }))
      .catch(() => null);
    if (!saved) return;
    announce(id);
    if (sessionRef.current?.id === id) setDetails(detailsOf(saved));
  };

  const adoptIwad = async (file: File) => {
    try {
      const next = await adoptOwnIwad(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      );
      setMessage(
        `${next.label} is the game now. Its textures, sprites and levels stand in for Freedoom's, and the file stays in this browser.`,
      );
    } catch (error) {
      setMessage(
        error instanceof WadFileError
          ? `Couldn't use ${file.name}. ${error.message}`
          : `Couldn't read ${file.name}.`,
      );
    }
  };

  const addTextures = async (files: File[]) => {
    try {
      setMessage(texturesMessage(await addTextureFiles(files)));
    } catch {
      setMessage("Couldn't add those textures.");
    }
  };

  // A WAD that is already a resource, by name and size, isn't added twice.
  const keepTextures = async (files: GameFile[]) => {
    const known = iwad?.resources ?? [];
    const added: string[] = [];
    for (const file of files) {
      if (
        known.some(
          (resource) =>
            resource.name === file.name &&
            resource.data.length === file.data.length,
        )
      ) {
        continue;
      }
      await addResource(file.name, file.data);
      added.push(file.name);
    }
    return added;
  };

  const dropIwad = async () => {
    try {
      await restoreBundledIwad();
      setMessage("Freedoom is the game again.");
    } catch {
      setMessage("Couldn't put your IWAD away.");
    }
  };

  const openWads = async (picked: File[]) => {
    const run = ++wadRun.current;
    if (picked.length === 1 && (await getIsIwad(picked[0]))) {
      await adoptIwad(picked[0]);
      return;
    }
    try {
      const files = await readGameFiles(picked);
      if (run !== wadRun.current) return;
      setMessage(null);
      setWadPick({
        title: (
          picked.find((file) => !/\.(deh|bex)$/i.test(file.name)) ?? picked[0]
        ).name.replace(/\.[^.]+$/, ""),
        summary: inspectWads(files, game),
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

  // Freedoom's levels lean on Boom; the original games were made for vanilla.
  const playGame = () =>
    setWadPlay({
      title: game.label,
      files: {
        wads: [],
        dehacked: [],
        complevel: game.id.startsWith("freedoom") ? "boom" : "vanilla",
        warp: 1,
      },
      skill: "medium",
    });

  const importWadMaps = async (picked: File[]) => {
    const run = ++importRun.current;
    const episodeAt = episode.id;
    const label = picked.length === 1 ? picked[0].name : "those files";
    try {
      const files = (await readGameFiles(picked)).filter((file) =>
        getIsWad(file.data),
      );
      if (files.length === 0) {
        throw new WadFileError("Choose a map file, a WAD or a zip.");
      }
      const textures = files.filter(getHasOwnTextures);
      // A WAD of textures with no maps in it is a resource, not an import.
      if (textures.length > 0 && !files.some(getHasMaps)) {
        const added = await keepTextures(textures);
        if (run !== importRun.current) return;
        setMessage(
          added.length > 0
            ? `${added.join(", ")} ${added.length === 1 ? "was" : "were"} added to the textures. The texture picker lists what's in ${added.length === 1 ? "it" : "them"} under Custom.`
            : "Those textures were already added.",
        );
        return;
      }
      // The maps are read with their own textures in reach, so walls keep
      // the names the WAD gave them.
      const importNames =
        textures.length > 0 && iwad
          ? readWadAssets(iwad.data, [
              ...texturesOf(iwad).resources,
              ...textures.map((file) => file.data),
            ]).names
          : names;
      const found = readMaps(files);
      const converted: ImportedMap[] = [];
      for (const [index, doom] of found.entries()) {
        setMessage(`Reading ${doom.slot}, ${index + 1} of ${found.length}…`);
        // Big WADs take a while, so the page gets a frame between maps.
        await new Promise((done) => setTimeout(done));
        if (run !== importRun.current) return;
        converted.push({ slot: doom.slot, ...decompileMap(doom, importNames) });
      }
      const slots = freeSlots(await store.listMaps(episodeAt), undefined, game);
      if (run !== importRun.current) return;
      if (slots.length === 0) {
        setMessage(`All ${slotCount(game)} map slots are in use.`);
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
        textures,
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
    textures: GameFile[],
  ) => {
    setWadImport(null);
    const base = fileName.replace(/\.[^.]+( and \d+ more)?$/, "");
    const nameOf = (map: GameMap) =>
      /^MAP\d\d$/.test(map.name ?? "") ? `${base} ${map.name}` : map.name;
    try {
      await keepTextures(textures);
      for (const { map, slot } of picked) {
        await store.putMap(
          createMapEntry(episode.id, slot, { ...map, name: nameOf(map) }),
        );
      }
      announce();
      setMessage(
        picked.length === 1
          ? `${nameOf(picked[0].map)} was added as ${picked[0].slot}.`
          : `${picked.length} maps were added as ${picked[0].slot} to ${picked[picked.length - 1].slot}.`,
      );
    } catch (error) {
      setMessage(
        getIsSlotConflict(error)
          ? "A slot was just taken. Try again."
          : "Couldn't save the imported maps.",
      );
    }
    await refresh(store, episode.id);
  };

  const importFiles = async (picked: File[]) => {
    const maps = picked.filter((file) => /\.json$/i.test(file.name));
    for (const file of maps) await importMap(file);
    const images = picked.filter(getIsImage);
    if (images.length > 0) await addTextures(images);
    const rest: File[] = [];
    for (const file of picked) {
      if (maps.includes(file) || images.includes(file)) continue;
      if (await getIsIwad(file)) await adoptIwad(file);
      else rest.push(file);
    }
    if (rest.length > 0) await importWadMaps(rest);
  };

  const importMap = async (file: File) => {
    try {
      if (file.size > maxFileBytes) {
        throw new MapFileError("The file is too large.");
      }
      const map = parseMapFile(await file.text());
      const latest = await store.listMaps(episode.id);
      const slot = freeSlots(latest, undefined, game)[0];
      if (!slot)
        throw new MapFileError(`All ${slotCount(game)} map slots are in use.`);
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
          : getIsSlotConflict(error)
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
    if (blockedOf(ordered, problems, context).length > 0)
      return "Fix the maps listed above first.";
    try {
      download(
        fileName,
        compileEpisode(
          ordered.map((entry) => ({
            ...entry,
            slot: engineSlot(entry.slot, game),
            lumps: knownLumps(entry),
          })),
          game,
          iwad ? texturesOf(iwad) : undefined,
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
        <EditorScreen
          key={session.id}
          initialMap={session.initialMap}
          mapName={details.name}
          slot={details.slot}
          par={details.par}
          music={details.music}
          sky={details.sky}
          intertext={details.intertext}
          saveStatus={store.durable ? saveStatus : "session"}
          onSave={onSave}
          watchExternal={watchExternal}
          watchRemote={watchRemote}
          peers={peers}
          onPointer={(at) => live.current?.link.cursor(at)}
          onOpenEpisodes={() =>
            void whenSaved(() => {
              setView("episodes");
              void closeSession(store);
            })
          }
          navigation={<SidebarDrawer {...sidebar} />}
          onNewMap={() => openDialog("new")}
          onMapSettings={() => openDialog("settings")}
          onShare={cloudApi ? () => setSharing(true) : undefined}
          onParChange={(par) => void setPar(session.id, par)}
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
              health: mapStatus(entry, checks.problem(entry), context).kind,
            })),
            currentId: session.id,
            canAddMap: freeSlots(maps, undefined, game).length > 0,
            onOpenMap: (id) => {
              const entry = maps.find((item) => item.id === id);
              if (entry) void whenSaved(() => void openMap(entry));
            },
          }}
        />
        {mapDialog === "new" ? (
          <MapDialog
            maps={maps}
            game={game}
            onClose={() => setMapDialog(null)}
            onSubmit={createMap}
          />
        ) : null}
        {sharing && current ? (
          <ShareDialog
            name={details.name}
            link={current.cloud ?? null}
            problem={cloudProblem}
            onShare={async () => {
              if (!cloudApi) return;
              await session.saver.flush();
              const latest = await store.getMap(session.id);
              if (!latest) throw new Error("This map no longer exists.");
              const made = await cloudApi.create(latest.map);
              await store.updateMap(session.id, (entry) => ({
                ...entry,
                // Edits made while the copy was made still have to follow.
                cloud: {
                  ...made,
                  ...(entry.mapRevision !== latest.mapRevision && {
                    pending: true,
                  }),
                },
              }));
              announce(session.id);
              await refresh(store, session.episodeId);
              void syncCloud(store, session.id);
            }}
            onStop={() =>
              void attempt(async () => {
                await store.updateMap(session.id, (entry) => ({
                  ...entry,
                  cloud: undefined,
                }));
                setCloudProblem(null);
                setClash(null);
                await refresh(store, session.episodeId);
              })
            }
            onClose={() => setSharing(false)}
          />
        ) : null}
        {clash ? (
          <AlertDialog open>
            <AlertDialogBackdrop />
            <AlertDialogContent className="w-115">
              <AlertDialogTitle>
                This map changed on another device
              </AlertDialogTitle>
              <AlertDialogDescription>
                It was edited there and here since this browser last saw the
                online copy. Keep one version; the other is replaced.
              </AlertDialogDescription>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  onClick={() => {
                    const theirs = clash;
                    setClash(null);
                    void attempt(async () => {
                      const saved = await store.updateMap(
                        session.id,
                        (entry) => ({
                          ...entry,
                          map: theirs.map,
                          mapRevision: entry.mapRevision + 1,
                          editedAt: Date.now(),
                          cloud: entry.cloud && {
                            ...entry.cloud,
                            revision: theirs.revision,
                            pending: undefined,
                          },
                        }),
                      );
                      if (!saved) return;
                      announce(saved.id);
                      if (sessionRef.current?.id !== saved.id) return;
                      session.saver.adopt(saved);
                      setDetails(detailsOf(saved));
                      for (const listener of externalListeners.current) {
                        listener(saved.map);
                      }
                    });
                  }}
                >
                  Use the other device's
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    const theirs = clash;
                    setClash(null);
                    void attempt(async () => {
                      await store.updateMap(session.id, (entry) => ({
                        ...entry,
                        cloud: entry.cloud && {
                          ...entry.cloud,
                          revision: theirs.revision,
                          pending: true,
                        },
                      }));
                      await syncCloud(store, session.id);
                    });
                  }}
                >
                  Keep this one
                </Button>
              </div>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
        {mapDialog === "settings" && current ? (
          <MapDialog
            maps={maps}
            entry={current}
            game={game}
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
            <AlertDialogContent className="w-115">
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
        slot={slotName(wadPlay.files.warp, game.episodes > 0)}
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
          onPlayGame={playGame}
          onOpenGame={() => sidebar.onCreateEpisode?.(game.label, "freedoom")}
          game={game}
          ownIwad={iwad?.own ?? false}
          onUseIwad={(file) => void adoptIwad(file)}
          onUseBundledIwad={() => void dropIwad()}
          resources={iwad?.resources.length ?? 0}
          onOpenTextures={() => setTexturesOpen(true)}
          selectedId={featuredId}
          onSelect={setFeaturedId}
        />
        {texturesOpen ? (
          <ResourcesDialog
            resources={iwad?.resources ?? []}
            onAdd={(files) => void addTextures(files)}
            onRemove={(id) => void removeResource(id)}
            onClose={() => setTexturesOpen(false)}
          />
        ) : null}
        {wadPick ? (
          <WadPlayDialog
            title={wadPick.title}
            summary={wadPick.summary}
            game={game}
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
          game={game}
          onImport={(picked) =>
            void saveImported(wadImport.fileName, picked, wadImport.textures)
          }
          onClose={() => setWadImport(null)}
        />
      ) : null}
      {buildingEpisode === episode.id ? (
        <EpisodeBuildDialog
          name={episode.name}
          maps={bySlot(maps)}
          game={game}
          context={context}
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
        game={game}
        context={context}
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
            for (const entry of maps) void forgetPlaytest(entry.id);
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
            const slot = freeSlots(latest, undefined, game)[0];
            if (!slot) {
              setMessage(`All ${slotCount(game)} map slots are in use.`);
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
                entry,
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
            void forgetPlaytest(entry.id);
            announce(entry.id);
            await refresh(store, entry.episodeId);
          })
        }
      />
    </>
  );
}

async function openPreparedStore() {
  try {
    return await prepared(await openEpisodeStore());
  } catch {
    return prepared(createMemoryStore());
  }
}

async function prepared(store: EpisodeStore) {
  return { store, ready: await prepareEpisodes(store) };
}

function viewOfPath(): HomeView {
  return parseRoute(location.pathname).kind === "featured"
    ? "featured"
    : "episodes";
}

function knownFeatured(id: string | undefined) {
  return id !== undefined && featuredMaps.some((item) => item.id === id)
    ? id
    : null;
}

// A deleted map's last playtest goes with it.
function forgetPlaytest(mapId: string) {
  return clearPlaytest(mapId).catch(() => undefined);
}

function detailsOf(entry: EpisodeMap): SessionDetails {
  return {
    name: mapName(entry),
    slot: entry.slot,
    par: entry.par,
    music: entry.music,
    sky: entry.sky,
    intertext: entry.intertext,
  };
}

// A co-op game can't survive a reload, so its history entry is marked.
function coopEntry() {
  return Boolean((history.state as { coop?: boolean } | null)?.coop);
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

async function episodeGame(list: EpisodeMap[], context: CheckContext) {
  const ordered = bySlot(list);
  if (ordered.length === 0) return null;
  const problems = await Promise.all(
    ordered.map((entry) =>
      entry.broken ? Promise.resolve(null) : checkBuild(entry),
    ),
  );
  const blocked = blockedOf(ordered, problems, context);
  return blocked.length > 0
    ? { problem: `Fix ${blocked.join(", ")} before playing.`, levels: [] }
    : { problem: null, levels: levelsOf(ordered) };
}

function blockedOf(
  ordered: EpisodeMap[],
  problems: (string | null | undefined)[],
  context: CheckContext,
) {
  return ordered
    .filter(
      (entry, index) =>
        mapStatus(entry, problems[index], context).kind === "error",
    )
    .map((entry) => entry.slot);
}

function levelsOf(ordered: EpisodeMap[]): Level[] {
  return ordered.map((entry) => ({
    map: entry.map,
    title: mapName(entry),
    slot: entry.slot,
    par: entry.par,
    music: entry.music,
    sky: entry.sky,
    intertext: entry.intertext,
    lumps: knownLumps(entry),
  }));
}

// The map a shared link names: the one this browser already keeps for it, or
// a new one in the episode last open. An edit link keeps the new map tied to
// the online copy, and a view link makes a copy of its own.
async function openShared(
  store: EpisodeStore,
  target: { id: string; secret?: string },
  episodeId: string,
  game?: GameInfo,
): Promise<EpisodeMap | string> {
  if (!cloudApi) return "This copy of Wadsmith has no server for online maps.";
  for (const episode of await store.listEpisodes()) {
    const known = (await store.listMaps(episode.id)).find(
      (entry) => entry.cloud?.id === target.id && !entry.broken,
    );
    if (!known) continue;
    if (!target.secret || known.cloud?.secret === target.secret) return known;
    if (known.cloud?.secret) continue;
    const upgraded = await store.updateMap(known.id, (entry) => ({
      ...entry,
      cloud: entry.cloud && { ...entry.cloud, secret: target.secret },
    }));
    return upgraded ?? "That map couldn't be opened.";
  }
  let online: Awaited<ReturnType<typeof cloudApi.read>>;
  try {
    online = await cloudApi.read(target.id);
  } catch (error) {
    return (error as Error).message;
  }
  if (!online) return "That shared map no longer exists.";
  const [slot] = freeSlots(await store.listMaps(episodeId), undefined, game);
  if (!slot) {
    return "This episode has no free slot for the shared map. Open another episode and try the link again.";
  }
  const entry = {
    ...createMapEntry(episodeId, slot, online.map),
    ...(target.secret && {
      cloud: {
        id: target.id,
        secret: target.secret,
        revision: online.revision,
      },
    }),
  };
  await store.putMap(entry);
  return entry;
}

function soloFeatured(id: string | undefined) {
  const entry = featuredMaps.find((item) => item.id === id);
  return entry && entry.mode !== "deathmatch" ? entry : null;
}

function problemOf(error: unknown, slot: string) {
  return getIsSlotConflict(error) ? `${slot} is already in use.` : saveFailure;
}

// A game IWAD becomes the game rather than something to play or import.
async function getIsIwad(file: File) {
  if (!/\.wad$/i.test(file.name)) return false;
  try {
    identifyIwad(file.name, new Uint8Array(await file.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

function getIsImage(file: File) {
  return (
    file.type.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)
  );
}

function getHasMaps(file: GameFile) {
  try {
    return readLumps(file).some((lump) => getIsMapLump(lump.name));
  } catch {
    return false;
  }
}

function getHasOwnTextures(file: GameFile) {
  try {
    return getHasTextures(file.data);
  } catch {
    return false;
  }
}

function texturesMessage({
  images,
  flats,
  holed,
  wads,
  skipped,
}: AddedTextures) {
  const parts: string[] = [];
  const open = images.filter(
    (name) => holed.includes(name) && !flats.includes(name),
  );
  const listed = images.filter((name) => !open.includes(name));
  if (listed.length > 0) {
    parts.push(
      `${listed.join(", ")} ${listed.length === 1 ? "is" : "are"} in the texture picker under Custom.`,
    );
  }
  if (open.length > 0) {
    parts.push(
      `${open.join(", ")} ${open.length === 1 ? "has see-through parts, so it is" : "have see-through parts, so they are"} offered for open lines only.`,
    );
  }
  if (wads.length > 0) {
    parts.push(
      `${wads.join(", ")} ${wads.length === 1 ? "was" : "were"} added to the textures.`,
    );
  }
  for (const { name, reason } of skipped) {
    parts.push(`${name} was left out. ${reason}`);
  }
  return parts.join(" ") || "There was nothing to add.";
}

async function readGameFiles(picked: File[]) {
  const files = await Promise.all(
    picked.map(async (file): Promise<GameFile[]> => {
      const data = new Uint8Array(await file.arrayBuffer());
      return getIsZip(data)
        ? unzip({ name: file.name, data })
        : [{ name: file.name, data }];
    }),
  );
  return files.flat();
}

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
