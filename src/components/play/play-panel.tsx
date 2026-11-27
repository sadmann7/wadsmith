import { createLocalStorage } from "@ui-sdk/core";
import * as React from "react";

import type { NetworkState } from "@/lib/engine/doom-worker";
import type { PlaytestRun } from "@/lib/map/playtest";
import type { GameMap, NoteMoment, Point } from "@/lib/map/types";

import { Alert } from "@/components/ui/alert";
import {
  defaultGame,
  endsGame,
  engineSlot,
  type GameInfo,
  indexSlot,
  slotCount,
  statusIndex,
  statusSlot,
} from "@/lib/engine/game";
import { type GameClient, startGameClient } from "@/lib/engine/game-client";
import { HeldKeys } from "@/lib/engine/held-keys";
import { loadIwad, texturesOf } from "@/lib/engine/iwad";
import {
  clickFires,
  holdsGame,
  initialMouseCapture,
  MouseFire,
  msSincePointerRelease,
  nextMouseCapture,
  notePointerReleased,
  relockWait,
} from "@/lib/engine/mouse-capture";
import { hostPeer, type RoomPlayer } from "@/lib/engine/room";
import {
  type Cheats,
  doomKeys,
  type GameFiles,
  type GameStatus,
  keysByCode,
  maxVolume,
  type NetworkMode,
  noCheats,
  type Screen,
  screenSize,
  type Skill,
} from "@/lib/engine/runtime";
import { RunRecorder } from "@/lib/engine/trail";
import { compileEpisode, compileMap, type Lump } from "@/lib/wad/compile";
import { inspectWads } from "@/lib/wad/inspect";

import { EndGameConfirm, GameHud, GameTopBar, type ScoreRow } from "./game-hud";

interface SoundSettings {
  volume: number;
  muted: boolean;
}

const savedSound = createLocalStorage("wadsmith:sound");
const savedResolution = createLocalStorage("wadsmith:resolution");
const savedWidescreen = createLocalStorage("wadsmith:widescreen");
const savedCrosshair = createLocalStorage("wadsmith:crosshair");

export type PlayerSpot = Point & { angle: number };

/** How a playtest takes part in a co-op game through its room. */
export interface CoopSession {
  role: "host" | "guest";
  peer: number;
  mode: NetworkMode;
  skill: Skill;
  wad: Uint8Array;
  send: (to: number, data: Uint8Array) => void;
  listen: (receive: (from: number, data: Uint8Array) => void) => void;
  players: () => number;
  roster: () => RoomPlayer[];
  announceStall: (peers: number[]) => void;
  listenStall: (receive: (peers: number[]) => void) => void;
  onServerReady: () => void;
}

export type GameExit = "editor" | "maps" | "episode" | "leave";

export interface Level {
  map: GameMap;
  title: string;
  slot: string;
  par: number | null;
  music?: string;
  sky?: string;
  intertext?: string;
  lumps?: Lump[] | null;
}

interface GameViewProps {
  map: GameMap | null;
  files?: GameFiles | null;
  title: string;
  slot: string;
  par: number | null;
  music?: string;
  sky?: string;
  intertext?: string;
  onExit: () => void;
  onAddNote?: (point: Point, text: string, moment?: NoteMoment) => void;
  onEditSpot?: (spot: PlayerSpot) => void;
  // What the engine saw of a single map's playtest, once the game is left.
  onRun?: (run: PlaytestRun) => void;
  coop?: CoopSession | null;
  episode?: Level[] | null;
  exit?: GameExit;
  skill?: Skill;
  // With loaded files, the level the game ends after, as the engine numbers
  // it, so it doesn't run on into the game's own levels.
  lastLevel?: number;
}

export function GameView({
  map,
  files = null,
  title,
  slot,
  par,
  music,
  sky,
  intertext,
  onExit,
  onAddNote,
  onEditSpot,
  onRun,
  coop = null,
  episode = null,
  exit = "editor",
  skill = "medium",
  lastLevel,
}: GameViewProps) {
  const stageRef = React.useRef<HTMLElement>(null);
  const [run, setRun] = React.useState(0);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [sound, setSound] = React.useState(loadSound);
  const [screen, setScreen] = React.useState(loadScreen);
  const [cheats, setCheats] = React.useState(noCheats);
  const [crosshair, setCrosshair] = React.useState(
    () => savedCrosshair.get() !== "off",
  );

  React.useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      if (document.fullscreenElement) void document.exitFullscreen();
    };
  }, []);

  const toggleFullscreen = () => {
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : stageRef.current?.requestFullscreen();
    request
      ?.catch(() => {})
      .finally(() => stageRef.current?.querySelector("canvas")?.focus());
  };

  return (
    <section ref={stageRef} className="game-stage" aria-label="Game">
      <GameSession
        key={`${run}-${screen.resolution}-${screen.widescreen}`}
        map={map}
        files={files}
        title={title}
        slot={slot}
        par={par}
        music={music}
        sky={sky}
        intertext={intertext}
        episode={episode}
        sound={sound}
        onSoundChange={(next) => {
          setSound(next);
          saveSound(next);
        }}
        screen={screen}
        onScreenChange={(next) => {
          setScreen(next);
          saveScreen(next);
        }}
        cheats={cheats}
        onCheatsChange={setCheats}
        crosshair={crosshair}
        onCrosshairChange={(next) => {
          setCrosshair(next);
          savedCrosshair.set(next ? "on" : "off");
        }}
        fullscreen={fullscreen}
        onRestart={() => setRun((value) => value + 1)}
        onToggleFullscreen={toggleFullscreen}
        onExit={onExit}
        onAddNote={onAddNote}
        onEditSpot={onEditSpot}
        onRun={onRun}
        coop={coop}
        exit={exit}
        skill={skill}
        lastLevel={lastLevel}
      />
    </section>
  );
}

const defaultSound: SoundSettings = { volume: 8, muted: false };

function loadSound(): SoundSettings {
  try {
    const saved = JSON.parse(savedSound.get() ?? "null");
    return Number.isInteger(saved?.volume) &&
      saved.volume >= 0 &&
      saved.volume <= maxVolume &&
      typeof saved.muted === "boolean"
      ? { volume: saved.volume, muted: saved.muted }
      : defaultSound;
  } catch {
    return defaultSound;
  }
}

function loadScreen(): Screen {
  return {
    resolution: savedResolution.get() === "classic" ? "classic" : "high",
    widescreen: savedWidescreen.get() !== "off",
  };
}

const noteMessageMs = 2000;
// Escape can reach the page just after it released the pointer.
const escapeGraceMs = 300;
const mouseFireSource = "mouse";
const advanceTapMs = 250;
// Doom's netcode holds the level while it waits for a player's moves. A short
// hold is normal; one this long is worth naming.
const stallMs = 1000;

const gameExits: Record<
  GameExit,
  { label: string; to: string | null; hint: string; action: string }
> = {
  editor: {
    label: "Exit to editor",
    to: "editor",
    hint: "Esc returns to the editor",
    action: "returns to the editor",
  },
  maps: {
    label: "Exit to featured maps",
    to: "featured maps",
    hint: "Esc returns to featured maps",
    action: "returns to featured maps",
  },
  episode: {
    label: "Exit to episode",
    to: "episode",
    hint: "Esc returns to the episode",
    action: "returns to the episode",
  },
  leave: {
    label: "Exit",
    to: null,
    hint: "Esc leaves the game",
    action: "leaves the game",
  },
};

type GameSessionProps = Omit<Level, "map"> & {
  map: GameMap | null;
  files: GameFiles | null;
  episode: Level[] | null;
  sound: SoundSettings;
  onSoundChange: (sound: SoundSettings) => void;
  screen: Screen;
  onScreenChange: (screen: Screen) => void;
  cheats: Cheats;
  onCheatsChange: (cheats: Cheats) => void;
  crosshair: boolean;
  onCrosshairChange: (crosshair: boolean) => void;
  fullscreen: boolean;
  onRestart: () => void;
  onToggleFullscreen: () => void;
  onExit: () => void;
  onAddNote?: (point: Point, text: string, moment?: NoteMoment) => void;
  onEditSpot?: (spot: PlayerSpot) => void;
  // What the engine saw of a single map's playtest, once the game is left.
  onRun?: (run: PlaytestRun) => void;
  coop: CoopSession | null;
  exit: GameExit;
  skill: Skill;
  lastLevel?: number;
};

function GameSession({
  map,
  files,
  title,
  slot,
  par,
  music,
  sky,
  intertext,
  episode,
  sound,
  onSoundChange,
  screen,
  onScreenChange,
  cheats: chosenCheats,
  onCheatsChange,
  crosshair,
  onCrosshairChange,
  fullscreen,
  onRestart,
  onToggleFullscreen,
  onExit,
  onAddNote,
  onEditSpot,
  onRun,
  coop,
  exit,
  skill,
  lastLevel,
}: GameSessionProps) {
  const canEdit = !coop && !episode && Boolean(map && onAddNote && onEditSpot);
  // Only the editor's own solo playtest takes cheats, never a co-op room or a
  // published map.
  const cheats = canEdit ? chosenCheats : noCheats;
  const cheatsRef = React.useRef(cheats);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const gameRef = React.useRef<GameClient | null>(null);
  const heldKeys = React.useRef(new HeldKeys());
  const mouseFire = React.useRef(new MouseFire());
  const soundRef = React.useRef(sound);
  const noteTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const leaveGame = React.useEffectEvent(onExit);
  const reportRun = React.useEffectEvent((run: PlaytestRun) => onRun?.(run));
  const recorderRef = React.useRef<RunRecorder | null>(null);
  const [status, setStatus] = React.useState<GameStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [audioUnavailable, setAudioUnavailable] = React.useState(false);
  const [showHelp, setShowHelp] = React.useState(true);
  const [noteSpot, setNoteSpot] = React.useState<
    (Point & { tic: number }) | null
  >(null);
  const [noteSaved, setNoteSaved] = React.useState(false);
  const [finished, setFinished] = React.useState(false);
  const [levelIndex, setLevelIndex] = React.useState(0);
  const [between, setBetween] = React.useState<GameStatus | null>(null);
  const [game, setGame] = React.useState<GameInfo>(defaultGame);
  const advanceTimer = React.useRef<ReturnType<typeof setInterval>>(undefined);
  const level = episode?.[levelIndex] ?? {
    map,
    title,
    slot:
      files && status
        ? statusSlot(game, status.episode, status.map)
        : engineSlot(slot, game),
    par,
  };
  const [network, setNetwork] = React.useState<NetworkState | null>(null);
  const [coopBegan, setCoopBegan] = React.useState(false);
  const [scoresOpen, setScoresOpen] = React.useState(false);
  const [confirmingExit, setConfirmingExit] = React.useState(false);
  const [stall, setStall] = React.useState<{ peers: number[]; since: number }>({
    peers: [],
    since: 0,
  });
  const [capture, updateCapture] = React.useReducer(
    nextMouseCapture,
    initialMouseCapture,
  );
  const captureRef = React.useRef(capture);
  const wantsLock = React.useRef(false);
  const lockPending = React.useRef(false);
  const expectingRelease = React.useRef(false);
  const recaptureAfterNote = React.useRef(false);
  const lockTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const gameHeld = noteSpot !== null || holdsGame(capture);
  const gameHeldRef = React.useRef(gameHeld);
  const { width, height } = screenSize(screen);
  const coopStarted = coopBegan && status?.inLevel;

  React.useEffect(() => {
    captureRef.current = capture;
  }, [capture]);

  React.useEffect(() => {
    gameHeldRef.current = gameHeld;
    gameRef.current?.setHeld(gameHeld);
  }, [gameHeld]);

  React.useEffect(() => {
    soundRef.current = sound;
    gameRef.current?.setSound(sound);
  }, [sound]);

  React.useEffect(() => {
    cheatsRef.current = cheats;
    gameRef.current?.setCheats(cheats);
    if (cheats.god || cheats.noclip) recorderRef.current?.markCheated();
  }, [cheats]);

  React.useEffect(() => () => clearTimeout(noteTimer.current), []);

  React.useEffect(() => {
    let stopped = false;
    let client: GameClient | null = null;
    let reachedLevel = false;
    let serverReady = false;
    let launched = false;
    // Woof can show the level for a moment before its network game starts.
    let netStarted = !coop;
    let lastTics = -1;
    let lastInLevel: GameStatus | null = null;
    let ticsChangedAt = performance.now();
    let stalled: number[] = [];
    // Only one map's playtest is recorded: an episode or a loaded WAD plays
    // maps the editor isn't showing.
    const recorder = map && !episode && !files ? new RunRecorder() : null;
    recorderRef.current = recorder;
    if (cheatsRef.current.god || cheatsRef.current.noclip) {
      recorder?.markCheated();
    }
    const showStall = (peers: number[]) =>
      setStall((current) =>
        current.peers.join() === peers.join()
          ? current
          : { peers, since: Date.now() },
      );
    coop?.listenStall(showStall);

    loadIwad()
      .then((iwad) => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (stopped || !canvas || !context) return;
        canvas.focus();
        setGame(iwad.game);
        const built =
          coop?.wad ??
          (episode
            ? compileEpisode(
                episode.map((entry, index) => ({
                  ...entry,
                  slot: engineSlot(indexSlot(index + 1), iwad.game),
                })),
                iwad.game,
                texturesOf(iwad),
              )
            : map &&
              compileMap(
                map,
                engineSlot(indexSlot(1), iwad.game),
                { par, music, sky, intertext },
                texturesOf(iwad),
              ));
        client = startGameClient({
          iwad: { game: iwad.game, data: iwad.data },
          files: files ?? {
            wads: built ? [built] : [],
            dehacked: [],
            complevel: built
              ? inspectWads([{ name: "map.wad", data: built }]).complevel
              : "vanilla",
            warp: 1,
          },
          sound: soundRef.current,
          screen,
          skill: coop?.skill ?? skill,
          onFrame: (pixels) =>
            context.putImageData(new ImageData(pixels, width, height), 0, 0),
          // A playtest's WAD holds one map, and an episode's ends with its last,
          // so leaving either would load an unrelated level. A loaded WAD runs
          // its own levels.
          onStatus: (next) => {
            if (next.tics !== lastTics) {
              lastTics = next.tics;
              ticsChangedAt = performance.now();
            }
            const reached = statusIndex(iwad.game, next.episode, next.map);
            const total = episode?.length ?? 1;
            // Text after the last map shows in the engine's finale, so the
            // game ends once the engine moves on past the maps played. An ending
            // map never leaves its finale and the last slot has nothing after
            // it, so there the game still ends at the tally.
            const lastText =
              Boolean(episode ? episode.at(-1)?.intertext : intertext) &&
              total < slotCount(iwad.game) &&
              !endsGame(engineSlot(indexSlot(total), iwad.game));
            if (next.inLevel && netStarted) {
              const limit = files ? lastLevel : total;
              if (limit !== undefined && reached > limit) {
                client?.stop();
                setFinished(true);
                return;
              }
              reachedLevel = true;
              lastInLevel = next;
              if (episode) {
                clearInterval(advanceTimer.current);
                advanceTimer.current = undefined;
                setBetween(null);
                setLevelIndex(Math.min(reached, episode.length) - 1);
              }
            }
            // The taps that move past the tally would skip the text after a
            // map, which the player reads and dismisses in their own time.
            if (next.inFinale) {
              clearInterval(advanceTimer.current);
              advanceTimer.current = undefined;
              setBetween(null);
            }
            if (reachedLevel && !next.inLevel && !files) {
              if (reached >= total && !lastText) {
                client?.stop();
                setFinished(true);
                return;
              }
              // The engine clears the level's time once its tally starts. The
              // last map's tally runs on its own, since no level follows it.
              if (
                episode &&
                reached < total &&
                advanceTimer.current === undefined &&
                !next.inFinale
              ) {
                setBetween(lastInLevel);
              }
            }
            setStatus(next);
          },
          onTrail: (events) => recorder?.add(events),
          onDropouts: (count) => {
            canvas.dataset.audioDropouts = String(count);
          },
          onAudioUnavailable: () => setAudioUnavailable(true),
          onError: setError,
          onExit: leaveGame,
          network: coop
            ? {
                role: coop.role,
                mode: coop.mode,
                host: hostPeer,
                peer: coop.peer,
                send: coop.send,
                onState: (state) => {
                  setNetwork(state);
                  if (state.playersInGame > 1) {
                    netStarted = true;
                    setCoopBegan(true);
                  }
                  if (coop.role !== "host") return;
                  const frozen = performance.now() - ticsChangedAt > stallMs;
                  const lagging = frozen
                    ? state.scores
                        .filter((score) => state.lagging & (1 << score.slot))
                        .map((score) => score.peer)
                    : [];
                  if (lagging.join() !== stalled.join()) {
                    stalled = lagging;
                    showStall(lagging);
                    coop.announceStall(lagging);
                  }
                  if (!serverReady) {
                    serverReady = true;
                    coop.onServerReady();
                  }
                  if (!launched && state.waitingPlayers >= coop.players()) {
                    launched = true;
                    client?.launch();
                  }
                },
              }
            : undefined,
        });
        const running = client;
        coop?.listen((from, data) => running.receive(from, data));
        gameRef.current = client;
        client.setHeld(gameHeldRef.current);
        client.setCheats(cheatsRef.current);
        for (const key of heldKeys.current.keys()) client.key(true, key);
      })
      .catch((loadError: Error) => {
        if (!stopped) {
          setError(
            `The engine could not load: ${loadError.message} Run pnpm setup:engine if it hasn't been built.`,
          );
        }
      });

    return () => {
      stopped = true;
      client?.stop();
      gameRef.current = null;
      const run = recorder?.run();
      if (run) reportRun(run);
    };
  }, [
    map,
    files,
    episode,
    screen,
    width,
    height,
    coop,
    skill,
    lastLevel,
    par,
    music,
    sky,
    intertext,
  ]);

  React.useEffect(() => () => clearInterval(advanceTimer.current), []);

  // Doom's tally and story screens move on when a player presses use.
  const nextLevel = () => {
    setBetween(null);
    clearInterval(advanceTimer.current);
    advanceTimer.current = setInterval(() => {
      gameRef.current?.key(true, doomKeys.use);
      setTimeout(() => gameRef.current?.key(false, doomKeys.use), 60);
    }, advanceTapMs);
    requestAnimationFrame(focusGame);
  };

  const pressKey = (source: string, key: number) => {
    if (heldKeys.current.press(source, key)) gameRef.current?.key(true, key);
  };

  const releaseKey = (source: string) => {
    const key = heldKeys.current.release(source);
    if (key !== null) gameRef.current?.key(false, key);
  };

  const releaseAllKeys = () => {
    for (const key of heldKeys.current.releaseAll()) {
      gameRef.current?.key(false, key);
    }
  };

  const focusGame = () => canvasRef.current?.focus();

  const syncFire = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const firing = mouseFire.current.update(
      capture,
      event.buttons,
      noteSpot !== null || finished,
    );
    if (!firing) {
      releaseKey(mouseFireSource);
      return;
    }
    if (heldKeys.current.has(mouseFireSource)) return;
    setShowHelp(false);
    if (document.pointerLockElement !== event.currentTarget) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    pressKey(mouseFireSource, keysByCode.Space);
  };

  const releaseMouse = () => {
    if (document.pointerLockElement !== canvasRef.current) return;
    expectingRelease.current = true;
    document.exitPointerLock();
  };

  const cancelCapture = () => {
    clearTimeout(lockTimer.current);
    lockPending.current = false;
    wantsLock.current = false;
    updateCapture("cancelled");
  };

  const onPointerLockChange = React.useEffectEvent(() => {
    const canvas = canvasRef.current;
    if (canvas && document.pointerLockElement === canvas) {
      updateCapture("locked");
      // A request already on its way can land after the game stopped wanting it.
      if (!wantsLock.current) releaseMouse();
      return;
    }
    const { mode } = captureRef.current;
    if (mode !== "locked" && mode !== "capturing") return;
    releaseKey(mouseFireSource);
    if (expectingRelease.current) {
      expectingRelease.current = false;
      updateCapture("suspended");
    } else {
      notePointerReleased(performance.now());
      updateCapture("lost");
    }
  });

  React.useEffect(() => {
    const onChange = () => onPointerLockChange();
    const onError = () => updateCapture("failed");
    document.addEventListener("pointerlockchange", onChange);
    document.addEventListener("pointerlockerror", onError);
    return () => {
      document.removeEventListener("pointerlockchange", onChange);
      document.removeEventListener("pointerlockerror", onError);
      clearTimeout(lockTimer.current);
      if (document.pointerLockElement) document.exitPointerLock();
    };
  }, []);

  const requestCapture = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    updateCapture("request");
    wantsLock.current = true;
    const lock = () => {
      lockPending.current = false;
      try {
        void Promise.resolve(canvas.requestPointerLock()).catch(() => {});
      } catch {
        updateCapture("failed");
      }
    };
    clearTimeout(lockTimer.current);
    const wait = relockWait(performance.now());
    lockPending.current = wait > 0;
    if (wait > 0) lockTimer.current = setTimeout(lock, wait);
    else lock();
  };

  const stopCapture = React.useEffectEvent(() => {
    cancelCapture();
    releaseMouse();
  });

  React.useEffect(() => {
    if (!finished && !error && !between) return;
    stopCapture();
  }, [finished, error, between]);

  const openNote = () => {
    if (!status?.inLevel || !canEdit) return;
    setNoteSaved(false);
    setNoteSpot({ ...spotOf(status), tic: status.tics });
    const { mode } = captureRef.current;
    recaptureAfterNote.current = mode === "locked" || mode === "capturing";
    cancelCapture();
    releaseMouse();
  };

  const closeNote = () => {
    setNoteSpot(null);
    requestAnimationFrame(focusGame);
    if (recaptureAfterNote.current) {
      recaptureAfterNote.current = false;
      requestCapture();
    }
  };

  const editSpot = () => {
    if (status?.inLevel && canEdit) {
      onEditSpot?.({ ...spotOf(status), angle: status.angle });
    }
  };

  const stillPlaying =
    coop?.role === "host" && !finished
      ? coop
          .roster()
          .filter((player) => player.peer !== coop.peer)
          .map((player) => player.name)
      : [];

  const showExitConfirm = confirmingExit && stillPlaying.length > 0;

  const requestExit = () => {
    if (stillPlaying.length > 0) setConfirmingExit(true);
    else onExit();
  };

  const keepPlaying = () => {
    setConfirmingExit(false);
    requestAnimationFrame(focusGame);
  };

  const onShortcut = React.useEffectEvent((event: KeyboardEvent) => {
    if (showExitConfirm) {
      if (event.code === "Escape" && !event.repeat) {
        event.preventDefault();
        keepPlaying();
      }
      return;
    }
    const typing = (event.target as Element).closest?.("form");
    if (event.code === "Escape") {
      event.preventDefault();
      if (noteSpot) closeNote();
      else if (captureRef.current.mode === "locked") document.exitPointerLock();
      else if (
        !event.repeat &&
        msSincePointerRelease(performance.now()) > escapeGraceMs
      ) {
        requestExit();
      }
    } else if (!typing && event.code === "KeyN" && !event.repeat) {
      event.preventDefault();
      openNote();
    } else if (!typing && event.code === "F2") {
      event.preventDefault();
      editSpot();
    }
  });

  React.useEffect(() => {
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  const gameExit = gameExits[coop?.role === "guest" ? "leave" : exit];

  return (
    <>
      <GameTopBar
        title={level.title}
        slot={level.slot}
        par={level.par}
        status={status}
        sound={sound}
        fullscreen={fullscreen}
        coop={coop?.role ?? null}
        skill={coop?.skill ?? skill}
        deathmatch={coop?.mode === "deathmatch"}
        episode={episode !== null}
        exit={gameExit}
        screen={screen}
        cheats={canEdit ? cheats : null}
        crosshair={crosshair}
        onCrosshairChange={onCrosshairChange}
        onSoundChange={onSoundChange}
        onScreenChange={onScreenChange}
        onCheatsChange={onCheatsChange}
        onRestart={onRestart}
        onToggleFullscreen={onToggleFullscreen}
        onExit={requestExit}
        onControlUsed={focusGame}
      />
      <div
        className="game-screen"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          focusGame();
        }}
      >
        <div
          className="game-frame @container"
          data-widescreen={screen.widescreen || undefined}
          onPointerDown={(event) => {
            const target = event.target as Element;
            if (
              target === canvasRef.current ||
              target.closest("button, form, [data-game-control]")
            ) {
              return;
            }
            event.preventDefault();
            focusGame();
          }}
        >
          <GameHud
            map={level.map}
            title={level.title}
            slot={level.slot}
            par={level.par}
            episode={episode !== null}
            between={
              between && episode
                ? {
                    tally: between,
                    next: episode[levelIndex + 1],
                    onNext: nextLevel,
                  }
                : null
            }
            status={status}
            fullscreen={fullscreen}
            showHelp={showHelp && !noteSpot && !noteSaved}
            crosshair={crosshair}
            coop={coop?.role ?? null}
            deathmatch={coop?.mode === "deathmatch"}
            scores={
              coop && network && scoresOpen ? scoreRows(coop, network) : null
            }
            others={
              coop && network
                ? network.scores.filter((score) => score.peer !== coop.peer)
                : []
            }
            stall={
              coop && stall.peers.length > 0
                ? {
                    names: stall.peers.map((peer) =>
                      peer === coop.peer ? "you" : nameOf(coop, peer),
                    ),
                    since: stall.since,
                  }
                : null
            }
            exit={gameExit}
            canEdit={canEdit}
            cheats={canEdit ? cheats : null}
            noteOpen={noteSpot !== null}
            mouseMode={capture.mode}
            noteSaved={noteSaved}
            finished={finished}
            audioUnavailable={audioUnavailable}
            onRestart={onRestart}
            onExit={requestExit}
            onOpenNote={openNote}
            onSaveNote={(text) => {
              if (noteSpot) {
                const { tic, ...point } = noteSpot;
                const run = recorderRef.current?.id;
                onAddNote?.(point, text, run ? { run, tic } : undefined);
              }
              closeNote();
              setNoteSaved(true);
              clearTimeout(noteTimer.current);
              noteTimer.current = setTimeout(
                () => setNoteSaved(false),
                noteMessageMs,
              );
            }}
            onEditSpot={editSpot}
          />
          {showExitConfirm ? (
            <EndGameConfirm
              names={stillPlaying}
              onKeepPlaying={keepPlaying}
              onEndGame={onExit}
            />
          ) : null}
          {coop && !error && !finished && !coopStarted ? (
            <p
              className="absolute inset-x-4 top-1/2 z-20 m-0 -translate-y-1/2 text-center font-mono text-sm text-foreground"
              role="status"
            >
              {coopWaiting(coop, network)}
            </p>
          ) : null}
          {error ? (
            <Alert
              variant="destructive"
              className="absolute inset-x-4 top-20 z-20"
              role="alert"
            >
              {error}
            </Alert>
          ) : (
            <canvas
              ref={canvasRef}
              className="game-canvas"
              width={width}
              height={height}
              tabIndex={0}
              aria-label={`Game. Click to capture the mouse, which then turns the player and fires with the left button. Arrows or W, A, S and D move, Space fires, E uses${canEdit ? ", N leaves a note, F2 edits this spot" : ""}. Escape releases the mouse, and pressing it again ${gameExits[coop?.role === "guest" ? "leave" : exit].action}.`}
              onBlur={() => {
                releaseAllKeys();
                setScoresOpen(false);
              }}
              onContextMenu={(event) => event.preventDefault()}
              onPointerDown={(event) => {
                event.currentTarget.focus();
                gameRef.current?.resumeAudio();
                if (event.button === 0 && !noteSpot && !finished) {
                  if (!clickFires(capture)) {
                    event.preventDefault();
                    mouseFire.current.ignoreUntilReleased();
                    requestCapture();
                    return;
                  }
                }
                syncFire(event);
                if (
                  event.button === 0 &&
                  capture.mode === "denied" &&
                  !noteSpot &&
                  !finished
                ) {
                  requestCapture();
                }
              }}
              onPointerMove={(event) => {
                if (capture.mode === "locked" && event.movementX) {
                  gameRef.current?.turn(event.movementX);
                }
                syncFire(event);
              }}
              onPointerUp={syncFire}
              onPointerCancel={() => releaseKey(mouseFireSource)}
              onLostPointerCapture={() => {
                if (capture.mode !== "locked") {
                  releaseKey(mouseFireSource);
                }
              }}
              onKeyDown={(event) => {
                // macOS sends no keyup for keys released while Cmd is down.
                if (event.metaKey) {
                  releaseAllKeys();
                  return;
                }
                if (coop && event.code === "Tab" && !event.shiftKey) {
                  event.preventDefault();
                  setScoresOpen(true);
                  return;
                }
                const key = keysByCode[event.code];
                // Tab is Doom's automap, so Shift+Tab is the way out to the buttons.
                if (
                  key === undefined ||
                  (event.shiftKey && event.code === "Tab")
                ) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                setShowHelp(false);
                if (lockPending.current && !event.repeat) cancelCapture();
                updateCapture("keyboard");
                gameRef.current?.resumeAudio();
                pressKey(event.code, key);
              }}
              onKeyUp={(event) => {
                if (event.code === "Tab") setScoresOpen(false);
                releaseKey(event.code);
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}

function spotOf({ x, y }: GameStatus): Point {
  return { x, y: 0 - y };
}

function scoreRows(coop: CoopSession, network: NetworkState): ScoreRow[] {
  const roster = coop.roster();
  return network.scores.map((score) => {
    const player = roster.find((entry) => entry.peer === score.peer);
    return {
      ...score,
      name: nameOf(coop, score.peer),
      host: score.peer === hostPeer,
      you: score.peer === coop.peer,
      ping: score.peer === hostPeer ? null : (player?.ping ?? null),
    };
  });
}

function nameOf(coop: CoopSession, peer: number) {
  return (
    coop.roster().find((player) => player.peer === peer)?.name ??
    `Player ${peer}`
  );
}

function coopWaiting(coop: CoopSession, network: NetworkState | null) {
  if (coop.role === "guest") {
    return network
      ? "Waiting for the other players…"
      : "Connecting to the host…";
  }
  if (!network) return "Starting the game…";
  return `Waiting for players · ${network.waitingPlayers} of ${coop.players()} connected`;
}

function saveSound(sound: SoundSettings) {
  savedSound.set(JSON.stringify(sound));
}

function saveScreen(screen: Screen) {
  savedResolution.set(screen.resolution);
  savedWidescreen.set(screen.widescreen ? "on" : "off");
}
