import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { Input } from "@ui-sdk/react/input";
import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { freedoomFlats, freedoomWalls } from "../map/freedoom-textures";
import type { TextureUse } from "../map/textures";
import { TextureSwatch } from "../preview/surface-panel";
import type { Picture, SceneAssets } from "../wad/assets";

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
  const [shown, setShown] = useState(pageSize);
  const search = query.trim().toUpperCase();
  const active =
    categories.find((item) => item.id === category) ?? categories[0];
  const names = active.names.filter((name) => name.includes(search));
  const preview = picture(chosen);
  const uses = use.get(chosen) ?? 0;
  const apply = (name: string) => {
    if (name !== value) onApply(name);
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop className="fixed inset-0 z-40 bg-black/65" />
      <DialogContent className="fixed top-1/2 left-1/2 z-50 flex h-[620px] max-h-[calc(100vh-32px)] w-[1000px] max-w-[calc(100vw-32px)] -translate-1/2 flex-col rounded-[4px] border border-[#3a352e] bg-panel outline-none">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <DialogTitle className="block font-sans text-xl font-semibold tracking-normal text-text normal-case">
              {title}
            </DialogTitle>
            <DialogDescription className="truncate font-mono text-xs text-muted">
              {context}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close"
            className="border-0 bg-transparent p-1 text-muted hover:text-text"
          >
            <X size={16} aria-hidden="true" />
          </DialogClose>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[168px_minmax(0,1fr)_244px] max-[820px]:grid-cols-[minmax(0,1fr)_200px]">
          <nav
            aria-label="Texture categories"
            className="grid content-start gap-0.5 overflow-y-auto border-r border-line p-3 max-[820px]:hidden"
          >
            {categories.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={item.id === category}
                className="flex h-8 items-center justify-between gap-2 rounded-[3px] border-0 bg-transparent px-2 text-left text-muted hover:text-text aria-pressed:bg-raised aria-pressed:text-text"
                onClick={() => {
                  setCategory(item.id);
                  setShown(pageSize);
                }}
              >
                <span className="truncate">{item.label}</span>
                <span className="font-mono text-[11px] text-muted">
                  {item.names.length}
                </span>
              </button>
            ))}
          </nav>
          <div className="flex min-h-0 flex-col gap-3 p-4">
            <label className="flex h-[34px] shrink-0 items-center gap-2 rounded-[2px] border border-line bg-bg px-2.5">
              <Search size={14} className="text-muted" aria-hidden="true" />
              <Input
                aria-label="Search textures"
                placeholder={`Search ${active.names.length} textures`}
                className="w-full min-w-0 border-0 bg-transparent outline-none"
                value={query}
                onValueChange={(next) => {
                  setQuery(next);
                  setShown(pageSize);
                }}
              />
            </label>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {names.length === 0 ? (
                <p className="muted">No textures match.</p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
                  {names.slice(0, shown).map((name) => (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={name === chosen}
                      aria-label={name}
                      className="group relative grid min-w-0 gap-1 border-0 bg-transparent p-0 text-left font-mono text-[11px] text-muted aria-pressed:text-text"
                      onClick={() => setChosen(name)}
                      onDoubleClick={() => apply(name)}
                    >
                      <TextureSwatch
                        name={name}
                        picture={picture(name)}
                        assets={assets}
                        light={light}
                        whole={kind === "wall"}
                        className="aspect-square w-full outline-2 -outline-offset-2 outline-transparent [image-rendering:pixelated] group-aria-pressed:outline-ember"
                      />
                      {name === value ? (
                        <span className="absolute top-1.5 left-1.5 bg-bg px-1.5 py-0.5 text-text">
                          Current
                        </span>
                      ) : null}
                      <span className="truncate">{name}</span>
                    </button>
                  ))}
                </div>
              )}
              {names.length > shown ? (
                <button
                  type="button"
                  className="button mt-3 w-full justify-center"
                  onClick={() => setShown((count) => count + pageSize)}
                >
                  Show more
                </button>
              ) : null}
            </div>
          </div>
          <aside className="flex min-h-0 flex-col justify-between gap-4 overflow-y-auto border-l border-line p-4">
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
                <div className="text-muted">Freedoom</div>
              </div>
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-muted">
                <dt>Size</dt>
                <dd className="m-0 font-mono text-xs text-text">
                  {preview.width} × {preview.height}
                </dd>
                <dt>In this map</dt>
                <dd className="m-0 font-mono text-xs text-text">
                  {uses > 0
                    ? `${uses} ${uses === 1 ? "use" : "uses"}`
                    : "Not used"}
                </dd>
              </dl>
            </div>
            <div className="grid gap-2">
              <button
                type="button"
                className="button primary justify-center"
                onClick={() => apply(chosen)}
              >
                Apply texture
              </button>
              <button
                type="button"
                className="button justify-center"
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { TexturePicker, type TextureKind };
