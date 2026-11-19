import {
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { GameMap, Point } from "../map/types";
import { compileMap } from "../wad/compile";
import type { NetworkState } from "./doom-worker";
import { startGameClient, type GameClient } from "./game-client";
import { GameHud, type ScoreRow } from "./game-hud";
import { loadIwad } from "./iwad";
import { HeldKeys } from "./held-keys";
import {
  MouseFire,
  clickFires,
  holdsGame,
  initialMouseCapture,
  msSincePointerRelease,
  nextMouseCapture,
  notePointerReleased,
  relockWait,
} from "./mouse-capture";
import {
  keysByCode,
  maxVolume,
  screenSizes,
  type GameStatus,
  type NetworkMode,
  type Resolution,
  type Skill,
} from "./runtime";
import { hostPeer, type RoomPlayer } from "./room";

type SoundSettings = { volume: number; muted: boolean };

const soundKey = "wadsmith:sound";
const resolutionKey = "wadsmith:resolution";
const defaultSound: SoundSettings = { volume: 8, muted: false };
const noteMessageMs = 2000;
// Escape can reach the page just after it released the pointer.
const escapeGraceMs = 300;
const mouseFireSource = "mouse";

function loadSound(): SoundSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(soundKey) ?? "null");
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

function saveSound(sound: SoundSettings) {
  try {
    localStorage.setItem(soundKey, JSON.stringify(sound));
  } catch {
    return;
  }
}

function loadResolution(): Resolution {
  try {
    return localStorage.getItem(resolutionKey) === "high" ? "high" : "classic";
  } catch {
    return "classic";
  }
}

function saveResolution(resolution: Resolution) {
  try {
    localStorage.setItem(resolutionKey, resolution);
  } catch {
    return;
  }
}

type PlayerSpot = Point & { angle: number };

function spotOf({ x, y }: GameStatus): Point {
  return { x, y: 0 - y };
}

/** How a playtest takes part in a co-op game through its room. */
type CoopSession = {
  role: "host" | "guest";
  peer: number;
  mode: NetworkMode;
  skill: Skill;
  wad: Uint8Array;
  send: (to: number, data: Uint8Array) => void;
  listen: (receive: (from: number, data: Uint8Array) => void) => void;
  players: () => number;
  roster: () => RoomPlayer[];
  onServerReady: () => void;
};

type GameExit = "editor" | "maps" | "leave";

const gameExits: Record<
  GameExit,
  { label: string; hint: string; action: string }
> = {
  editor: {
    label: "Back to editor",
    hint: "Esc returns to the editor",
    action: "returns to the editor",
  },
  maps: {
    label: "Back to maps",
    hint: "Esc returns to featured maps",
    action: "returns to featured maps",
  },
  leave: {
    label: "Leave game",
    hint: "Esc leaves the game",
    action: "leaves the game",
  },
};

type GameSessionProps = {
  map: GameMap;
  title: string;
  slot: string;
  par: number | null;
  sound: SoundSettings;
  onSoundChange: (sound: SoundSettings) => void;
  resolution: Resolution;
  onResolutionChange: (resolution: Resolution) => void;
  fullscreen: boolean;
  onRestart: () => void;
  onToggleFullscreen: () => void;
  onExit: () => void;
  onAddNote?: (point: Point, text: string) => void;
  onEditSpot?: (spot: PlayerSpot) => void;
  coop: CoopSession | null;
  exit: GameExit;
  skill: Skill;
};

function GameSession({
  map,
  title,
  slot,
  par,
  sound,
  onSoundChange,
  resolution,
  onResolutionChange,
  fullscreen,
  onRestart,
  onToggleFullscreen,
  onExit,
  onAddNote,
  onEditSpot,
  coop,
  exit,
  skill,
}: GameSessionProps) {
  const canEdit = !coop && Boolean(onAddNote && onEditSpot);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameClient | null>(null);
  const heldKeys = useRef(new HeldKeys());
  const mouseFire = useRef(new MouseFire());
  const soundRef = useRef(sound);
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const leaveGame = useEffectEvent(onExit);
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const [showHelp, setShowHelp] = useState(true);
  const [noteSpot, setNoteSpot] = useState<Point | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);
  const [finished, setFinished] = useState(false);
  const [network, setNetwork] = useState<NetworkState | null>(null);
  const [scoresOpen, setScoresOpen] = useState(false);
  const [capture, updateCapture] = useReducer(
    nextMouseCapture,
    initialMouseCapture,
  );
  const captureRef = useRef(capture);
  const wantsLock = useRef(false);
  const lockPending = useRef(false);
  const expectingRelease = useRef(false);
  const recaptureAfterNote = useRef(false);
  const lockTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const gameHeld = noteSpot !== null || holdsGame(capture);
  const gameHeldRef = useRef(gameHeld);
  const { width, height } = screenSizes[resolution];
  const coopStarted = (network?.playersInGame ?? 0) > 1 && status?.inLevel;

  useEffect(() => {
    captureRef.current = capture;
  }, [capture]);

  useEffect(() => {
    gameHeldRef.current = gameHeld;
    gameRef.current?.setHeld(gameHeld);
  }, [gameHeld]);

  useEffect(() => {
    soundRef.current = sound;
    gameRef.current?.setSound(sound);
  }, [sound]);

  useEffect(() => () => clearTimeout(noteTimer.current), []);

  useEffect(() => {
    let stopped = false;
    let client: GameClient | null = null;
    let reachedLevel = false;
    let serverReady = false;
    let launched = false;
    // Woof can show the level for a moment before its network game starts.
    let netStarted = !coop;

    loadIwad()
      .then((iwad) => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (stopped || !canvas || !context) return;
        canvas.focus();
        client = startGameClient({
          iwad,
          map: coop?.wad ?? compileMap(map),
          sound: soundRef.current,
          resolution,
          skill: coop?.skill ?? skill,
          onFrame: (pixels) =>
            context.putImageData(new ImageData(pixels, width, height), 0, 0),
          // The WAD holds one map, so leaving it would load an unrelated level.
          onStatus: (next) => {
            if (next.inLevel && netStarted) reachedLevel = true;
            if (reachedLevel && !next.inLevel) {
              client?.stop();
              setFinished(true);
              return;
            }
            setStatus(next);
          },
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
                  if (state.playersInGame > 1) netStarted = true;
                  if (coop.role !== "host") return;
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
        for (const key of heldKeys.current.keys()) client.key(true, key);
      })
      .catch((cause: Error) => {
        if (!stopped) {
          setError(
            `The engine could not load: ${cause.message} Run pnpm setup:engine if it hasn't been built.`,
          );
        }
      });

    return () => {
      stopped = true;
      client?.stop();
      gameRef.current = null;
    };
  }, [map, resolution, width, height, coop, skill]);

  const pressKey = (source: string, key: number) => {
    if (heldKeys.current.press(source, key)) gameRef.current?.key(true, key);
  };

  const releaseKey = useEffectEvent((source: string) => {
    const key = heldKeys.current.release(source);
    if (key !== null) gameRef.current?.key(false, key);
  });

  const releaseAllKeys = () => {
    for (const key of heldKeys.current.releaseAll()) {
      gameRef.current?.key(false, key);
    }
  };

  const focusGame = () => canvasRef.current?.focus();

  const syncFire = (event: ReactPointerEvent<HTMLCanvasElement>) => {
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

  const releaseMouse = useEffectEvent(() => {
    if (document.pointerLockElement !== canvasRef.current) return;
    expectingRelease.current = true;
    document.exitPointerLock();
  });

  const cancelCapture = useEffectEvent(() => {
    clearTimeout(lockTimer.current);
    lockPending.current = false;
    wantsLock.current = false;
    updateCapture("cancelled");
  });

  useEffect(() => {
    const onChange = () => {
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
    };
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

  useEffect(() => {
    if (!finished && !error) return;
    cancelCapture();
    releaseMouse();
  }, [finished, error]);

  const openNote = () => {
    if (!status?.inLevel || !canEdit) return;
    setNoteSaved(false);
    setNoteSpot(spotOf(status));
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

  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    const typing = (event.target as Element).closest?.("form");
    if (event.code === "Escape") {
      event.preventDefault();
      if (noteSpot) closeNote();
      else if (captureRef.current.mode === "locked") document.exitPointerLock();
      else if (
        !event.repeat &&
        msSincePointerRelease(performance.now()) > escapeGraceMs
      ) {
        onExit();
      }
    } else if (!typing && event.code === "KeyN" && !event.repeat) {
      event.preventDefault();
      openNote();
    } else if (!typing && event.code === "F2") {
      event.preventDefault();
      editSpot();
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  return (
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
          map={map}
          title={title}
          slot={slot}
          par={par}
          status={status}
          sound={sound}
          fullscreen={fullscreen}
          showHelp={showHelp && !noteSpot && !noteSaved}
          coop={coop?.role ?? null}
          skill={coop?.skill ?? skill}
          deathmatch={coop?.mode === "deathmatch"}
          scores={
            coop && network && scoresOpen ? scoreRows(coop, network) : null
          }
          exit={gameExits[coop?.role === "guest" ? "leave" : exit]}
          canEdit={canEdit}
          noteOpen={noteSpot !== null}
          mouseMode={capture.mode}
          noteSaved={noteSaved}
          finished={finished}
          audioUnavailable={audioUnavailable}
          onSoundChange={onSoundChange}
          resolution={resolution}
          onResolutionChange={onResolutionChange}
          onRestart={onRestart}
          onToggleFullscreen={onToggleFullscreen}
          onExit={onExit}
          onOpenNote={openNote}
          onSaveNote={(text) => {
            if (noteSpot) onAddNote?.(noteSpot, text);
            closeNote();
            setNoteSaved(true);
            clearTimeout(noteTimer.current);
            noteTimer.current = setTimeout(
              () => setNoteSaved(false),
              noteMessageMs,
            );
          }}
          onEditSpot={editSpot}
          onControlUsed={focusGame}
        />
        {coop && !error && !finished && !coopStarted ? (
          <p
            className="absolute inset-x-4 top-1/2 z-20 m-0 -translate-y-1/2 text-center font-mono text-sm text-fg-soft"
            role="status"
          >
            {coopWaiting(coop, network)}
          </p>
        ) : null}
        {error ? (
          <p className="notice absolute inset-x-4 top-20 z-20" role="alert">
            {error}
          </p>
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
  );
}

function scoreRows(coop: CoopSession, network: NetworkState): ScoreRow[] {
  const roster = coop.roster();
  return network.scores.map((score) => {
    const player = roster.find((entry) => entry.peer === score.peer);
    return {
      ...score,
      name: player?.name ?? `Player ${score.peer}`,
      host: score.peer === hostPeer,
      you: score.peer === coop.peer,
      ping: score.peer === hostPeer ? null : (player?.ping ?? null),
    };
  });
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

function GameView({
  map,
  title,
  slot,
  par,
  onExit,
  onAddNote,
  onEditSpot,
  coop = null,
  exit = "editor",
  skill = "medium",
}: {
  map: GameMap;
  title: string;
  slot: string;
  par: number | null;
  onExit: () => void;
  onAddNote?: (point: Point, text: string) => void;
  onEditSpot?: (spot: PlayerSpot) => void;
  coop?: CoopSession | null;
  exit?: GameExit;
  skill?: Skill;
}) {
  const stageRef = useRef<HTMLElement>(null);
  const [run, setRun] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [sound, setSound] = useState(loadSound);
  const [resolution, setResolution] = useState(loadResolution);

  useEffect(() => {
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
        key={`${run}-${resolution}`}
        map={map}
        title={title}
        slot={slot}
        par={par}
        sound={sound}
        onSoundChange={(next) => {
          setSound(next);
          saveSound(next);
        }}
        resolution={resolution}
        onResolutionChange={(next) => {
          setResolution(next);
          saveResolution(next);
        }}
        fullscreen={fullscreen}
        onRestart={() => setRun((value) => value + 1)}
        onToggleFullscreen={toggleFullscreen}
        onExit={onExit}
        onAddNote={onAddNote}
        onEditSpot={onEditSpot}
        coop={coop}
        exit={exit}
        skill={skill}
      />
    </section>
  );
}

export { GameView, type CoopSession, type GameExit, type PlayerSpot };
