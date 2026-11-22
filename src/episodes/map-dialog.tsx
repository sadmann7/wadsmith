import * as React from "react";

import { Choice } from "@/engine/coop-ui";
import { MapOutline } from "@/components/map-outline";
import { complevelLabels, complevels } from "@/map/complevel";
import type { Complevel } from "@/map/types";
import { MapPlan } from "@/components/map-plan";
import { featuredMaps, type FeaturedMap } from "@/map/featured";
import {
  formatPar,
  freeSlots,
  mapName,
  maxDescriptionLength,
  maxNameLength,
  parsePar,
  templates,
  type MapTemplate,
  type EpisodeMap,
} from "./episode-data";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type MapDetails = {
  name: string;
  slot: string;
  description: string;
  par: number | null;
  complevel: Complevel;
  template: MapTemplate;
  featured: FeaturedMap | null;
};

function MapDialog({
  maps,
  entry,
  onSubmit,
  onClose,
}: {
  maps: EpisodeMap[];
  entry?: EpisodeMap;
  onSubmit: (details: MapDetails) => Promise<string | null>;
  onClose: () => void;
}) {
  const slots = freeSlots(maps, entry?.slot);
  const [name, setName] = React.useState(entry ? mapName(entry) : "");
  const [slot, setSlot] = React.useState(entry?.slot ?? slots[0]);
  const [description, setDescription] = React.useState(
    entry?.description ?? "",
  );
  const [par, setPar] = React.useState(formatPar(entry?.par ?? null));
  const [complevel, setComplevel] = React.useState<Complevel>(
    entry?.map.complevel ?? "vanilla",
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
          <div className="grid min-h-0 gap-5 overflow-y-auto p-5">
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
                items={slots}
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
                      {item}
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
                  <div className="grid grid-cols-3 gap-2.5">
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
                <span>Classic Doom</span>
              </FieldItem>
              <FieldItem>
                <Label>Texture pack</Label>
                <span>freedoom2</span>
              </FieldItem>
            </div>
          </div>
          <DialogFooter className="justify-end">
            {error || !slot ? (
              <p role="alert" className="m-0 mr-auto min-w-0 text-destructive">
                {error ?? "All 32 map slots are in use."}
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

export { MapDialog, type MapDetails };
