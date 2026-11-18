import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { GameMap, Point } from "../map/types";
import { compileMap } from "../wad/compile";
import { startGameClient, type GameClient } from "./game-client";
import { GameHud } from "./game-hud";
import { loadIwad } from "./iwad";
import {
  keysByCode,
  maxVolume,
  screenHeight,
  screenWidth,
  type GameStatus,
} from "./runtime";

type SoundSettings = { volume: number; muted: boolean };

const soundKey = "wadsmith:sound";
const defaultSound: SoundSettings = { volume: 8, muted: false };
const noteMessageMs = 2000;

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

type PlayerSpot = Point & { angle: number };

function spotOf({ x, y }: GameStatus): Point {
  return { x, y: 0 - y };
}

type GameSessionProps = {
  map: GameMap;
  title: string;
  slot: string;
  par: number | null;
  sound: SoundSettings;
  onSoundChange: (sound: SoundSettings) => void;
  fullscreen: boolean;
  onRestart: () => void;
  onToggleFullscreen: () => void;
  onExit: () => void;
  onAddNote: (point: Point, text: string) => void;
  onEditSpot: (spot: PlayerSpot) => void;
};

function GameSession({
  map,
  title,
  slot,
  par,
  sound,
  onSoundChange,
  fullscreen,
  onRestart,
  onToggleFullscreen,
  onExit,
  onAddNote,
  onEditSpot,
}: GameSessionProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameClient | null>(null);
  const held = useRef(new Set<number>());
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

  useEffect(() => {
    soundRef.current = sound;
    gameRef.current?.setSound(sound);
  }, [sound]);

  useEffect(() => () => clearTimeout(noteTimer.current), []);

  useEffect(() => {
    let stopped = false;
    let client: GameClient | null = null;
    let reachedLevel = false;

    loadIwad()
      .then((iwad) => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (stopped || !canvas || !context) return;
        canvas.focus();
        client = startGameClient({
          iwad,
          map: compileMap(map),
          sound: soundRef.current,
          onFrame: (pixels) =>
            context.putImageData(
              new ImageData(pixels, screenWidth, screenHeight),
              0,
              0,
            ),
          // The WAD holds one map, so leaving it would load an unrelated level.
          onStatus: (next) => {
            if (next.inLevel) reachedLevel = true;
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
        });
        gameRef.current = client;
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
  }, [map]);

  const setKey = (pressed: boolean, key: number | undefined) => {
    if (key === undefined) return;
    if (pressed === held.current.has(key)) return;
    if (pressed) held.current.add(key);
    else held.current.delete(key);
    gameRef.current?.key(pressed, key);
  };

  const focusGame = () => canvasRef.current?.focus();

  const openNote = () => {
    if (!status?.inLevel) return;
    setNoteSaved(false);
    setNoteSpot(spotOf(status));
    gameRef.current?.setHeld(true);
  };

  const closeNote = () => {
    setNoteSpot(null);
    gameRef.current?.setHeld(false);
    requestAnimationFrame(focusGame);
  };

  const editSpot = () => {
    if (status?.inLevel) {
      onEditSpot({ ...spotOf(status), angle: status.angle });
    }
  };

  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    const typing = (event.target as Element).closest?.("form");
    if (event.code === "Escape") {
      event.preventDefault();
      if (noteSpot) closeNote();
      else onExit();
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
          noteOpen={noteSpot !== null}
          noteSaved={noteSaved}
          finished={finished}
          audioUnavailable={audioUnavailable}
          onSoundChange={onSoundChange}
          onRestart={onRestart}
          onToggleFullscreen={onToggleFullscreen}
          onExit={onExit}
          onOpenNote={openNote}
          onSaveNote={(text) => {
            if (noteSpot) onAddNote(noteSpot, text);
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
        {error ? (
          <p className="notice absolute inset-x-4 top-20 z-20" role="alert">
            {error}
          </p>
        ) : (
          <canvas
            ref={canvasRef}
            className="game-canvas"
            width={screenWidth}
            height={screenHeight}
            tabIndex={0}
            aria-label="Game. Arrows or W, A, S and D move, Space fires, E uses, N leaves a note, F2 edits this spot, Escape returns to the editor."
            onBlur={() => {
              for (const key of held.current) setKey(false, key);
            }}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              event.currentTarget.focus();
              gameRef.current?.resumeAudio();
              if (event.button !== 0 || noteSpot) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              setKey(true, keysByCode.Space);
            }}
            onPointerUp={(event) => {
              if (event.button === 0) setKey(false, keysByCode.Space);
            }}
            onLostPointerCapture={() => setKey(false, keysByCode.Space)}
            onKeyDown={(event) => {
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
              gameRef.current?.resumeAudio();
              setKey(true, key);
            }}
            onKeyUp={(event) => setKey(false, keysByCode[event.code])}
          />
        )}
      </div>
    </div>
  );
}

function GameView({
  map,
  title,
  slot,
  par,
  onExit,
  onAddNote,
  onEditSpot,
}: {
  map: GameMap;
  title: string;
  slot: string;
  par: number | null;
  onExit: () => void;
  onAddNote: (point: Point, text: string) => void;
  onEditSpot: (spot: PlayerSpot) => void;
}) {
  const stageRef = useRef<HTMLElement>(null);
  const [run, setRun] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [sound, setSound] = useState(loadSound);

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
        key={run}
        map={map}
        title={title}
        slot={slot}
        par={par}
        sound={sound}
        onSoundChange={(next) => {
          setSound(next);
          saveSound(next);
        }}
        fullscreen={fullscreen}
        onRestart={() => setRun((value) => value + 1)}
        onToggleFullscreen={toggleFullscreen}
        onExit={onExit}
        onAddNote={onAddNote}
        onEditSpot={onEditSpot}
      />
    </section>
  );
}

export { GameView, type PlayerSpot };
