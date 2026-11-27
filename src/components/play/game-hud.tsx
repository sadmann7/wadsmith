import {
  ArrowLeft,
  ArrowRight,
  Crosshair,
  Ghost,
  KeyRound,
  Loader,
  Maximize,
  Minimize,
  RotateCcw,
  ShieldCheck,
  Skull,
  Volume2,
  VolumeX,
} from "lucide-react";
import * as React from "react";

import type { MouseMode } from "@/lib/engine/mouse-capture";
import type { GameMap, KeyColor } from "@/lib/map/types";

import { MapPlan } from "@/components/map-plan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { skillNames } from "@/lib/engine/coop";
import {
  fromEngine,
  type GameMode,
  heldKeys,
  isInView,
  minimapKeys,
  type MinimapLineKind,
  minimapLines,
  minimapView,
  showsCrosshair,
} from "@/lib/engine/minimap";
import { playerColor } from "@/lib/engine/player-colors";
import {
  type Cheats,
  fragLimit,
  type GameStatus,
  maxVolume,
  minimapSpan,
  type Screen,
  screenSize,
  type Skill,
} from "@/lib/engine/runtime";

import { PlayerBadge } from "./coop-ui";

interface SoundSettings {
  volume: number;
  muted: boolean;
}

interface OtherPlayer {
  peer: number;
  slot: number;
  x: number;
  y: number;
}

interface NextLevel {
  map: GameMap;
  title: string;
  slot: string;
}

export interface ScoreRow {
  peer: number;
  slot: number;
  name: string;
  host: boolean;
  you: boolean;
  frags: number;
  deaths: number;
  kills: number;
  items: number;
  secrets: number;
  ping: number | null;
}

const ticsPerSecond = 35;
const ammoNames = ["Bullets", "Shells", "Cells", "Rockets"];
const lowHealth = 25;

const panelClass = "pointer-events-auto rounded-[3px] bg-card/90";
const buttonClass = `${panelClass} flex items-center gap-2 border-0 px-3 py-2 text-foreground hover:bg-muted`;
const noticeClass = "m-0 rounded-[3px] bg-void/50 px-2.5 py-1 text-xs";
const iconButtonClass =
  "flex size-[30px] items-center justify-center rounded-[3px] border-0 bg-transparent p-0 text-muted-foreground hover:bg-muted hover:text-foreground";

export function formatTime(tics: number) {
  const seconds = Math.floor(tics / ticsPerSecond);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

interface GameTopBarProps {
  title: string;
  slot: string;
  par: number | null;
  status: GameStatus | null;
  sound: SoundSettings;
  fullscreen: boolean;
  coop: "host" | "guest" | null;
  skill: Skill;
  deathmatch: boolean;
  episode: boolean;
  exit: { to: string | null };
  screen: Screen;
  cheats: Cheats | null;
  crosshair: boolean;
  onCrosshairChange: (crosshair: boolean) => void;
  onSoundChange: (sound: SoundSettings) => void;
  onScreenChange: (screen: Screen) => void;
  onCheatsChange: (cheats: Cheats) => void;
  onRestart: () => void;
  onToggleFullscreen: () => void;
  onExit: () => void;
  onControlUsed: () => void;
}

export function GameTopBar({
  title,
  slot,
  par,
  status,
  sound,
  fullscreen,
  coop,
  skill,
  deathmatch,
  episode,
  exit,
  screen,
  cheats,
  crosshair,
  onCrosshairChange,
  onSoundChange,
  onScreenChange,
  onCheatsChange,
  onRestart,
  onToggleFullscreen,
  onExit,
  onControlUsed,
}: GameTopBarProps) {
  const FullscreenIcon = fullscreen ? Minimize : Maximize;
  const SoundIcon = sound.muted ? VolumeX : Volume2;
  const size = screenSize(screen);
  const mode = deathmatch
    ? "Deathmatch"
    : coop
      ? "Co-op"
      : episode
        ? "Episode"
        : "Solo";
  return (
    <header className="flex h-[48px] min-w-0 items-center gap-4 border-b border-border bg-card px-3 text-foreground max-[640px]:gap-2">
      <Button className="shrink-0" onClick={onExit}>
        <ArrowLeft size={14} aria-hidden="true" />
        <span>
          Exit
          {exit.to ? (
            <span className="text-muted-foreground max-[640px]:hidden">
              {" "}
              to {exit.to}
            </span>
          ) : null}
        </span>
        {fullscreen ? null : (
          <kbd className="font-mono text-xs text-muted-foreground max-[640px]:hidden">
            Esc
          </kbd>
        )}
      </Button>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="shrink-0 font-mono text-xs text-muted-foreground max-[480px]:hidden">
          {slot}
        </span>
        <span className="truncate text-base font-semibold">{title}</span>
        <span className="shrink-0 rounded-full border border-input px-2 py-0.5 font-mono text-xs tracking-[0.06em] text-foreground uppercase max-[640px]:hidden">
          {mode} · {skillNames[skill]}
        </span>
      </div>
      <span
        aria-label="Time"
        className="shrink-0 font-mono text-sm text-foreground"
      >
        {status ? formatTime(status.tics) : "0:00"}
        {par ? (
          <span className="text-muted-foreground max-[640px]:hidden">
            {" "}
            / par {formatTime(par * ticsPerSecond)}
          </span>
        ) : null}
      </span>
      <span aria-hidden="true" className="separator max-[640px]:hidden" />
      <div className="flex shrink-0 items-center gap-1">
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
          label="Volume"
          className="w-24 justify-center max-[640px]:hidden"
          data-game-control=""
          value={sound.volume}
          min={0}
          max={maxVolume}
          step={1}
          onValueChange={(volume) =>
            onSoundChange({ volume: volume as number, muted: false })
          }
          onPointerUp={onControlUsed}
        />
        {cheats ? (
          <>
            <span aria-hidden="true" className="separator max-[640px]:hidden" />
            <button
              type="button"
              className={`${iconButtonClass} aria-pressed:text-primary`}
              aria-label="God mode"
              aria-pressed={cheats.god}
              title={cheats.god ? "God mode on" : "God mode"}
              onClick={(event) => {
                onCheatsChange({ ...cheats, god: !cheats.god });
                if (event.detail > 0) onControlUsed();
              }}
            >
              <ShieldCheck size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`${iconButtonClass} aria-pressed:text-primary`}
              aria-label="No clipping"
              aria-pressed={cheats.noclip}
              title={cheats.noclip ? "No clipping on" : "No clipping"}
              onClick={(event) => {
                onCheatsChange({ ...cheats, noclip: !cheats.noclip });
                if (event.detail > 0) onControlUsed();
              }}
            >
              <Ghost size={15} aria-hidden="true" />
            </button>
            <span aria-hidden="true" className="separator max-[640px]:hidden" />
          </>
        ) : null}
        {coop ? null : (
          <>
            <button
              type="button"
              className={`${iconButtonClass} text-sm font-medium aria-pressed:text-primary`}
              aria-label="Widescreen"
              aria-pressed={screen.widescreen}
              title={`${screen.widescreen ? "16:9" : "4:3"}, restarts the level`}
              onClick={() =>
                onScreenChange({ ...screen, widescreen: !screen.widescreen })
              }
            >
              16:9
            </button>
            <button
              type="button"
              className={`${iconButtonClass} text-sm font-medium aria-pressed:text-primary`}
              aria-label="Double resolution"
              aria-pressed={screen.resolution === "high"}
              title={`${size.width}×${size.height}, restarts the level`}
              onClick={() =>
                onScreenChange({
                  ...screen,
                  resolution: screen.resolution === "high" ? "classic" : "high",
                })
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
          className={`${iconButtonClass} aria-pressed:text-primary`}
          aria-label="Crosshair"
          aria-pressed={crosshair}
          title={crosshair ? "Crosshair on" : "Crosshair off"}
          onClick={(event) => {
            onCrosshairChange(!crosshair);
            if (event.detail > 0) onControlUsed();
          }}
        >
          <Crosshair size={15} aria-hidden="true" />
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
    </header>
  );
}

interface GameHudProps {
  map: GameMap | null;
  title: string;
  slot: string;
  par: number | null;
  status: GameStatus | null;
  fullscreen: boolean;
  showHelp: boolean;
  crosshair: boolean;
  skill: Skill;
  coop: "host" | "guest" | null;
  deathmatch: boolean;
  scores: ScoreRow[] | null;
  others: OtherPlayer[];
  stall: { names: string[]; since: number } | null;
  episode: boolean;
  between: { tally: GameStatus; next: NextLevel; onNext: () => void } | null;
  exit: { label: string; hint: string };
  canEdit: boolean;
  cheats: Cheats | null;
  noteOpen: boolean;
  mouseMode: MouseMode;
  noteSaved: boolean;
  finished: boolean;
  audioUnavailable: boolean;
  onRestart: () => void;
  onExit: () => void;
  onOpenNote: () => void;
  onSaveNote: (text: string) => void;
  onEditSpot: () => void;
}

export function GameHud({
  map,
  title,
  slot,
  par,
  status,
  fullscreen,
  showHelp,
  crosshair,
  skill,
  coop,
  deathmatch,
  scores,
  others,
  stall,
  episode,
  between,
  exit,
  canEdit,
  cheats,
  noteOpen,
  mouseMode,
  noteSaved,
  finished,
  audioUnavailable,
  onRestart,
  onExit,
  onOpenNote,
  onSaveNote,
  onEditSpot,
}: GameHudProps) {
  const inLevel = status?.inLevel ?? false;
  const ammoName = status ? ammoNames[status.ammoType] : undefined;
  const scoresOpen = scores !== null && inLevel && !finished;
  const automap = status?.automap ?? false;
  const showsDot =
    status !== null &&
    showsCrosshair({
      enabled: crosshair,
      mouseMode,
      inLevel,
      health: status.health,
      automap,
      covered: finished || noteOpen || between !== null || scoresOpen,
    });
  const tabHelp = coop ? "Tab scores" : "Tab automap";
  const help =
    mouseMode === "locked"
      ? `WASD move · E use · Shift run · ${tabHelp} · Esc release mouse`
      : `${mouseMode === "denied" ? "" : "Click to aim with the mouse · "}WASD move · ←→ turn · Space fire · E use · ${tabHelp}`;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden text-foreground">
      <div
        className={`absolute inset-x-0 bottom-0 h-40 bg-linear-to-t from-void/60 to-transparent ${automap ? "hidden" : ""}`}
      />
      {showsDot ? (
        <span
          aria-hidden="true"
          data-crosshair=""
          className="absolute top-1/2 left-1/2 size-1 -translate-1/2 rounded-full bg-foreground/90 shadow-[0_0_0_1px_var(--color-void)]"
        />
      ) : null}
      <aside
        aria-label="Run"
        className="absolute top-5 right-5 grid max-w-[calc(100%-40px)] justify-items-end gap-1.5 text-right"
      >
        <dl className="m-0 flex flex-wrap justify-end gap-x-3 gap-y-1 rounded-[3px] bg-void/50 px-2.5 py-1.5 font-mono text-xs">
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
              {status?.totalItems ? (
                <Stat
                  label="Items"
                  value={`${status.items} / ${status.totalItems}`}
                />
              ) : null}
              <Stat
                label="Secrets"
                value={
                  status ? `${status.secrets} / ${status.totalSecrets}` : "-"
                }
              />
            </>
          )}
        </dl>
        {cheats && (cheats.god || cheats.noclip) ? (
          <p role="status" className={`${noticeClass} text-primary`}>
            Cheats on:{" "}
            {[cheats.god && "god mode", cheats.noclip && "no clipping"]
              .filter(Boolean)
              .join(", ")}
          </p>
        ) : null}
        {audioUnavailable ? (
          <p className={`${noticeClass} text-muted-foreground`}>
            Sound needs HTTPS or localhost.
          </p>
        ) : null}
        {mouseMode === "denied" ? (
          <p className={`${noticeClass} text-muted-foreground`}>
            This browser won't capture the mouse. Clicking fires.
          </p>
        ) : null}
      </aside>
      {finished && status ? (
        <section
          aria-label={
            deathmatch
              ? "Match over"
              : episode
                ? "Episode complete"
                : "Level complete"
          }
          className={`${panelClass} absolute top-1/2 left-1/2 grid w-[min(320px,calc(100%-32px))] -translate-1/2 gap-3 border border-input p-4`}
        >
          <h2 className="m-0 text-xl font-semibold">
            {deathmatch
              ? "Match over"
              : episode
                ? "Episode complete"
                : "Level complete"}
          </h2>
          <p className="m-0 font-mono text-xs text-muted-foreground">
            {formatTime(status.tics)} ·{" "}
            {deathmatch
              ? `${status.frags} ${status.frags === 1 ? "frag" : "frags"}`
              : `${status.kills} / ${status.totalKills} enemies`}
          </p>
          <div className="flex gap-2">
            {coop ? null : <Button onClick={onRestart}>Play again</Button>}
            <Button variant="primary" onClick={onExit}>
              {exit.label}
            </Button>
          </div>
        </section>
      ) : null}
      {between ? (
        <BetweenLevels
          slot={slot}
          title={title}
          status={between.tally}
          next={between.next}
          exitLabel={exit.label}
          onExit={onExit}
          onNext={between.onNext}
        />
      ) : null}
      {stall && !finished ? (
        <StallBanner names={stall.names} since={stall.since} />
      ) : null}
      {scoresOpen ? (
        <Scoreboard
          title={title}
          par={par}
          status={status}
          rows={scores}
          deathmatch={deathmatch}
        />
      ) : null}
      {mouseMode === "released" && !finished && !noteOpen ? (
        <section
          aria-label={coop ? "Mouse released" : "Paused"}
          className="absolute top-1/2 left-1/2 grid w-[min(320px,calc(100%-32px))] -translate-1/2 gap-1 rounded-[3px] border border-input bg-card/90 p-4 text-center"
        >
          <h2 className="m-0 text-xl font-semibold">Paused</h2>
          <p role="status" className="m-0 text-foreground">
            Click the game to capture the mouse and carry on.
          </p>
          <p className="m-0 font-mono text-xs text-muted-foreground">
            {fullscreen ? "Esc leaves fullscreen" : exit.hint}
          </p>
        </section>
      ) : null}
      {noteOpen ? <NoteForm onSave={onSaveNote} /> : null}
      <div className="absolute inset-x-5 bottom-5 flex items-end justify-between gap-4">
        <div className="grid min-w-0 gap-3">
          {noteSaved ? (
            <p role="status" className="m-0 text-sm text-foreground">
              Note saved to this spot.
            </p>
          ) : showHelp && !finished && !automap && mouseMode !== "released" ? (
            <p className="m-0 max-w-[520px] font-mono text-xs text-muted-foreground @max-xl:hidden">
              {help}
            </p>
          ) : null}
          {/* The automap brings back Doom's own status bar along the bottom. */}
          {inLevel && status && !automap ? (
            <div className="flex items-end gap-6 @max-2xl:gap-4">
              <Vital
                label="Health"
                value={status.health}
                unit="%"
                isLow={status.health <= lowHealth}
              />
              <Vital label="Armor" value={status.armor} unit="%" />
              <Vital
                label={ammoName ?? "Ammo"}
                value={ammoName ? status.ammo : "-"}
              />
              {/* Deathmatch hands every player every key. */}
              {deathmatch ? null : <HeldKeys bits={status.keys} />}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className={canEdit && !automap ? "flex gap-2" : "hidden"}>
            <button
              type="button"
              className={buttonClass}
              disabled={!inLevel}
              onClick={onOpenNote}
            >
              <span className="@max-xl:hidden">Leave a note</span>
              <span className="hidden @max-xl:inline">Note</span>
              <kbd className="font-mono text-xs text-muted-foreground @max-xl:hidden">
                N
              </kbd>
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={!inLevel}
              onClick={onEditSpot}
            >
              <span className="@max-xl:hidden">Edit this spot</span>
              <span className="hidden @max-xl:inline">Edit</span>
              <kbd className="font-mono text-xs text-muted-foreground @max-xl:hidden">
                F2
              </kbd>
            </button>
          </div>
          {map && status && inLevel && !automap ? (
            <Minimap
              map={map}
              status={status}
              others={others}
              skill={skill}
              mode={deathmatch ? "deathmatch" : coop ? "coop" : "solo"}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface EndGameConfirmProps {
  names: string[];
  onKeepPlaying: () => void;
  onEndGame: () => void;
}

export function EndGameConfirm({
  names,
  onKeepPlaying,
  onEndGame,
}: EndGameConfirmProps) {
  const keepPlaying = React.useRef<HTMLButtonElement>(null);
  const list = new Intl.ListFormat("en").format(names);

  React.useEffect(() => keepPlaying.current?.focus(), []);

  return (
    <section
      role="alertdialog"
      aria-labelledby="end-game-title"
      aria-describedby="end-game-body"
      className={`${panelClass} absolute top-3 left-3 z-30 grid w-[min(320px,calc(100%-24px))] gap-3.5 border border-input p-4 shadow-lg`}
    >
      <div className="grid gap-1.5">
        <h2 id="end-game-title" className="m-0 text-base font-semibold">
          End the game for everyone?
        </h2>
        <p id="end-game-body" className="m-0 text-sm text-foreground">
          {list} {names.length === 1 ? "is" : "are"} still playing, and their
          game ends too.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          ref={keepPlaying}

          onClick={onKeepPlaying}
        >
          Keep playing
        </Button>
        <Button
          variant="destructive"

          onClick={onEndGame}
        >
          End game
        </Button>
      </div>
    </section>
  );
}

const minimapPixels = 192;
const unit = minimapSpan / minimapPixels;

const keyFills: Record<KeyColor, string> = {
  blue: "var(--color-key-blue)",
  yellow: "var(--color-key-yellow)",
  red: "var(--color-key-red)",
};
const arrowPath = "M1 0L-0.7 0.6L-0.35 0L-0.7-0.6Z";
const monsterPath = "M1 0L-0.8 0.75L-0.8-0.75Z";

const lineStyles: Record<MinimapLineKind, { stroke: string; width: number }> = {
  wall: { stroke: "var(--color-map-wall)", width: 1.5 },
  step: { stroke: "var(--color-map-portal)", width: 1 },
  door: { stroke: "var(--color-map-door)", width: 2 },
  exit: { stroke: "var(--color-success)", width: 2.5 },
};

interface MinimapProps {
  map: GameMap;
  status: GameStatus;
  others: OtherPlayer[];
  skill: Skill;
  mode: GameMode;
}

function Minimap({ map, status, others, skill, mode }: MinimapProps) {
  const lines = React.useMemo(() => minimapLines(map), [map]);
  const lineLayer = React.useMemo(
    () =>
      lines.map(({ key, from, to, kind, lock }) => (
        <line
          key={key}
          data-kind={kind}
          data-lock={lock}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={lock ? keyFills[lock] : lineStyles[kind].stroke}
          strokeWidth={lineStyles[kind].width}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )),
    [lines],
  );
  const player = fromEngine(status);
  const view = minimapView(player);
  const margin = 4 * unit;
  const keys = minimapKeys(map, status.keys, { skill, mode }).filter((key) =>
    isInView(key, view, margin),
  );
  const monsters = status.monsters
    .map((monster) => ({ ...fromEngine(monster), angle: monster.angle }))
    .filter((monster) => isInView(monster, view, margin));
  const half = minimapSpan / 2;
  return (
    <div className="overflow-hidden rounded-[3px] bg-map-bg/75 ring-1 ring-border/60 backdrop-blur-[2px] @max-xl:hidden">
      <svg
        role="img"
        aria-label="Minimap"
        className="block size-48 @max-2xl:size-32"
        viewBox={`${-half} ${-half} ${minimapSpan} ${minimapSpan}`}
      >
        <g
          className="transition-transform duration-100 ease-linear motion-reduce:transition-none"
          style={{ transform: `translate(${-player.x}px, ${-player.y}px)` }}
        >
          {lineLayer}
          {keys.map((key) =>
            key.skull ? (
              <circle
                key={key.id}
                data-key={key.color}
                cx={key.x}
                cy={key.y}
                r={3 * unit}
                fill={keyFills[key.color]}
              />
            ) : (
              <rect
                key={key.id}
                data-key={key.color}
                x={key.x - 3 * unit}
                y={key.y - 2 * unit}
                width={6 * unit}
                height={4 * unit}
                rx={unit}
                fill={keyFills[key.color]}
              />
            ),
          )}
          {monsters.map((monster, index) => (
            <path
              // The engine gives monsters no lasting id; order is stable
              // within a level.
              key={index}
              data-monster=""
              d={monsterPath}
              fill="var(--color-destructive)"
              transform={`translate(${monster.x} ${monster.y}) rotate(${-monster.angle}) scale(${4.5 * unit})`}
            />
          ))}
          {others.map((other) => (
            <circle
              key={other.peer}
              data-peer={other.peer}
              cx={other.x}
              cy={0 - other.y}
              r={3.5 * unit}
              fill={playerColor(other.slot).fill}
              stroke="var(--color-map-bg)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
        <path
          d={arrowPath}
          fill="var(--color-foreground)"
          stroke="var(--color-map-bg)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          transform={`rotate(${-status.angle}) scale(${7 * unit})`}
        />
      </svg>
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
}

function Stat({ label, value }: StatProps) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 text-foreground tabular-nums">{value}</dd>
    </div>
  );
}

interface HeldKeysProps {
  bits: number;
}

const keyNames: Record<KeyColor, string> = {
  blue: "Blue",
  yellow: "Yellow",
  red: "Red",
};

function HeldKeys({ bits }: HeldKeysProps) {
  const keys = heldKeys(bits);
  if (keys.length === 0) return null;
  return (
    <ul aria-label="Keys" className="m-0 flex list-none gap-1 p-0 pb-1">
      {keys.map(({ color, skull }) => {
        const Icon = skull ? Skull : KeyRound;
        const label = `${keyNames[color]} ${skull ? "skull key" : "key"}`;
        return (
          <li
            key={label}
            className="grid size-7 place-items-center rounded-[3px] bg-void/50"
          >
            <Icon
              size={18}
              role="img"
              aria-label={label}
              style={{ color: keyFills[color] }}
            />
          </li>
        );
      })}
    </ul>
  );
}
interface BetweenLevelsProps {
  slot: string;
  title: string;
  status: GameStatus | null;
  next: NextLevel;
  exitLabel: string;
  onExit: () => void;
  onNext: () => void;
}

function BetweenLevels({
  slot,
  title,
  status,
  next,
  exitLabel,
  onExit,
  onNext,
}: BetweenLevelsProps) {
  return (
    <section
      aria-label={`${slot} complete`}
      className={`${panelClass} absolute top-1/2 left-1/2 grid w-[min(420px,calc(100%-32px))] -translate-1/2 gap-4 border border-input p-6`}
    >
      <div className="grid gap-1">
        <span className="font-mono text-xs tracking-wide text-success uppercase">
          {slot} complete
        </span>
        <h2 className="m-0 text-[26px] leading-tight font-bold">{title}</h2>
      </div>
      {status ? (
        <dl
          className={`m-0 grid gap-3 border-y border-border py-3 ${status.totalItems ? "grid-cols-4" : "grid-cols-3"}`}
        >
          <Tally
            label="Kills"
            value={`${status.kills} / ${status.totalKills}`}
          />
          {status.totalItems ? (
            <Tally
              label="Items"
              value={`${status.items} / ${status.totalItems}`}
            />
          ) : null}
          <Tally
            label="Secrets"
            value={`${status.secrets} / ${status.totalSecrets}`}
          />
          <Tally label="Time" value={formatTime(status.tics)} />
        </dl>
      ) : null}
      <div className="flex items-center gap-3">
        <MapPlan
          map={next.map}
          className="h-[48px] w-[80px] shrink-0 rounded-[2px] bg-background"
        />
        <div className="grid min-w-0 gap-0.5">
          <span className="font-mono text-xs text-muted-foreground uppercase">
            Next · {next.slot}
          </span>
          <span className="truncate font-semibold">{next.title}</span>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={onExit}>{exitLabel}</Button>
        <Button variant="primary" onClick={onNext}>
          <ArrowRight size={14} aria-hidden="true" />
          Next map
        </Button>
      </div>
    </section>
  );
}

interface TallyProps {
  label: string;
  value: string;
}

function Tally({ label, value }: TallyProps) {
  return (
    <div className="grid gap-1">
      <dt className="font-mono text-xs text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="m-0 text-lg font-semibold">{value}</dd>
    </div>
  );
}

interface StallBannerProps {
  names: string[];
  since: number;
}

function StallBanner({ names, since }: StallBannerProps) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section
      role="status"
      aria-label="Waiting on a player"
      className={`${panelClass} absolute top-20 left-1/2 flex w-[min(400px,calc(100%-32px))] -translate-x-1/2 items-center gap-3 border border-warning px-4 py-3`}
    >
      <Loader
        size={18}
        aria-hidden="true"
        className="shrink-0 text-warning motion-safe:animate-spin"
      />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-base font-semibold">
          Waiting for {new Intl.ListFormat("en").format(names)}
        </span>
        <span className="text-sm text-muted-foreground">
          Everyone waits so the game stays in step.
        </span>
      </div>
      <span className="font-mono text-xs text-warning">
        {Math.max(0, Math.round((now - since) / 1000))} s
      </span>
    </section>
  );
}

const slowPingMs = 120;

interface ScoreboardProps {
  title: string;
  par: number | null;
  status: GameStatus | null;
  rows: ScoreRow[];
  deathmatch: boolean;
}

function Scoreboard({ title, par, status, rows, deathmatch }: ScoreboardProps) {
  const columns = deathmatch
    ? (["frags", "deaths"] as const)
    : (["kills", "items", "secrets"] as const).filter(
        (column) => column !== "items" || status?.totalItems,
      );
  const sorted = deathmatch
    ? rows.toSorted((a, b) => b.frags - a.frags || a.peer - b.peer)
    : rows.toSorted((a, b) => a.peer - b.peer);
  const teamKills = rows.reduce((total, row) => total + row.kills, 0);
  const teamSecrets = rows.reduce((total, row) => total + row.secrets, 0);
  return (
    <section
      aria-label="Scoreboard"
      className={`${panelClass} absolute top-1/2 left-1/2 w-[min(600px,calc(100%-32px))] -translate-1/2 border border-input`}
    >
      <header className="flex items-end justify-between gap-4 border-b border-border px-5 py-3">
        <div className="grid gap-0.5">
          <h2 className="m-0 text-lg font-semibold">
            {deathmatch ? "Deathmatch" : "Co-op"}
          </h2>
          <span className="font-mono text-xs text-muted-foreground uppercase">
            {title}
            {status ? ` · ${formatTime(status.tics)}` : ""}
            {par ? ` / par ${formatTime(par * ticsPerSecond)}` : ""}
          </span>
        </div>
        <span className="font-mono text-xs text-foreground">
          {deathmatch
            ? `First to ${fragLimit} frags`
            : status
              ? `Kills ${teamKills} / ${status.totalKills} · Secrets ${teamSecrets} / ${status.totalSecrets}`
              : ""}
        </span>
      </header>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="font-mono text-xs text-muted-foreground uppercase">
            <th className="py-2 pl-5 font-normal" colSpan={2}>
              Player
            </th>
            {columns.map((column) => (
              <th key={column} className="px-3 py-2 text-right font-normal">
                {column}
              </th>
            ))}
            <th className="py-2 pr-5 text-right font-normal">Ping</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.peer}
              className={`border-t border-border ${row.you ? "bg-primary/10" : ""}`}
            >
              <td className="w-6 py-2.5 pl-5">
                <PlayerBadge slot={row.slot} />
              </td>
              <td className="py-2.5 pl-3">
                <span className="text-base font-semibold">{row.name}</span>
                {row.host ? (
                  <span className="ml-2 font-mono text-xs text-muted-foreground uppercase">
                    Host
                  </span>
                ) : null}
                {row.you ? (
                  <span className="ml-2 font-mono text-xs text-muted-foreground uppercase">
                    You
                  </span>
                ) : null}
              </td>
              {columns.map((column) => (
                <td key={column} className="px-3 py-2.5 text-right font-mono">
                  {row[column]}
                </td>
              ))}
              <td
                className={`py-2.5 pr-5 text-right font-mono text-xs ${row.ping !== null && row.ping > slowPingMs ? "text-warning" : "text-muted-foreground"}`}
              >
                {row.ping === null ? "—" : `${row.ping} ms`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <footer className="border-t border-border px-5 py-2 text-sm text-muted-foreground">
        Release Tab to hide
      </footer>
    </section>
  );
}

interface NoteFormProps {
  onSave: (text: string) => void;
}

function NoteForm({ onSave }: NoteFormProps) {
  const [text, setText] = React.useState("");
  return (
    <form
      aria-label="Leave a note"
      className={`${panelClass} absolute bottom-24 left-1/2 flex w-[min(460px,calc(100%-32px))] -translate-x-1/2 gap-2 border border-input p-2`}
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) onSave(text.trim());
      }}
    >
      <Input
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        aria-label="Note"
        maxLength={280}
        placeholder="What should change here?"
        className="min-w-0 flex-1"
        value={text}
        onValueChange={setText}
      />
      <Button variant="primary" type="submit" disabled={!text.trim()}>
        Save
      </Button>
    </form>
  );
}

interface VitalProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  isLow?: boolean;
}

function Vital({ label, value, unit, isLow = false }: VitalProps) {
  return (
    <div className="grid gap-1">
      <div className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={`text-4xl leading-none font-bold tabular-nums @max-2xl:text-2xl ${isLow ? "text-destructive" : ""}`}
      >
        {value}
        {unit ? (
          <span className="text-xl font-semibold text-muted-foreground @max-2xl:text-base">
            {unit}
          </span>
        ) : null}
      </div>
    </div>
  );
}
