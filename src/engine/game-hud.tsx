import {
  ArrowLeft,
  ArrowRight,
  Crosshair,
  KeyRound,
  Loader,
  Maximize,
  Minimize,
  RotateCcw,
  Skull,
  Volume2,
  VolumeX,
} from "lucide-react";
import * as React from "react";

import { MapOutline } from "@/components/map-outline";
import { MapPlan } from "@/components/map-plan";
import { skillNames } from "./coop";
import { PlayerBadge } from "./coop-ui";
import type { GameMap } from "@/map/types";
import type { MouseMode } from "./mouse-capture";
import {
  fragLimit,
  maxVolume,
  screenSize,
  type GameStatus,
  type Screen,
  type Skill,
} from "./runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";

interface SoundSettings {
  volume: number;
  muted: boolean;
}

interface OtherPlayer {
  peer: number;
  x: number;
  y: number;
}

interface NextLevel {
  map: GameMap;
  title: string;
  slot: string;
}

interface ScoreRow {
  peer: number;
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
const keyStyles = [
  { label: "Blue key", icon: KeyRound, color: "var(--color-key-blue)" },
  { label: "Yellow key", icon: KeyRound, color: "var(--color-key-yellow)" },
  { label: "Red key", icon: KeyRound, color: "var(--color-key-red)" },
  { label: "Blue skull key", icon: Skull, color: "var(--color-key-blue)" },
  { label: "Yellow skull key", icon: Skull, color: "var(--color-key-yellow)" },
  { label: "Red skull key", icon: Skull, color: "var(--color-key-red)" },
];
const slowPingMs = 120;
const panelClass = "pointer-events-auto rounded-[3px] bg-card/90";
const buttonClass = `${panelClass} flex items-center gap-2 border-0 px-3 py-2 text-foreground hover:bg-muted`;
const iconButtonClass =
  "flex size-[30px] items-center justify-center rounded-[3px] border-0 bg-transparent p-0 text-muted-foreground hover:bg-muted hover:text-foreground";

function formatTime(tics: number) {
  const seconds = Math.floor(tics / ticsPerSecond);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Minimap({
  map,
  status,
  others,
}: {
  map: GameMap;
  status: GameStatus | null;
  others: OtherPlayer[];
}) {
  const radians = ((status?.angle ?? 0) * Math.PI) / 180;
  return (
    <MapOutline
      map={map}
      label="Minimap"
      className="block h-[162px] w-full bg-map-bg @max-2xl:hidden"
    >
      {(extent) =>
        status ? (
          <>
            {others.map((other) => (
              <circle
                key={other.peer}
                data-peer={other.peer}
                cx={other.x}
                cy={0 - other.y}
                r={extent * 0.02}
                fill="var(--color-foreground)"
                stroke="var(--color-map-bg)"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            ))}
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
          </>
        ) : null
      }
    </MapOutline>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 font-mono text-xs">{value}</dd>
    </div>
  );
}

function Vital({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-xs text-foreground uppercase">{label}</div>
      <div className="text-[44px] leading-none font-bold @max-2xl:text-2xl">
        {value}
      </div>
    </div>
  );
}

function Scoreboard({
  title,
  par,
  status,
  rows,
  deathmatch,
}: {
  title: string;
  par: number | null;
  status: GameStatus | null;
  rows: ScoreRow[];
  deathmatch: boolean;
}) {
  const columns = deathmatch
    ? (["frags", "deaths"] as const)
    : (["kills", "items", "secrets"] as const);
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
                <PlayerBadge peer={row.peer} />
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

function Tally({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="font-mono text-xs text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="m-0 text-lg font-semibold">{value}</dd>
    </div>
  );
}

function BetweenLevels({
  slot,
  title,
  status,
  next,
  exitLabel,
  onExit,
  onNext,
}: {
  slot: string;
  title: string;
  status: GameStatus | null;
  next: NextLevel;
  exitLabel: string;
  onExit: () => void;
  onNext: () => void;
}) {
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
        <dl className="m-0 grid grid-cols-4 gap-3 border-y border-border py-3">
          <Tally
            label="Kills"
            value={`${status.kills} / ${status.totalKills}`}
          />
          <Tally
            label="Items"
            value={`${status.items} / ${status.totalItems}`}
          />
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

function StallBanner({ names, since }: { names: string[]; since: number }) {
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

function NoteForm({ onSave }: { onSave: (text: string) => void }) {
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

function GameTopBar({
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
  onSoundChange,
  onScreenChange,
  onRestart,
  onToggleFullscreen,
  onExit,
  onControlUsed,
}: {
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
  onSoundChange: (sound: SoundSettings) => void;
  onScreenChange: (screen: Screen) => void;
  onRestart: () => void;
  onToggleFullscreen: () => void;
  onExit: () => void;
  onControlUsed: () => void;
}) {
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

function GameHud({
  map,
  title,
  slot,
  par,
  status,
  fullscreen,
  showHelp,
  coop,
  deathmatch,
  scores,
  others,
  stall,
  episode,
  between,
  exit,
  canEdit,
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
}: {
  map: GameMap | null;
  title: string;
  slot: string;
  par: number | null;
  status: GameStatus | null;
  fullscreen: boolean;
  showHelp: boolean;
  coop: "host" | "guest" | null;
  deathmatch: boolean;
  scores: ScoreRow[] | null;
  others: OtherPlayer[];
  stall: { names: string[]; since: number } | null;
  episode: boolean;
  between: { tally: GameStatus; next: NextLevel; onNext: () => void } | null;
  exit: { label: string; hint: string };
  canEdit: boolean;
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
}) {
  const inLevel = status?.inLevel ?? false;
  const ammoName = status ? ammoNames[status.ammoType] : undefined;
  const tabHelp = coop ? "Tab scores" : "Tab automap";
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden text-foreground">
      <div className="absolute inset-x-0 bottom-0 h-56 bg-linear-to-t from-void/70 to-transparent" />
      {inLevel && !finished ? (
        <Crosshair
          size={20}
          className="absolute top-1/2 left-1/2 -translate-1/2 text-foreground/70"
          aria-hidden="true"
        />
      ) : null}
      <aside
        aria-label="Run"
        className="pointer-events-auto absolute top-0 right-5 w-[260px] overflow-hidden rounded-b-[3px] border border-t-0 border-border bg-card @max-xl:w-44"
      >
        {map ? <Minimap map={map} status={status} others={others} /> : null}
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
        </dl>
        {audioUnavailable ? (
          <p className="px-3 pb-2 text-sm text-muted-foreground">
            Sound needs HTTPS or localhost.
          </p>
        ) : null}
        {mouseMode === "denied" ? (
          <p className="px-3 pb-2 text-sm text-muted-foreground">
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
      {scores && inLevel && !finished ? (
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
      {showHelp && !finished && mouseMode !== "released" ? (
        <p className="absolute inset-x-4 bottom-24 m-0 text-center text-sm text-foreground">
          {mouseMode === "locked"
            ? `Mouse turn · Left click fire · WASD move · E use · Shift run · ${tabHelp} · Esc release mouse`
            : `${mouseMode === "denied" ? "" : "Click to use the mouse · "}WASD move · ←→ turn · Space fire · E use · Shift run · ${tabHelp}`}
        </p>
      ) : null}
      {noteSaved ? (
        <p
          role="status"
          className="absolute inset-x-4 bottom-24 m-0 text-center text-foreground"
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
            />
            {/* Deathmatch hands every player every key. */}
            <div className={deathmatch ? "hidden" : "pb-1.5"}>
              <div className="mb-1.5 font-mono text-xs text-foreground">
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
            <kbd className="font-mono text-xs text-muted-foreground">N</kbd>
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={!inLevel}
            onClick={onEditSpot}
          >
            Edit this spot
            <kbd className="font-mono text-xs text-muted-foreground">F2</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

function EndGameConfirm({
  names,
  onKeepPlaying,
  onEndGame,
}: {
  names: string[];
  onKeepPlaying: () => void;
  onEndGame: () => void;
}) {
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

export { EndGameConfirm, formatTime, GameHud, GameTopBar, type ScoreRow };
