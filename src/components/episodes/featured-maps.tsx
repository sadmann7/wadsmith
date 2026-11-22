import {
  Copy,
  FolderOpen,
  HardDrive,
  Images,
  Play,
  Undo2,
  Users,
} from "lucide-react";
import * as React from "react";

import { AppShell, type SidebarProps } from "@/components/app-sidebar";
import { MapPlan } from "@/components/map-plan";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type GameInfo, slotCount } from "@/lib/engine/game";
import { fragLimit } from "@/lib/engine/runtime";
import { formatPar } from "@/lib/episodes/episode-data";
import { thingCatalog } from "@/lib/map/catalog";
import {
  type FeaturedMap,
  featuredMaps,
  type FeaturedMode,
} from "@/lib/map/featured";

const modes: Record<FeaturedMode, { label: string; dot: string }> = {
  single: { label: "Single player", dot: "bg-info" },
  coop: { label: "Co-op", dot: "bg-success" },
  deathmatch: { label: "Deathmatch", dot: "bg-destructive" },
};

type Filter = FeaturedMode | "all";

const countWords = [
  "No",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
];

const defaultId =
  featuredMaps.find((entry) => entry.mode === "coop")?.id ?? featuredMaps[0].id;

interface FeaturedMapsProps {
  sidebar: SidebarProps;
  message: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPlaySolo: (entry: FeaturedMap) => void;
  onPlayTogether: (entry: FeaturedMap) => void;
  onOpenCopy: (entry: FeaturedMap) => void;
  onPlayWad: (files: File[]) => void;
  onPlayGame: () => void;
  onOpenGame: () => void;
  game: GameInfo;
  ownIwad: boolean;
  onUseIwad: (file: File) => void;
  onUseBundledIwad: () => void;
  resources: number;
  onOpenTextures: () => void;
}

export function FeaturedMaps({
  sidebar,
  message,
  onPlaySolo,
  onPlayTogether,
  onOpenCopy,
  onPlayWad,
  onPlayGame,
  onOpenGame,
  game,
  ownIwad,
  onUseIwad,
  onUseBundledIwad,
  resources,
  onOpenTextures,
  selectedId,
  onSelect,
}: FeaturedMapsProps) {
  const [filter, setFilter] = React.useState<Filter>("all");
  const wadInput = React.useRef<HTMLInputElement>(null);
  const iwadInput = React.useRef<HTMLInputElement>(null);
  const shown = featuredMaps.filter(
    (entry) => filter === "all" || entry.mode === filter,
  );
  const selected =
    shown.find((entry) => entry.id === (selectedId ?? defaultId)) ??
    shown[0] ??
    null;
  const filters: Filter[] = [
    "all",
    ...(Object.keys(modes) as FeaturedMode[]).filter((mode) =>
      featuredMaps.some((entry) => entry.mode === mode),
    ),
  ];
  return (
    <AppShell sidebar={sidebar}>
      <main className="flex flex-col gap-6 px-8 pt-10 pb-10 max-[760px]:px-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="m-0 text-4xl font-bold">Featured maps</h1>
            <p className="m-0 mt-1 text-base text-muted-foreground">
              {countWords[featuredMaps.length] ?? featuredMaps.length} maps made
              in Wadsmith. Play one, bring friends, or open a copy to see how
              it&apos;s built.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => wadInput.current?.click()}>
              <FolderOpen size={14} aria-hidden="true" />
              Play a WAD
            </Button>
            <input
              ref={wadInput}
              type="file"
              multiple
              hidden
              accept=".wad,.deh,.bex,.zip"
              onChange={(event) => {
                const files = [...(event.currentTarget.files ?? [])];
                event.currentTarget.value = "";
                if (files.length > 0) onPlayWad(files);
              }}
            />
            <div
              role="group"
              aria-label="Show"
              className="flex rounded-[3px] border border-input bg-card p-0.5"
            >
              {filters.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={filter === item}
                  className="rounded-[2px] border-0 bg-transparent px-3 py-1.5 text-sm text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-input aria-pressed:ring-inset"
                  onClick={() => setFilter(item)}
                >
                  {item === "all" ? "All" : modes[item].label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {message ? <Alert role="status">{message}</Alert> : null}
        {selected ? (
          <section
            aria-label={selected.title}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden rounded-[6px] border border-border bg-card max-[900px]:grid-cols-1"
          >
            <MapPlan
              map={selected.map}
              label={`Plan of ${selected.title}`}
              className="aspect-[16/10] w-full border-r border-border bg-map-bg p-10 max-[900px]:border-r-0 max-[900px]:border-b"
            />
            <div className="flex flex-col justify-center gap-3 p-8 max-[760px]:p-5">
              <ModeLine entry={selected} />
              <h2 className="m-0 text-4xl font-bold">{selected.title}</h2>
              <p className="m-0 text-base text-foreground">{selected.blurb}</p>
              <p className="m-0 pt-3 font-mono text-xs text-muted-foreground">
                {detailsOf(selected)}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => onOpenCopy(selected)}>
                  <Copy size={14} aria-hidden="true" />
                  Open a copy
                </Button>
                {selected.players.max > 1 ? (
                  <Button
                    variant={
                      selected.mode === "deathmatch" ? "primary" : "default"
                    }
                    onClick={() => onPlayTogether(selected)}
                  >
                    <Users size={14} aria-hidden="true" />
                    Play together
                  </Button>
                ) : null}
                {selected.mode === "deathmatch" ? null : (
                  <Button
                    variant="primary"

                    onClick={() => onPlaySolo(selected)}
                  >
                    <Play size={14} aria-hidden="true" />
                    Play
                  </Button>
                )}
              </div>
            </div>
          </section>
        ) : null}
        <ul
          aria-label="Maps"
          className="m-0 grid list-none grid-cols-6 gap-4 p-0 max-[1200px]:grid-cols-3 max-[600px]:grid-cols-2"
        >
          {shown.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                aria-pressed={entry.id === selected?.id}
                className="grid h-full w-full grid-rows-[auto_1fr] gap-0 overflow-hidden rounded-[6px] border border-input bg-card p-0 text-left text-foreground hover:border-input aria-pressed:border-primary"
                onClick={() => onSelect(entry.id)}
              >
                <MapPlan
                  map={entry.map}
                  className="aspect-[16/9] w-full bg-map-bg p-4"
                />
                <span className="grid gap-1 px-3 py-3">
                  <span className="truncate text-base font-semibold">
                    {entry.title}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground uppercase">
                    {cardLine(entry)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <section
          aria-label={game.label}
          className="flex flex-wrap items-center justify-between gap-5 rounded-[6px] border border-border bg-card p-6 max-[760px]:p-5"
        >
          <div className="grid max-w-[640px] min-w-0 gap-2">
            <div className="font-mono text-xs tracking-wide text-foreground uppercase">
              The game · {slotCount(game)} levels
            </div>
            <h2 className="m-0 text-2xl font-bold">{game.label}</h2>
            <p className="m-0 text-base text-muted-foreground">
              {ownIwad
                ? "Your own IWAD, kept in this browser and never uploaded. Its textures, sprites and levels stand in for Freedoom's everywhere."
                : "The free Doom II replacement Wadsmith plays on, made by the Freedoom project. Bring doom.wad, doom2.wad, plutonia.wad or tnt.wad to play with the real thing instead."}{" "}
              Play it through, or open it as an episode to see how each level is
              built.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {ownIwad ? (
              <Button onClick={onUseBundledIwad}>
                <Undo2 size={14} aria-hidden="true" />
                Back to Freedoom
              </Button>
            ) : null}
            <Button onClick={() => iwadInput.current?.click()}>
              <HardDrive size={14} aria-hidden="true" />
              {ownIwad ? "Change IWAD" : "Use your own IWAD"}
            </Button>
            <input
              ref={iwadInput}
              type="file"
              hidden
              accept=".wad"
              onChange={(event) => {
                const [file] = event.currentTarget.files ?? [];
                event.currentTarget.value = "";
                if (file) onUseIwad(file);
              }}
            />
            <Button onClick={onOpenTextures}>
              <Images size={14} aria-hidden="true" />
              {resources > 0 ? `Textures (${resources})` : "Textures"}
            </Button>
            <Button onClick={onOpenGame}>
              <Copy size={14} aria-hidden="true" />
              Open as an episode
            </Button>
            <Button variant="primary" onClick={onPlayGame}>
              <Play size={14} aria-hidden="true" />
              Play
            </Button>
          </div>
        </section>
      </main>
    </AppShell>
  );
}

interface ModeLineProps {
  entry: FeaturedMap;
}

function ModeLine({ entry }: ModeLineProps) {
  const mode = modes[entry.mode];
  return (
    <div className="flex items-center gap-1.5 font-mono text-xs tracking-wide text-foreground uppercase">
      <span
        className={`size-1.5 rounded-full ${mode.dot}`}
        aria-hidden="true"
      />
      {mode.label} · {playersLabel(entry.players)}
    </div>
  );
}

function playersLabel({ min, max }: FeaturedMap["players"]) {
  const count = min === max ? `${min}` : `${min}–${max}`;
  return `${count} ${max === 1 ? "player" : "players"}`;
}

function detailsOf(entry: FeaturedMap) {
  return entry.mode === "deathmatch"
    ? `First to ${fragLimit} frags · ${entry.skill}`
    : `Par ${formatPar(entry.par)} · ${enemiesOf(entry)} enemies · ${entry.skill}`;
}

function enemiesOf(entry: FeaturedMap) {
  return entry.map.things.filter(
    (thing) => thingCatalog[thing.kind].category === "enemy",
  ).length;
}

function cardLine(entry: FeaturedMap) {
  const mode = entry.mode === "single" ? "Solo" : modes[entry.mode].label;
  return entry.mode === "deathmatch"
    ? `${mode} · ${fragLimit} frags`
    : `${mode} · Par ${formatPar(entry.par)}`;
}
