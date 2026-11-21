import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { Input } from "@ui-sdk/react/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import { X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { MapOutline } from "../editor/map-outline";
import { MapPlan } from "../editor/map-plan";
import { featuredMaps, type FeaturedMap } from "../map/featured";
import { SelectCheck } from "../editor/select-check";
import {
  formatPar,
  freeSlots,
  mapName,
  maxDescriptionLength,
  maxNameLength,
  parsePar,
  templates,
  type MapTemplate,
  type ProjectMap,
} from "./project-data";

type MapDetails = {
  name: string;
  slot: string;
  description: string;
  par: number | null;
  template: MapTemplate;
  featured: FeaturedMap | null;
};

const dialogClass =
  "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[600px] max-w-[calc(100vw-32px)] -translate-1/2 flex-col rounded-[4px] border border-border-strong bg-surface outline-none";
const titleClass =
  "block font-sans text-xl font-bold tracking-normal text-fg normal-case";

function MapDialog({
  maps,
  entry,
  onSubmit,
  onClose,
}: {
  maps: ProjectMap[];
  entry?: ProjectMap;
  onSubmit: (details: MapDetails) => Promise<string | null>;
  onClose: () => void;
}) {
  const slots = freeSlots(maps, entry?.slot);
  const [name, setName] = useState(entry ? mapName(entry) : "");
  const [slot, setSlot] = useState(entry?.slot ?? slots[0]);
  const [description, setDescription] = useState(entry?.description ?? "");
  const [par, setPar] = useState(formatPar(entry?.par ?? null));
  const [template, setTemplate] = useState<MapTemplate>("room");
  const [source, setSource] = useState<"template" | "featured">("template");
  const [featured, setFeatured] = useState<FeaturedMap>(featuredMaps[0]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const parValue = parsePar(par);
  const canSubmit =
    Boolean(slot) &&
    name.trim().length > 0 &&
    parValue !== undefined &&
    !saving;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    const problem = await onSubmit({
      name: name.trim(),
      slot,
      description: description.trim(),
      par: parValue,
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
      <DialogBackdrop className="fixed inset-0 z-40 bg-scrim" />
      <DialogContent className={dialogClass}>
        <form
          onSubmit={(event) => void submit(event)}
          className="flex min-h-0 flex-col"
        >
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
            <DialogTitle className={titleClass}>
              {entry ? "Map settings" : "New map"}
            </DialogTitle>
            <DialogClose
              aria-label="Close"
              className="border-0 bg-transparent p-1 text-fg-muted hover:text-fg"
            >
              <X size={16} aria-hidden="true" />
            </DialogClose>
          </header>
          <div className="grid min-h-0 gap-5 overflow-y-auto p-5">
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
              <label className="field">
                <span className="label">Name</span>
                <Input
                  className="text-input"
                  maxLength={maxNameLength}
                  value={name}
                  onValueChange={setName}
                />
              </label>
              <Select
                value={slot}
                items={slots}
                onValueChange={(next) => {
                  if (next) setSlot(next);
                }}
              >
                <div className="field">
                  <SelectLabel className="label">Slot</SelectLabel>
                  <SelectTrigger className="select-trigger">
                    <SelectValue />
                    <span aria-hidden="true">▾</span>
                  </SelectTrigger>
                </div>
                <SelectContent className="select-content">
                  {slots.map((item) => (
                    <SelectItem key={item} value={item} className="select-item">
                      {item}
                      <SelectCheck />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {entry ? (
              <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
                <label className="field">
                  <span className="label">Description</span>
                  <Input
                    className="text-input"
                    maxLength={maxDescriptionLength}
                    value={description}
                    onValueChange={setDescription}
                  />
                </label>
                <label className="field">
                  <span className="label">Par time</span>
                  <Input
                    className="text-input"
                    aria-invalid={parValue === undefined}
                    placeholder="2:15"
                    value={par}
                    onValueChange={setPar}
                  />
                </label>
              </div>
            ) : (
              <fieldset className="m-0 grid gap-1.5 border-0 p-0">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <legend className="label p-0">Start from</legend>
                  <div
                    role="group"
                    aria-label="Start from"
                    className="flex rounded-[3px] border border-border p-0.5"
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
                        className="rounded-[2px] border-0 bg-transparent px-2.5 py-1 text-xs text-fg-muted aria-pressed:bg-surface-raised aria-pressed:font-semibold aria-pressed:text-fg"
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
                        className="grid gap-1.5 rounded-[3px] border border-border bg-transparent p-2 text-fg-muted aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-fg"
                        onClick={() => setTemplate(item.value)}
                      >
                        <MapOutline
                          map={item.map}
                          className="h-20 w-full bg-canvas"
                          solidColor="var(--color-fg-muted)"
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
                        className="grid gap-1.5 rounded-[3px] border border-border bg-transparent p-2 text-left text-fg-muted aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-fg"
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
                          className="h-20 w-full bg-canvas"
                        />
                        {item.title}
                      </button>
                    ))}
                  </div>
                )}
                {source === "featured" ? (
                  <p className="m-0 mt-1 text-xs text-fg-muted">
                    You get your own copy in this episode. The featured map
                    stays as it is.
                  </p>
                ) : null}
              </fieldset>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="field">
                <span className="label">Format</span>
                <span>Classic Doom</span>
              </div>
              <div className="field">
                <span className="label">Texture pack</span>
                <span>freedoom2</span>
              </div>
            </div>
          </div>
          <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
            {error || !slot ? (
              <p role="alert" className="m-0 mr-auto min-w-0 text-danger">
                {error ?? "All 32 map slots are in use."}
              </p>
            ) : null}
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={!canSubmit}
            >
              {entry ? "Save" : "Create map"}
            </button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { dialogClass, MapDialog, titleClass, type MapDetails };
