import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { Toggle, ToggleGroup } from "@ui-sdk/react/toggle";
import { Search, X } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import { freedoomFlats, freedoomWalls } from "../map/freedoom-textures";
import type { TextureUse } from "../map/textures";
import { TextureSwatch } from "../preview/surface-panel";
import type { Picture, SceneAssets } from "../wad/assets";
import { TextureGrid, TextureTile } from "./texture-grid";
import { Button } from "../components/ui/button";
import { InputGroup, InputGroupInput } from "../components/ui/input";

type TextureKind = "flat" | "wall";

type Category = { id: string; label: string; names: readonly string[] };

const pageSize = 48;

const flatGroups: [string, RegExp][] = [
  ["Floors", /^(FLOOR|FLAT|MFLR|SFLR|STEP)/],
  ["Ceilings", /^(CEIL|TLITE|GRNLITE)/],
  ["Rock", /^(RROCK|GRNROCK|GRASS|DEM)/],
  ["Liquid", /^(BLOOD|LAVA|NUKAGE|FWATER|SWATER|SLIME)\d/],
];

const wallGroups: [string, RegExp][] = [
  ["Brick", /BRICK/],
  ["Metal", /METAL|AQMET|SUPPORT|DOORSTOP|PIPE/],
  ["Stone", /STONE|ROCK|ASHWALL|CEMENT|AQCON/],
  ["Tech", /TEK|COMP|LITE|PANEL|SILVER/],
  ["Wood", /WOOD/],
];

function categoriesFor(
  kind: TextureKind,
  common: readonly string[],
  use: TextureUse,
): Category[] {
  const names: readonly string[] =
    kind === "flat" ? freedoomFlats : freedoomWalls;
  const groups = kind === "flat" ? flatGroups : wallGroups;
  return [
    { id: "all", label: "All", names },
    {
      id: "used",
      label: "Used in this map",
      names: [...use.keys()].toSorted(),
    },
    { id: "common", label: "Common", names: common },
    ...groups.map(([label, pattern]) => ({
      id: label,
      label,
      names: names.filter((name) => pattern.test(name)),
    })),
  ];
}

function TexturePicker({
  kind,
  title,
  context,
  value,
  common,
  use,
  picture,
  assets,
  light,
  onApply,
  onClose,
}: {
  kind: TextureKind;
  title: string;
  context: string;
  value: string;
  common: readonly string[];
  use: TextureUse;
  picture: (name: string) => Picture;
  assets: SceneAssets;
  light: number;
  onApply: (name: string) => void;
  onClose: () => void;
}) {
  const categories = useMemo(
    () => categoriesFor(kind, common, use),
    [common, kind, use],
  );
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(value);
  const [shown, setShown] = useState(() => {
    const index = categories[0].names.indexOf(value);
    return Math.ceil((Math.max(index, 0) + 1) / pageSize) * pageSize;
  });
  const grid = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const search = query.trim().toUpperCase();
  const active =
    categories.find((item) => item.id === category) ?? categories[0];
  const names = active.names.filter((name) => name.includes(search));
  const firstResult = names.includes(chosen) ? chosen : names[0];
  const preview = picture(chosen);
  const uses = use.get(chosen) ?? 0;

  const tileFor = (name: string) =>
    grid.current?.querySelector<HTMLElement>(`[data-texture="${name}"]`);

  const apply = (name: string) => {
    if (name !== value) onApply(name);
    onClose();
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!firstResult) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setChosen(firstResult);
      tileFor(firstResult)?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      apply(firstResult);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop className="fixed inset-0 z-40 bg-scrim" />
      <DialogContent
        initialFocus={() => tileFor(value)}
        className="fixed top-1/2 left-1/2 z-50 flex h-[620px] max-h-[calc(100vh-32px)] w-[1000px] max-w-[calc(100vw-32px)] -translate-1/2 flex-col rounded-[4px] border border-input bg-card outline-none"
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <DialogTitle className="block font-sans text-xl font-semibold tracking-normal text-foreground normal-case">
              {title}
            </DialogTitle>
            <DialogDescription className="truncate font-mono text-xs text-muted-foreground">
              {context}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close"
            className="border-0 bg-transparent p-1 text-muted-foreground hover:text-foreground"
          >
            <X size={16} aria-hidden="true" />
          </DialogClose>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[168px_minmax(0,1fr)_244px] max-[820px]:grid-cols-[minmax(0,1fr)_200px]">
          <nav
            aria-label="Texture categories"
            className="min-h-0 overflow-y-auto border-r border-border p-3 max-[820px]:hidden"
          >
            <ToggleGroup
              aria-label="Category"
              orientation="vertical"
              deselectable={false}
              className="grid content-start gap-0.5"
              value={[category]}
              onValueChange={(next) => {
                if (!next[0]) return;
                setCategory(next[0]);
                setShown(pageSize);
              }}
            >
              {categories.map((item) => (
                <Toggle
                  key={item.id}
                  value={item.id}
                  className="flex h-8 items-center justify-between gap-2 rounded-[3px] border-0 bg-transparent px-2 text-left text-muted-foreground hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-input aria-pressed:ring-inset"
                >
                  <span className="truncate">{item.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {item.names.length}
                  </span>
                </Toggle>
              ))}
            </ToggleGroup>
          </nav>
          <div className="flex min-h-0 flex-col gap-3 p-4">
            <InputGroup className="h-[34px] shrink-0">
              <Search
                size={14}
                className="text-muted-foreground"
                aria-hidden="true"
              />
              <InputGroupInput
                ref={searchInput}
                aria-label="Search textures"
                onKeyDown={onSearchKey}
                placeholder={`Search ${active.names.length} textures`}
                value={query}
                onValueChange={(next) => {
                  setQuery(next);
                  setShown(pageSize);
                }}
              />
            </InputGroup>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {names.length === 0 ? (
                <p className="muted">No textures match.</p>
              ) : (
                <TextureGrid
                  ref={grid}
                  aria-label="Textures"
                  className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3 p-0.5"
                  value={chosen}
                  names={names}
                  onValueChange={setChosen}
                  onApply={apply}
                  onLeave={() => searchInput.current?.focus()}
                  onReveal={(name) =>
                    setShown(
                      Math.ceil((names.indexOf(name) + 1) / pageSize) *
                        pageSize,
                    )
                  }
                  onType={(text) => {
                    setQuery((current) =>
                      text === null ? current.slice(0, -1) : current + text,
                    );
                    setShown(pageSize);
                    searchInput.current?.focus();
                  }}
                >
                  {names.slice(0, shown).map((name) => (
                    <TextureTile
                      key={name}
                      value={name}
                      aria-label={name}
                      className="group relative grid min-w-0 gap-1 border-0 bg-transparent p-0 text-left font-mono text-xs text-muted-foreground outline-none aria-selected:text-foreground"
                    >
                      <TextureSwatch
                        name={name}
                        picture={picture(name)}
                        assets={assets}
                        light={light}
                        whole={kind === "wall"}
                        className="aspect-square w-full outline-2 -outline-offset-2 outline-transparent [image-rendering:pixelated] group-focus-visible:outline-foreground group-aria-selected:outline-primary"
                      />
                      {name === value ? (
                        <span className="absolute top-1.5 left-1.5 bg-background px-1.5 py-0.5 text-foreground">
                          Current
                        </span>
                      ) : null}
                      <span className="truncate">{name}</span>
                    </TextureTile>
                  ))}
                </TextureGrid>
              )}
              {names.length > shown ? (
                <Button
                  className="mt-3 w-full justify-center"
                  onClick={() => setShown((count) => count + pageSize)}
                >
                  Show more
                </Button>
              ) : null}
            </div>
          </div>
          <aside className="flex min-h-0 flex-col justify-between gap-4 overflow-y-auto border-l border-border p-4">
            <div className="grid gap-3">
              <TextureSwatch
                name={chosen}
                picture={preview}
                assets={assets}
                light={light}
                whole={kind === "wall"}
                className="aspect-square w-full [image-rendering:pixelated]"
              />
              <div>
                <div className="font-mono text-base break-all">{chosen}</div>
                <div className="text-muted-foreground">Freedoom</div>
              </div>
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-muted-foreground">
                <dt>Size</dt>
                <dd className="m-0 font-mono text-xs text-foreground">
                  {preview.width} × {preview.height}
                </dd>
                <dt>In this map</dt>
                <dd className="m-0 font-mono text-xs text-foreground">
                  {uses > 0
                    ? `${uses} ${uses === 1 ? "use" : "uses"}`
                    : "Not used"}
                </dd>
              </dl>
            </div>
            <div className="grid gap-2">
              <p className="m-0 font-mono text-xs text-muted-foreground">
                Arrows move · Enter applies · Type to search
              </p>
              <Button
                variant="primary"
                className="justify-center"
                onClick={() => apply(chosen)}
              >
                Apply texture
              </Button>
              <Button className="justify-center" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { TexturePicker, type TextureKind };
