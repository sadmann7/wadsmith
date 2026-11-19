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
import { useState, type ReactNode } from "react";

import { MapOutline } from "../editor/map-outline";
import { skillNames } from "./coop";
import type { GameMap } from "../map/types";
import type { MouseMode } from "./mouse-capture";
import {
  fragLimit,
  maxVolume,
  screenSizes,
  type GameStatus,
  type Resolution,
  type Skill,
} from "./runtime";

type SoundSettings = { volume: number; muted: boolean };

const ticsPerSecond = 35;
const ammoNames = ["Bullets", "Shells", "Cells", "Rockets"];
const keyStyles = [
  { label: "Blue key", icon: KeyRound, color: "var(--color-key-blue)" },
  { label: "Yellow key", icon: KeyRound, color: "var(--color-key-yellow)" },
  { label: "Red key", icon: KeyRound, color: "var(--color-key-red)" },
  { label: "Blue skull key", icon: Skull, color: "var(--color-key-blue)" },
  { label: "Yellow skull key", icon: Skull, color: "var(--color-key-yellow)" },
  { label: "Red skull key", icon: Skull, color: "var(--color-key-red)" },
];
const panelClass = "pointer-events-auto rounded-[3px] bg-surface/90";
const buttonClass = `${panelClass} flex items-center gap-2 border-0 px-3 py-2 text-fg hover:bg-surface-raised`;
const iconButtonClass =
  "flex size-7 items-center justify-center rounded-[3px] border-0 bg-transparent p-0 text-fg-muted hover:bg-surface-raised hover:text-fg";

function formatTime(tics: number) {
  const seconds = Math.floor(tics / ticsPerSecond);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Minimap({ map, status }: { map: GameMap; status: GameStatus | null }) {
  const radians = ((status?.angle ?? 0) * Math.PI) / 180;
  return (
    <MapOutline
      map={map}
      label="Minimap"
      className="block h-[162px] w-full bg-map-bg @max-2xl:hidden"
    >
      {(extent) =>
        status ? (
          <g transform={`translate(${status.x} ${0 - status.y})`}>
            <line
              x2={Math.cos(radians) * extent * 0.055}
              y2={-Math.sin(radians) * extent * 0.055}
              stroke="var(--color-thing-start)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
            <circle r={extent * 0.025} fill="var(--color-thing-start)" />
          </g>
        ) : null
      }
    </MapOutline>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
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
      <div className="font-mono text-[11px] text-fg-soft uppercase">
        {label}
      </div>
      <div
        className={`text-[44px] leading-none font-bold @max-2xl:text-2xl ${accent ? "text-accent" : ""}`}
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
      className={`${panelClass} absolute bottom-24 left-1/2 flex w-[min(460px,calc(100%-32px))] -translate-x-1/2 gap-2 border border-border-strong p-2`}
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
  title,
  slot,
  par,
  status,
  sound,
  fullscreen,
  showHelp,
  coop,
  skill,
  deathmatch,
  exit,
  canEdit,
  noteOpen,
  mouseMode,
  noteSaved,
  finished,
  audioUnavailable,
  onSoundChange,
  resolution,
  onResolutionChange,
  onRestart,
  onToggleFullscreen,
  onExit,
  onOpenNote,
  onSaveNote,
  onEditSpot,
  onControlUsed,
}: {
  map: GameMap;
  title: string;
  slot: string;
  par: number | null;
  status: GameStatus | null;
  sound: SoundSettings;
  fullscreen: boolean;
  showHelp: boolean;
  coop: "host" | "guest" | null;
  skill: Skill;
  deathmatch: boolean;
  exit: { label: string; hint: string };
  canEdit: boolean;
  noteOpen: boolean;
  mouseMode: MouseMode;
  noteSaved: boolean;
  finished: boolean;
  audioUnavailable: boolean;
  onSoundChange: (sound: SoundSettings) => void;
  resolution: Resolution;
  onResolutionChange: (resolution: Resolution) => void;
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
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden text-fg">
      <div className="absolute inset-x-0 top-0 h-40 bg-linear-to-b from-void/55 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-56 bg-linear-to-t from-void/70 to-transparent" />
      <div className="absolute top-5 left-5 flex items-center gap-3">
        <button type="button" className={buttonClass} onClick={onExit}>
          <ArrowLeft size={14} aria-hidden="true" />
          {exit.label}
          {fullscreen ? null : (
            <kbd className="font-mono text-[11px] text-fg-muted">Esc</kbd>
          )}
        </button>
        <div className="min-w-0 @max-xl:hidden">
          <div className="truncate text-[15px] font-semibold">{title}</div>
          <div className="font-mono text-[11px] text-fg-soft">
            {slot} · {skillNames[skill]} ·{" "}
            {deathmatch ? "Deathmatch" : coop ? "Co-op" : "Playtest"}
          </div>
        </div>
      </div>
      {inLevel && !finished ? (
        <Crosshair
          size={20}
          className="absolute top-1/2 left-1/2 -translate-1/2 text-fg/70"
          aria-hidden="true"
        />
      ) : null}
      <aside
        aria-label="Run"
        className={`${panelClass} absolute top-5 right-5 w-[260px] overflow-hidden @max-xl:w-44`}
      >
        <Minimap map={map} status={status} />
        <dl className="m-0 grid gap-1.5 p-3">
          {deathmatch ? (
            <Stat
              label="Frags"
              value={status ? `${status.frags} / ${fragLimit}` : "-"}
            />
          ) : (
            <>
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
                value={
                  status ? `${status.secrets} / ${status.totalSecrets}` : "-"
                }
              />
            </>
          )}
          <Stat
            label="Time"
            value={
              status
                ? `${formatTime(status.tics)}${par ? ` / par ${formatTime(par * ticsPerSecond)}` : ""}`
                : "-"
            }
          />
        </dl>
        <div className="flex items-center gap-1 border-t border-border px-2 py-1.5">
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
          {coop ? null : (
            <>
              <button
                type="button"
                className={`${iconButtonClass} text-xs font-medium aria-pressed:text-accent`}
                aria-label="Double resolution"
                aria-pressed={resolution === "high"}
                title={`${screenSizes[resolution].width}×${screenSizes[resolution].height}, restarts the level`}
                onClick={() =>
                  onResolutionChange(resolution === "high" ? "classic" : "high")
                }
              >
                2×
              </button>
              <button
                type="button"
                className={iconButtonClass}
                aria-label="Restart"
                title="Restart"
                onClick={onRestart}
              >
                <RotateCcw size={15} aria-hidden="true" />
              </button>
            </>
          )}
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
          <p className="px-3 pb-2 text-xs text-fg-muted">
            Sound needs HTTPS or localhost.
          </p>
        ) : null}
        {mouseMode === "denied" ? (
          <p className="px-3 pb-2 text-xs text-fg-muted">
            This browser won't capture the mouse. Clicking fires.
          </p>
        ) : null}
      </aside>
      {finished && status ? (
        <section
          aria-label={deathmatch ? "Match over" : "Level complete"}
          className={`${panelClass} absolute top-1/2 left-1/2 grid w-[min(320px,calc(100%-32px))] -translate-1/2 gap-3 border border-border-strong p-4`}
        >
          <h2 className="m-0 text-xl font-semibold">
            {deathmatch ? "Match over" : "Level complete"}
          </h2>
          <p className="m-0 font-mono text-xs text-fg-muted">
            {formatTime(status.tics)} ·{" "}
            {deathmatch
              ? `${status.frags} ${status.frags === 1 ? "frag" : "frags"}`
              : `${status.kills} / ${status.totalKills} enemies`}
          </p>
          <div className="flex gap-2">
            {coop ? null : (
              <button type="button" className="button" onClick={onRestart}>
                Play again
              </button>
            )}
            <button type="button" className="button primary" onClick={onExit}>
              {exit.label}
            </button>
          </div>
        </section>
      ) : null}
      {mouseMode === "released" && !finished && !noteOpen ? (
        <section
          aria-label={coop ? "Mouse released" : "Paused"}
          className="absolute top-1/2 left-1/2 grid w-[min(320px,calc(100%-32px))] -translate-1/2 gap-1 rounded-[3px] border border-border-strong bg-surface/90 p-4 text-center"
        >
          <h2 className="m-0 text-xl font-semibold">Paused</h2>
          <p role="status" className="m-0 text-fg-soft">
            Click the game to capture the mouse and carry on.
          </p>
          <p className="m-0 font-mono text-xs text-fg-muted">
            {fullscreen ? "Esc leaves fullscreen" : exit.hint}
          </p>
        </section>
      ) : null}
      {showHelp && !finished && mouseMode !== "released" ? (
        <p className="absolute inset-x-4 bottom-24 m-0 text-center text-xs text-fg-soft">
          {mouseMode === "locked"
            ? "Mouse turn · Left click fire · WASD move · E use · Shift run · Tab automap · Esc release mouse"
            : `${mouseMode === "denied" ? "" : "Click to use the mouse · "}WASD move · ←→ turn · Space fire · E use · Shift run · Tab automap`}
        </p>
      ) : null}
      {noteSaved ? (
        <p
          role="status"
          className="absolute inset-x-4 bottom-24 m-0 text-center text-fg-soft"
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
            {/* Deathmatch hands every player every key. */}
            <div className={deathmatch ? "hidden" : "pb-1.5"}>
              <div className="mb-1.5 font-mono text-[11px] text-fg-soft">
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
        <div className={canEdit ? "flex gap-2" : "hidden"}>
          <button
            type="button"
            className={buttonClass}
            disabled={!inLevel}
            onClick={onOpenNote}
          >
            Leave a note
            <kbd className="font-mono text-[11px] text-accent">N</kbd>
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={!inLevel}
            onClick={onEditSpot}
          >
            Edit this spot
            <kbd className="font-mono text-[11px] text-accent">F2</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

export { formatTime, GameHud };
