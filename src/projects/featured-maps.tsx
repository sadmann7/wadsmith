import { Copy, FolderOpen, Play, Users } from "lucide-react";
import { useRef, useState } from "react";

import { MapPlan } from "../editor/map-plan";
import { fragLimit } from "../engine/runtime";
import { thingCatalog } from "../map/catalog";
import {
  featuredMaps,
  type FeaturedMap,
  type FeaturedMode,
} from "../map/featured";
import { AppShell, type SidebarProps } from "./app-sidebar";
import { formatPar } from "./project-data";

const modes: Record<FeaturedMode, { label: string; dot: string }> = {
  single: { label: "Single player", dot: "bg-info" },
  coop: { label: "Co-op", dot: "bg-success" },
  deathmatch: { label: "Deathmatch", dot: "bg-danger" },
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

function playersLabel({ min, max }: FeaturedMap["players"]) {
  const count = min === max ? `${min}` : `${min}–${max}`;
  return `${count} ${max === 1 ? "player" : "players"}`;
}

function enemiesOf(entry: FeaturedMap) {
  return entry.map.things.filter(
    (thing) => thingCatalog[thing.kind].category === "enemy",
  ).length;
}

function ModeLine({ entry }: { entry: FeaturedMap }) {
  const mode = modes[entry.mode];
  return (
    <div className="flex items-center gap-1.5 font-mono text-xs tracking-wide text-fg-soft uppercase">
      <span
        className={`size-1.5 rounded-full ${mode.dot}`}
        aria-hidden="true"
      />
      {mode.label} · {playersLabel(entry.players)}
    </div>
  );
}

function detailsOf(entry: FeaturedMap) {
  return entry.mode === "deathmatch"
    ? `First to ${fragLimit} frags · ${entry.skill}`
    : `Par ${formatPar(entry.par)} · ${enemiesOf(entry)} enemies · ${entry.skill}`;
}

function cardLine(entry: FeaturedMap) {
  const mode = entry.mode === "single" ? "Solo" : modes[entry.mode].label;
  return entry.mode === "deathmatch"
    ? `${mode} · ${fragLimit} frags`
    : `${mode} · Par ${formatPar(entry.par)}`;
}

const defaultId =
  featuredMaps.find((entry) => entry.mode === "coop")?.id ?? featuredMaps[0].id;

function FeaturedMaps({
  sidebar,
  message,
  onPlaySolo,
  onPlayTogether,
  onOpenCopy,
  onPlayWad,
  selectedId,
  onSelect,
}: {
  sidebar: SidebarProps;
  message: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPlaySolo: (entry: FeaturedMap) => void;
  onPlayTogether: (entry: FeaturedMap) => void;
  onOpenCopy: (entry: FeaturedMap) => void;
  onPlayWad: (files: File[]) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const wadInput = useRef<HTMLInputElement>(null);
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
            <p className="m-0 mt-1 text-base text-fg-muted">
              {countWords[featuredMaps.length] ?? featuredMaps.length} maps made
              in Wadsmith. Play one, bring friends, or open a copy to see how
              it&apos;s built.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="button"
              onClick={() => wadInput.current?.click()}
            >
              <FolderOpen size={14} aria-hidden="true" />
              Play a WAD
            </button>
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
              className="flex rounded-[3px] border border-border bg-surface p-0.5"
            >
              {filters.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={filter === item}
                  className="rounded-[2px] border-0 bg-transparent px-3 py-1.5 text-sm text-fg-muted aria-pressed:bg-surface-raised aria-pressed:text-fg"
                  onClick={() => setFilter(item)}
                >
                  {item === "all" ? "All" : modes[item].label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {message ? (
          <p className="notice m-0" role="status">
            {message}
          </p>
        ) : null}
        {selected ? (
          <section
            aria-label={selected.title}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden rounded-[6px] border border-border bg-surface max-[900px]:grid-cols-1"
          >
            <MapPlan
              map={selected.map}
              label={`Plan of ${selected.title}`}
              className="aspect-[16/10] w-full border-r border-border bg-map-bg p-10 max-[900px]:border-r-0 max-[900px]:border-b"
            />
            <div className="flex flex-col justify-center gap-3 p-8 max-[760px]:p-5">
              <ModeLine entry={selected} />
              <h2 className="m-0 text-4xl font-bold">{selected.title}</h2>
              <p className="m-0 text-base text-fg-soft">{selected.blurb}</p>
              <p className="m-0 pt-3 font-mono text-xs text-fg-muted">
                {detailsOf(selected)}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="button"
                  onClick={() => onOpenCopy(selected)}
                >
                  <Copy size={14} aria-hidden="true" />
                  Open a copy
                </button>
                {selected.players.max > 1 ? (
                  <button
                    type="button"
                    className={`button ${selected.mode === "deathmatch" ? "primary" : ""}`}
                    onClick={() => onPlayTogether(selected)}
                  >
                    <Users size={14} aria-hidden="true" />
                    Play together
                  </button>
                ) : null}
                {selected.mode === "deathmatch" ? null : (
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => onPlaySolo(selected)}
                  >
                    <Play size={14} aria-hidden="true" />
                    Play
                  </button>
                )}
              </div>
            </div>
          </section>
        ) : null}
        <ul
          aria-label="Maps"
          className="m-0 grid list-none grid-cols-6 max-[1200px]:grid-cols-3 max-[600px]:grid-cols-2 gap-4 p-0"
        >
          {shown.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                aria-pressed={entry.id === selected?.id}
                className="grid h-full w-full grid-rows-[auto_1fr] gap-0 overflow-hidden rounded-[6px] border border-border bg-surface p-0 text-left text-fg hover:border-border-strong aria-pressed:border-accent"
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
                  <span className="truncate font-mono text-xs text-fg-muted uppercase">
                    {cardLine(entry)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </main>
    </AppShell>
  );
}

export { FeaturedMaps };
