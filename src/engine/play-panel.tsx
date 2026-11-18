import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack,
} from "@ui-sdk/react/slider";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { GameMap } from "../map/types";
import { compileMap } from "../wad/compile";
import { engineBase, loadIwad } from "./iwad";
import {
  keysByCode,
  maxVolume,
  screenHeight,
  screenWidth,
  startDoom,
  type CreateDoom,
  type DoomGame,
  type GameStatus,
} from "./runtime";

let engineFiles: Promise<{
  createDoom: CreateDoom;
  iwad: Uint8Array;
}> | null = null;

function lastEngineError(errors: string[]) {
  return errors.findLast((line) => line.trim());
}

function loadEngineFiles() {
  engineFiles ??= (async () => {
    const [module, iwad] = await Promise.all([
      import(/* @vite-ignore */ `${engineBase}websockets-doom.js`) as Promise<{
        default: CreateDoom;
      }>,
      loadIwad(),
    ]);
    return { createDoom: module.default, iwad };
  })().catch((error) => {
    engineFiles = null;
    throw error;
  });
  return engineFiles;
}

type SoundSettings = { volume: number; muted: boolean };

const soundKey = "wadsmith:sound";
const defaultSound: SoundSettings = { volume: 8, muted: false };

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

type GameSessionProps = {
  map: GameMap;
  sound: SoundSettings;
  onSoundChange: (sound: SoundSettings) => void;
  fullscreen: boolean;
  onRestart: () => void;
  onToggleFullscreen: () => void;
  onExit: () => void;
};

function GameSession({
  map,
  sound,
  onSoundChange,
  fullscreen,
  onRestart,
  onToggleFullscreen,
  onExit,
}: GameSessionProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<DoomGame | null>(null);
  const held = useRef(new Set<number>());
  const soundRef = useRef(sound);
  const leaveGame = useEffectEvent(onExit);
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    soundRef.current = sound;
    gameRef.current?.setSound(sound.volume, sound.muted);
  }, [sound]);

  useEffect(() => {
    let frame = 0;
    let stopped = false;
    let running: DoomGame | null = null;
    let loaded = false;
    let lastStatus = 0;
    const errors: string[] = [];

    const fail = (message: string) => {
      if (!stopped) setError(message);
    };

    // The engine traps on a fatal error inside its own animation frame.
    const onError = (event: ErrorEvent) => {
      if (event.error instanceof WebAssembly.RuntimeError) {
        running?.stop();
        fail(lastEngineError(errors) ?? "The engine stopped.");
      }
    };
    window.addEventListener("error", onError);

    (async () => {
      const { createDoom, iwad } = await loadEngineFiles().catch(
        (cause: Error) => {
          throw new Error(
            `The engine could not load: ${cause.message} Run pnpm setup:engine if it hasn't been built.`,
          );
        },
      );
      loaded = true;
      const game = await startDoom({
        createDoom,
        iwad,
        map: compileMap(map),
        options: {
          print: () => {},
          printErr: (line) => errors.push(line),
          // Quit Game in Doom's menu ends the engine.
          onExit: () => {
            if (!stopped) leaveGame();
          },
        },
      });
      if (stopped) {
        game.stop();
        return;
      }
      running = game;
      gameRef.current = game;
      game.setSound(soundRef.current.volume, soundRef.current.muted);
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      canvas.focus();
      const image = context.createImageData(screenWidth, screenHeight);

      const loop = (now: number) => {
        if (stopped) return;
        try {
          if (game.hasNewFrame()) {
            image.data.set(game.frame());
            context.putImageData(image, 0, 0);
            if (now - lastStatus > 200) {
              lastStatus = now;
              setStatus(game.status());
            }
          }
        } catch {
          running?.stop();
          fail(lastEngineError(errors) ?? "The engine stopped.");
          return;
        }
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    })().catch((cause: Error) => {
      fail(
        loaded
          ? `The game couldn't start: ${lastEngineError(errors) ?? cause.message}`
          : cause.message,
      );
    });

    return () => {
      stopped = true;
      window.removeEventListener("error", onError);
      cancelAnimationFrame(frame);
      running?.stop();
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

  return (
    <>
      <header
        className="game-bar"
        onPointerDown={(event) => {
          if (
            (event.target as Element).closest("button, [data-game-control]")
          ) {
            return;
          }
          event.preventDefault();
          canvasRef.current?.focus();
        }}
      >
        <p className="hint" aria-live="off">
          {status
            ? `Health ${status.health} · Kills ${status.kills}/${status.totalKills}`
            : "Starting…"}
        </p>
        <p className="game-keys">
          WASD move · ←→ turn · Space fire · E use · Shift run · Shift+Tab
          buttons · {fullscreen ? "Esc leaves fullscreen" : "Esc menu"}
        </p>
        <div className="game-actions">
          <button
            type="button"
            className="button"
            aria-pressed={sound.muted}
            onClick={(event) => {
              onSoundChange({ ...sound, muted: !sound.muted });
              // A mouse click shouldn't take the keys away from the game.
              if (event.detail > 0) canvasRef.current?.focus();
            }}
          >
            {sound.muted ? "Unmute" : "Mute"}
          </button>
          <Slider
            className="slider game-volume"
            data-game-control=""
            value={sound.volume}
            min={0}
            max={maxVolume}
            step={1}
            onValueChange={(volume) =>
              onSoundChange({ volume: volume as number, muted: false })
            }
            onPointerUp={() => canvasRef.current?.focus()}
          >
            <SliderControl className="slider-control">
              <SliderTrack className="slider-track">
                <SliderIndicator className="slider-indicator" />
                <SliderThumb className="slider-thumb" aria-label="Volume" />
              </SliderTrack>
            </SliderControl>
          </Slider>
          <button type="button" className="button" onClick={onRestart}>
            Restart
          </button>
          <button type="button" className="button" onClick={onToggleFullscreen}>
            {fullscreen ? "Exit fullscreen" : "Fullscreen"}
          </button>
          <button type="button" className="button primary" onClick={onExit}>
            Back to editor
          </button>
        </div>
      </header>
      <div
        className="game-screen"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          canvasRef.current?.focus();
        }}
      >
        {error ? (
          <p className="notice" role="alert">
            {error}
          </p>
        ) : (
          <canvas
            ref={canvasRef}
            className="game-canvas"
            width={screenWidth}
            height={screenHeight}
            tabIndex={0}
            aria-label="Game. Arrows or W, A, S and D move, Space fires, E uses."
            onBlur={() => {
              for (const key of held.current) setKey(false, key);
            }}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              event.currentTarget.focus();
              gameRef.current?.resumeAudio();
              if (event.button !== 0) return;
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
              gameRef.current?.resumeAudio();
              setKey(true, key);
            }}
            onKeyUp={(event) => setKey(false, keysByCode[event.code])}
          />
        )}
      </div>
    </>
  );
}

function GameView({ map, onExit }: { map: GameMap; onExit: () => void }) {
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
        sound={sound}
        onSoundChange={(next) => {
          setSound(next);
          saveSound(next);
        }}
        fullscreen={fullscreen}
        onRestart={() => setRun((value) => value + 1)}
        onToggleFullscreen={toggleFullscreen}
        onExit={onExit}
      />
    </section>
  );
}

export { GameView };
