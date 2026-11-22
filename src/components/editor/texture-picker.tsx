import { Search } from "lucide-react";
import * as React from "react";

import type { TextureNames, TextureUse } from "@/lib/map/textures";
import { TextureSwatch } from "./surface-panel";
import type { Picture, SceneAssets } from "@/lib/wad/assets";
import { TextureGrid, TextureTile } from "./texture-grid";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupInput } from "@/components/ui/input";
import { Toggle, ToggleGroup } from "@/components/ui/toggle";
import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type TextureKind = "flat" | "wall";

interface Category {
  id: string;
  label: string;
  names: readonly string[];
}

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
  available: TextureNames,
): Category[] {
  const names = kind === "flat" ? available.flats : available.walls;
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

interface TexturePickerProps {
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
}

export function TexturePicker({
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
}: TexturePickerProps) {
  const categories = React.useMemo(
    () => categoriesFor(kind, common, use, assets.names),
    [assets.names, common, kind, use],
  );
  const [category, setCategory] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [chosen, setChosen] = React.useState(value);
  const [shown, setShown] = React.useState(() => {
    const index = categories[0].names.indexOf(value);
    return Math.ceil((Math.max(index, 0) + 1) / pageSize) * pageSize;
  });
  const grid = React.useRef<HTMLDivElement>(null);
  const searchInput = React.useRef<HTMLInputElement>(null);
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

  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
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
      <DialogBackdrop />
      <DialogContent
        initialFocus={() => tileFor(value)}
        className="h-[620px] w-[1000px]"
      >
        <DialogHeader>
          <div className="flex min-w-0 items-baseline gap-2.5">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{context}</DialogDescription>
          </div>
          <DialogCloseButton />
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-[168px_minmax(0,1fr)_244px] max-[820px]:grid-cols-[minmax(0,1fr)_200px]">
          <nav
            aria-label="Texture categories"
            className="relative min-h-0 overflow-y-auto border-r border-border p-3 max-[820px]:hidden"
          >
            <ToggleGroup
              aria-label="Category"
              orientation="vertical"
              deselectable={false}
              className="grid content-start"
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
                  className="h-8 justify-between rounded-[3px] text-left"
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
            <div className="relative min-h-0 flex-1 overflow-y-auto">
              {names.length === 0 ? (
                <p className="text-muted-foreground">No textures match.</p>
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
          <aside className="relative flex min-h-0 flex-col justify-between gap-4 overflow-y-auto border-l border-border p-4">
            <div className="grid gap-3">
              <TextureSwatch
                name={chosen}
                picture={preview}
                assets={assets}
                light={light}
                whole={kind === "wall"}
                className="aspect-square w-full [image-rendering:pixelated]"
              />
              <div className="font-mono text-base break-all">{chosen}</div>
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
