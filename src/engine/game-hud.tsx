import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack,
} from "@ui-sdk/react/slider";
import {
  ArrowLeft,
  Crosshair,
  KeyRound,
  Maximize,
  Minimize,
  RotateCcw,
  Skull,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { wallOwners } from "../map/geometry";
import type { GameMap } from "../map/types";
import { maxVolume, type GameStatus } from "./runtime";

type SoundSettings = { volume: number; muted: boolean };

const ticsPerSecond = 35;
const ammoNames = ["Bullets", "Shells", "Cells", "Rockets"];
const keyStyles = [
  { label: "Blue key", icon: KeyRound, color: "var(--cold)" },
  { label: "Yellow key", icon: KeyRound, color: "var(--key)" },
  { label: "Red key", icon: KeyRound, color: "var(--danger)" },
  { label: "Blue skull key", icon: Skull, color: "var(--cold)" },
  { label: "Yellow skull key", icon: Skull, color: "var(--key)" },
  { label: "Red skull key", icon: Skull, color: "var(--danger)" },
];
const panelClass = "pointer-events-auto rounded-[3px] bg-panel/90";
const buttonClass = `${panelClass} flex items-center gap-2 border-0 px-3 py-2 text-text hover:bg-raised`;
const iconButtonClass =
  "flex size-7 items-center justify-center rounded-[3px] border-0 bg-transparent p-0 text-muted hover:bg-raised hover:text-text";

function formatTime(tics: number) {
  const seconds = Math.floor(tics / ticsPerSecond);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Minimap({ map, status }: { map: GameMap; status: GameStatus | null }) {
  const { walls, box } = useMemo(() => {
    const points = Object.values(map.vertices);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const width = Math.max(...xs) - left || 1;
    const height = Math.max(...ys) - top || 1;
    const pad = Math.max(width, height) * 0.08;
    return {
      box: {
        x: left - pad,
        y: top - pad,
        width: width + pad * 2,
        height: height + pad * 2,
      },
      walls: [...wallOwners(map)].map(([key, owners]) => {
        const [from, to] = key.split("|").map((id) => map.vertices[id]);
        return { key, from, to, open: owners.length > 1 };
      }),
    };
  }, [map]);
  const size = Math.max(box.width, box.height) * 0.025;
  const radians = ((status?.angle ?? 0) * Math.PI) / 180;
  return (
    <svg
      role="img"
      aria-label="Minimap"
      className="block h-[162px] w-full bg-[#100f0d] @max-2xl:hidden"
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
    >
      {walls.map(({ key, from, to, open }) => (
        <line
          key={key}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={open ? "#3a342d" : "#6f685e"}
          strokeWidth={open ? 1 : 1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {status ? (
        <g transform={`translate(${status.x} ${-status.y})`}>
          <line
            x2={Math.cos(radians) * size * 2.2}
            y2={-Math.sin(radians) * size * 2.2}
            stroke="var(--key)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          <circle r={size} fill="var(--key)" />
        </g>
      ) : null}
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="m-0 font-mono text-xs">{value}</dd>
    </div>
  );
}

function Vital({
  label,
  value,
  accent,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="font-mono text-[11px] text-[#d6cfc3] uppercase">
        {label}
      </div>
      <div
        className={`text-[44px] leading-none font-bold @max-2xl:text-2xl ${accent ? "text-ember" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function NoteForm({ onSave }: { onSave: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      aria-label="Leave a note"
      className={`${panelClass} absolute bottom-24 left-1/2 flex w-[min(460px,calc(100%-32px))] -translate-x-1/2 gap-2 border border-[#3a352e] p-2`}
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) onSave(text.trim());
      }}
    >
      <input
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        aria-label="Note"
        maxLength={280}
        placeholder="What should change here?"
        className="text-input min-w-0 flex-1"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" className="button primary" disabled={!text.trim()}>
        Save
      </button>
    </form>
  );
}

function GameHud({
  map,
  slot,
  status,
  sound,
  fullscreen,
  showHelp,
  noteOpen,
  noteSaved,
  finished,
  audioUnavailable,
  onSoundChange,
  onRestart,
  onToggleFullscreen,
  onExit,
  onOpenNote,
  onSaveNote,
  onEditSpot,
  onControlUsed,
}: {
  map: GameMap;
  slot: string;
  status: GameStatus | null;
  sound: SoundSettings;
  fullscreen: boolean;
  showHelp: boolean;
  noteOpen: boolean;
  noteSaved: boolean;
  finished: boolean;
  audioUnavailable: boolean;
  onSoundChange: (sound: SoundSettings) => void;
  onRestart: () => void;
  onToggleFullscreen: () => void;
  onExit: () => void;
  onOpenNote: () => void;
  onSaveNote: (text: string) => void;
  onEditSpot: () => void;
  onControlUsed: () => void;
}) {
  const inLevel = status?.inLevel ?? false;
  const FullscreenIcon = fullscreen ? Minimize : Maximize;
  const SoundIcon = sound.muted ? VolumeX : Volume2;
  const ammoName = status ? ammoNames[status.ammoType] : undefined;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden text-text">
      <div className="absolute inset-x-0 top-0 h-40 bg-linear-to-b from-black/55 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-56 bg-linear-to-t from-black/70 to-transparent" />
      <div className="absolute top-5 left-5 flex items-center gap-3">
        <button type="button" className={buttonClass} onClick={onExit}>
          <ArrowLeft size={14} aria-hidden="true" />
          Back to editor
          {fullscreen ? null : (
            <kbd className="font-mono text-[11px] text-muted">Esc</kbd>
          )}
        </button>
        <div className="min-w-0 @max-xl:hidden">
          <div className="truncate text-[15px] font-semibold">
            {map.name ?? "Untitled map"}
          </div>
          <div className="font-mono text-[11px] text-[#d6cfc3]">
            {slot} · Medium · Playtest
          </div>
        </div>
      </div>
      {inLevel && !finished ? (
        <Crosshair
          size={20}
          className="absolute top-1/2 left-1/2 -translate-1/2 text-text/70"
          aria-hidden="true"
        />
      ) : null}
      <aside
        aria-label="Run"
        className={`${panelClass} absolute top-5 right-5 w-[260px] overflow-hidden @max-xl:w-44`}
      >
        <Minimap map={map} status={status} />
        <dl className="m-0 grid gap-1.5 p-3">
          <Stat
            label="Enemies"
            value={status ? `${status.kills} / ${status.totalKills}` : "-"}
          />
          <Stat
            label="Items"
            value={status ? `${status.items} / ${status.totalItems}` : "-"}
          />
          <Stat
            label="Secrets"
            value={status ? `${status.secrets} / ${status.totalSecrets}` : "-"}
          />
          <Stat label="Time" value={status ? formatTime(status.tics) : "-"} />
        </dl>
        <div className="flex items-center gap-1 border-t border-line px-2 py-1.5">
          <button
            type="button"
            className={iconButtonClass}
            aria-label={sound.muted ? "Unmute" : "Mute"}
            aria-pressed={sound.muted}
            title={sound.muted ? "Unmute" : "Mute"}
            onClick={(event) => {
              onSoundChange({ ...sound, muted: !sound.muted });
              // A mouse click shouldn't take the keys away from the game.
              if (event.detail > 0) onControlUsed();
            }}
          >
            <SoundIcon size={15} aria-hidden="true" />
          </button>
          <Slider
            className="slider min-w-0 flex-1 justify-center"
            data-game-control=""
            value={sound.volume}
            min={0}
            max={maxVolume}
            step={1}
            onValueChange={(volume) =>
              onSoundChange({ volume: volume as number, muted: false })
            }
            onPointerUp={onControlUsed}
          >
            <SliderControl className="slider-control">
              <SliderTrack className="slider-track">
                <SliderIndicator className="slider-indicator" />
                <SliderThumb className="slider-thumb" aria-label="Volume" />
              </SliderTrack>
            </SliderControl>
          </Slider>
          <button
            type="button"
            className={iconButtonClass}
            aria-label="Restart"
            title="Restart"
            onClick={onRestart}
          >
            <RotateCcw size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={iconButtonClass}
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={onToggleFullscreen}
          >
            <FullscreenIcon size={15} aria-hidden="true" />
          </button>
        </div>
        {audioUnavailable ? (
          <p className="px-3 pb-2 text-xs text-muted">
            Sound needs HTTPS or localhost.
          </p>
        ) : null}
      </aside>
      {finished && status ? (
        <section
          aria-label="Level complete"
          className={`${panelClass} absolute top-1/2 left-1/2 grid w-[min(320px,calc(100%-32px))] -translate-1/2 gap-3 border border-[#3a352e] p-4`}
        >
          <h2 className="m-0 text-xl font-semibold">Level complete</h2>
          <p className="m-0 font-mono text-xs text-muted">
            {formatTime(status.tics)} · {status.kills} / {status.totalKills}{" "}
            enemies
          </p>
          <div className="flex gap-2">
            <button type="button" className="button" onClick={onRestart}>
              Play again
            </button>
            <button type="button" className="button primary" onClick={onExit}>
              Back to editor
            </button>
          </div>
        </section>
      ) : null}
      {showHelp && !finished ? (
        <p className="absolute inset-x-4 bottom-24 m-0 text-center text-xs text-[#d6cfc3]">
          WASD move · ←→ turn · Space fire · E use · Shift run · Tab automap
        </p>
      ) : null}
      {noteSaved ? (
        <p
          role="status"
          className="absolute inset-x-4 bottom-24 m-0 text-center text-[#d6cfc3]"
        >
          Note saved to this spot.
        </p>
      ) : null}
      {noteOpen ? <NoteForm onSave={onSaveNote} /> : null}
      <div className="absolute inset-x-5 bottom-5 flex items-end justify-between gap-4">
        {inLevel && status ? (
          <div className="flex items-end gap-9 @max-2xl:gap-4">
            <Vital label="Health" value={status.health} />
            <Vital label="Armor" value={status.armor} />
            <Vital
              label={ammoName ?? "Ammo"}
              value={ammoName ? status.ammo : "-"}
              accent
            />
            <div className="pb-1.5">
              <div className="mb-1.5 font-mono text-[11px] text-[#d6cfc3]">
                KEYS
              </div>
              <div className="flex h-[22px] gap-1">
                {keyStyles.map(({ label, icon: Icon, color }, index) =>
                  status.keys & (1 << index) ? (
                    <Icon
                      key={label}
                      size={22}
                      role="img"
                      aria-label={label}
                      style={{ color }}
                    />
                  ) : null,
                )}
              </div>
            </div>
          </div>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={!inLevel}
            onClick={onOpenNote}
          >
            Leave a note
            <kbd className="font-mono text-[11px] text-ember">N</kbd>
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={!inLevel}
            onClick={onEditSpot}
          >
            Edit this spot
            <kbd className="font-mono text-[11px] text-ember">F2</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

export { formatTime, GameHud };
