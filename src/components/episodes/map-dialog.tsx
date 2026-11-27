import * as React from "react";

import type { Complevel } from "@/lib/map/types";

import { MapOutline } from "@/components/map-outline";
import { MapPlan } from "@/components/map-plan";
import { Choice } from "@/components/play/coop-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldItem, FieldLabel, Label } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectCheck,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIwad } from "@/hooks/use-iwad";
import { engineSlot, type GameInfo, slotCount } from "@/lib/engine/game";
import { texturesOf } from "@/lib/engine/iwad";
import {
  type EpisodeMap,
  formatPar,
  freeSlots,
  mapName,
  type MapTemplate,
  maxDescriptionLength,
  maxIntertextLength,
  maxNameLength,
  parsePar,
  templates,
} from "@/lib/episodes/episode-data";
import { complevelLabels, complevels } from "@/lib/map/complevel";
import { type FeaturedMap, featuredMaps } from "@/lib/map/featured";
import { readWadAssets } from "@/lib/wad/assets";
import { readLumps } from "@/lib/wad/inspect";

export interface MapDetails {
  name: string;
  slot: string;
  description: string;
  par: number | null;
  music?: string;
  sky?: string;
  intertext?: string;
  complevel: Complevel;
  template: MapTemplate;
  featured: FeaturedMap | null;
}

interface MapDialogProps {
  maps: EpisodeMap[];
  entry?: EpisodeMap;
  game: GameInfo;
  onSubmit: (details: MapDetails) => Promise<string | null>;
  onClose: () => void;
}

export function MapDialog({
  maps,
  entry,
  game,
  onSubmit,
  onClose,
}: MapDialogProps) {
  const slots = freeSlots(maps, entry?.slot, game);
  const [name, setName] = React.useState(entry ? mapName(entry) : "");
  const [slot, setSlot] = React.useState(entry?.slot ?? slots[0]);
  const [description, setDescription] = React.useState(
    entry?.description ?? "",
  );
  const [par, setPar] = React.useState(formatPar(entry?.par ?? null));
  const [music, setMusic] = React.useState(entry?.music ?? "");
  const [sky, setSky] = React.useState(entry?.sky ?? "");
  const [intertext, setIntertext] = React.useState(entry?.intertext ?? "");
  const [complevel, setComplevel] = React.useState<Complevel>(
    entry?.map.complevel ?? "vanilla",
  );
  const iwad = useIwad();
  const lumps = React.useMemo(
    () =>
      iwad
        ? readLumps({ name: iwad.game.file, data: iwad.data }).map(
            (lump) => lump.name,
          )
        : [],
    [iwad],
  );
  const musicNames = [
    ...new Set(lumps.filter((name) => name.startsWith("D_"))),
  ].toSorted();
  const skyNames = React.useMemo(
    () =>
      iwad
        ? readWadAssets(
            iwad.data,
            texturesOf(iwad).resources,
          ).names.textures.filter((name) => name.startsWith("SKY"))
        : [],
    [iwad],
  );
  const [template, setTemplate] = React.useState<MapTemplate>("room");
  const [source, setSource] = React.useState<"template" | "featured">(
    "template",
  );
  const [featured, setFeatured] = React.useState<FeaturedMap>(featuredMaps[0]);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const parValue = parsePar(par);
  const canSubmit =
    Boolean(slot) &&
    name.trim().length > 0 &&
    parValue !== undefined &&
    !saving;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    const problem = await onSubmit({
      name: name.trim(),
      slot,
      description: description.trim(),
      par: parValue,
      music: music || undefined,
      sky: sky || undefined,
      intertext: intertext.trim() || undefined,
      complevel,
      template,
      featured: source === "featured" ? featured : null,
    });
    setSaving(false);
    setError(problem);
    if (!problem) onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent className="w-[600px]">
        <form
          onSubmit={(event) => void submit(event)}
          className="flex min-h-0 flex-col"
        >
          <DialogHeader>
            <DialogTitle>{entry ? "Map settings" : "New map"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <div className="relative grid min-h-0 gap-5 overflow-y-auto p-5">
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
              <Field>
                <FieldLabel>Name</FieldLabel>
                <Input
                  maxLength={maxNameLength}
                  value={name}
                  onValueChange={setName}
                />
              </Field>
              <Select
                value={slot}
                items={slots.map((item) => ({
                  value: item,
                  label: engineSlot(item, game),
                }))}
                onValueChange={(next) => {
                  if (next) setSlot(next);
                }}
              >
                <FieldItem>
                  <SelectLabel>Slot</SelectLabel>
                  <SelectTrigger>
                    <SelectValue />
                    <span aria-hidden="true">▾</span>
                  </SelectTrigger>
                </FieldItem>
                <SelectContent>
                  {slots.map((item) => (
                    <SelectItem key={item} value={item}>
                      {engineSlot(item, game)}
                      <SelectCheck />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {entry ? (
              <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
                <Field>
                  <FieldLabel>Description</FieldLabel>
                  <Input
                    maxLength={maxDescriptionLength}
                    value={description}
                    onValueChange={setDescription}
                  />
                </Field>
                <Field>
                  <FieldLabel>Par time</FieldLabel>
                  <Input
                    aria-invalid={parValue === undefined}
                    placeholder="2:15"
                    value={par}
                    onValueChange={setPar}
                  />
                </Field>
                <LumpChoice
                  label="Music"
                  value={music}
                  names={musicNames}
                  loaded={iwad !== null}
                  onChange={setMusic}
                />
                <LumpChoice
                  label="Sky"
                  value={sky}
                  names={skyNames}
                  loaded={iwad !== null}
                  onChange={setSky}
                />
                <Field className="col-span-2">
                  <FieldLabel>Text after the map</FieldLabel>
                  <textarea
                    className="min-h-[72px] w-full min-w-0 resize-y rounded-[3px] border border-input bg-input/30 px-2 py-1 shadow-xs placeholder:text-muted-foreground"
                    maxLength={maxIntertextLength}
                    placeholder="Shown over the intermission before the next map."
                    value={intertext}
                    onChange={(event) => setIntertext(event.target.value)}
                  />
                </Field>
                <FieldItem className="col-span-2">
                  <Label>Compatibility</Label>
                  <Choice
                    label="Compatibility"
                    value={complevel}
                    options={complevels.map((value) => ({
                      value,
                      label: complevelLabels[value],
                    }))}
                    onChange={setComplevel}
                  />
                  <p className="m-0 text-xs text-muted-foreground">
                    The engine the map is made for. Raw specials and flags past
                    this level fail the map's checks.
                  </p>
                </FieldItem>
              </div>
            ) : (
              <fieldset className="m-0 grid gap-1.5 border-0 p-0">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <legend className="p-0 text-sm text-muted-foreground">
                    Start from
                  </legend>
                  <div
                    role="group"
                    aria-label="Start from"
                    className="flex rounded-[3px] border border-input p-0.5"
                  >
                    {(
                      [
                        ["template", "Template"],
                        ["featured", "Featured map"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={source === value}
                        className="rounded-[2px] border-0 bg-transparent px-2.5 py-1 text-sm text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-input aria-pressed:ring-inset"
                        onClick={() => {
                          setSource(value);
                          if (value === "featured" && !name.trim()) {
                            setName(featured.title);
                            setPar(formatPar(featured.par));
                          }
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {source === "template" ? (
                  <div className="grid grid-cols-4 gap-2.5">
                    {templates.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        aria-pressed={template === item.value}
                        className="grid gap-1.5 rounded-[3px] border border-input bg-transparent p-2 text-muted-foreground aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-foreground"
                        onClick={() => setTemplate(item.value)}
                      >
                        <MapOutline
                          map={item.map}
                          className="h-20 w-full bg-background"
                          solidColor="var(--color-muted-foreground)"
                        />
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2.5">
                    {featuredMaps.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={featured.id === item.id}
                        className="grid gap-1.5 rounded-[3px] border border-input bg-transparent p-2 text-left text-muted-foreground aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-foreground"
                        onClick={() => {
                          if (!name.trim() || name === featured.title) {
                            setName(item.title);
                          }
                          setPar(formatPar(item.par));
                          setFeatured(item);
                        }}
                      >
                        <MapPlan
                          map={item.map}
                          className="h-20 w-full bg-background"
                        />
                        {item.title}
                      </button>
                    ))}
                  </div>
                )}
                {source === "featured" ? (
                  <p className="m-0 mt-1 text-sm text-muted-foreground">
                    You get your own copy in this episode. The featured map
                    stays as it is.
                  </p>
                ) : null}
              </fieldset>
            )}
            <div className="grid grid-cols-2 gap-3">
              <FieldItem>
                <Label>Format</Label>
                <span>{game.episodes > 0 ? "Doom" : "Doom II"}</span>
              </FieldItem>
              <FieldItem>
                <Label>Game</Label>
                <span>{game.label}</span>
              </FieldItem>
            </div>
          </div>
          <DialogFooter className="justify-end">
            {error || !slot ? (
              <p role="alert" className="m-0 mr-auto min-w-0 text-destructive">
                {error ?? `All ${slotCount(game)} map slots are in use.`}
              </p>
            ) : null}
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              type="submit"

              disabled={!canSubmit}
            >
              {entry ? "Save" : "Create map"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// The game's own choice, which UMAPINFO leaves alone.
const gamesOwn = "default";

interface LumpChoiceProps {
  label: string;
  value: string;
  names: readonly string[];
  loaded: boolean;
  onChange: (value: string) => void;
}

function LumpChoice({
  label,
  value,
  names,
  loaded,
  onChange,
}: LumpChoiceProps) {
  const items = [
    { value: gamesOwn, label: "Game's own" },
    ...(value && !names.includes(value)
      ? [{ value, label: loaded ? `${value} (not in this game)` : value }]
      : []),
    ...names.map((name) => ({ value: name, label: name })),
  ];
  return (
    <Select
      value={value || gamesOwn}
      items={items}
      onValueChange={(next) => {
        if (next) onChange(next === gamesOwn ? "" : next);
      }}
    >
      <FieldItem>
        <SelectLabel>{label}</SelectLabel>
        <SelectTrigger>
          <SelectValue />
          <span aria-hidden="true">▾</span>
        </SelectTrigger>
      </FieldItem>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
            <SelectCheck />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
