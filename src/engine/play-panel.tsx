import { useEffect, useRef, useState } from "react";

import type { GameMap } from "../map/types";
import { compileMap } from "../wad/compile";
import {
  keysByCode,
  screenHeight,
  screenWidth,
  startDoom,
  type CreateDoom,
  type DoomGame,
  type GameStatus,
} from "./runtime";

const engineBase = `${import.meta.env.BASE_URL}engine/`;

let engineFiles: Promise<{
  createDoom: CreateDoom;
  iwad: Uint8Array;
}> | null = null;

function loadEngineFiles() {
  engineFiles ??= (async () => {
    const [module, response] = await Promise.all([
      import(/* @vite-ignore */ `${engineBase}doom.js`) as Promise<{
        default: CreateDoom;
      }>,
      fetch(`${engineBase}freedoom2.wad`),
    ]);
    if (!response.ok) throw new Error("freedoom2.wad is missing.");
    return {
      createDoom: module.default,
      iwad: new Uint8Array(await response.arrayBuffer()),
    };
  })().catch((error) => {
    engineFiles = null;
    throw error;
  });
  return engineFiles;
}

function PlayPanel({ map }: { map: GameMap }) {
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

  if (error) {
    return (
      <p className="notice" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="play">
      <canvas
        ref={canvasRef}
        className="screen"
        width={screenWidth}
        height={screenHeight}
        tabIndex={0}
        aria-label="Game. Arrows or W, A, S and D move, Space fires, E uses."
        onBlur={() => {
          for (const key of held.current) setKey(false, key);
        }}
        onPointerDown={(event) => {
          event.currentTarget.focus();
          setKey(true, keysByCode.Space);
        }}
        onPointerUp={() => setKey(false, keysByCode.Space)}
        onKeyDown={(event) => {
          const key = keysByCode[event.code];
          if (key === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          setKey(true, key);
        }}
        onKeyUp={(event) => setKey(false, keysByCode[event.code])}
      />
      <p className="hint" aria-live="off">
        {status
          ? `Health ${status.health} · Kills ${status.kills}/${status.totalKills}`
          : "Starting…"}
        <span>WASD move · ←→ turn · Space fire · E use · Shift run</span>
      </p>
    </div>
  );
}

export { PlayPanel };
