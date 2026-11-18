import { useEffect, useRef, useState } from "react";

import type { GameMap } from "../map/types";
import { compileMap } from "../wad/compile";
import { engineBase, loadIwad } from "./iwad";
import {
  keysByCode,
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

function loadEngineFiles() {
  engineFiles ??= (async () => {
    const [module, iwad] = await Promise.all([
      import(/* @vite-ignore */ `${engineBase}doom.js`) as Promise<{
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

type GameSessionProps = {
  map: GameMap;
  fullscreen: boolean;
  onRestart: () => void;
  onToggleFullscreen: () => void;
  onExit: () => void;
};

function GameSession({
  map,
  fullscreen,
  onRestart,
  onToggleFullscreen,
  onExit,
}: GameSessionProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<DoomGame | null>(null);
  const held = useRef(new Set<number>());
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let frame = 0;
    let stopped = false;
    let lastStatus = 0;
    const logs: string[] = [];

    const fail = (message: string) => {
      if (!stopped) setError(message);
    };

    (async () => {
      const { createDoom, iwad } = await loadEngineFiles();
      const game = await startDoom({
        createDoom,
        iwad,
        map: compileMap(map),
        options: {
          print: (line) => logs.push(line),
          printErr: (line) => logs.push(line),
        },
      });
      if (stopped) return;
      gameRef.current = game;
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      canvas.focus();
      const image = context.createImageData(screenWidth, screenHeight);

      const loop = (now: number) => {
        if (stopped) return;
        try {
          if (game.tick(now)) {
            image.data.set(game.frame());
            context.putImageData(image, 0, 0);
            if (now - lastStatus > 200) {
              lastStatus = now;
              setStatus(game.status());
            }
          }
        } catch {
          fail(logs.at(-1) ?? "The engine stopped.");
          return;
        }
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    })().catch((cause: unknown) => {
      const detail = logs.at(-1) ?? (cause as Error).message;
      fail(
        `The engine could not start: ${detail} Run pnpm setup:engine if it hasn't been built.`,
      );
    });

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
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
          if ((event.target as Element).closest("button")) return;
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
        fullscreen={fullscreen}
        onRestart={() => setRun((value) => value + 1)}
        onToggleFullscreen={toggleFullscreen}
        onExit={onExit}
      />
    </section>
  );
}

export { GameView };
