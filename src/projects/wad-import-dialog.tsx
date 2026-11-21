import { Checkbox, CheckboxIndicator } from "@ui-sdk/react/checkbox";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { Check, X } from "lucide-react";
import { useState } from "react";

import type { GameMap } from "../map/types";
import type { ImportReport } from "../wad/decompile";

type ImportedMap = { slot: string; map: GameMap; report: ImportReport };

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

function tally(entries: Record<string, number>[]) {
  const total = new Map<string, number>();
  for (const entry of entries) {
    for (const [label, count] of Object.entries(entry)) {
      total.set(label, (total.get(label) ?? 0) + count);
    }
  }
  return [...total].toSorted((a, b) => b[1] - a[1]);
}

function sum(reports: ImportReport[], pick: (report: ImportReport) => number) {
  return reports.reduce((total, report) => total + pick(report), 0);
}

function losses(reports: ImportReport[]) {
  const things = tally(reports.map((report) => report.droppedThings));
  const actions = tally(reports.map((report) => report.droppedActions));
  const textures = [
    ...new Set(reports.flatMap((report) => report.replacedTextures)),
  ];
  const rows: { label: string; detail: string }[] = [];
  if (things.length > 0) {
    rows.push({
      label: plural(
        things.reduce((total, [, count]) => total + count, 0),
        "thing",
      ),
      detail: things.map(([name, count]) => `${name} ×${count}`).join(", "),
    });
  }
  if (actions.length > 0) {
    rows.push({
      label: plural(
        actions.reduce((total, [, count]) => total + count, 0),
        "line action",
      ),
      detail: actions.map(([name, count]) => `${name} ×${count}`).join(", "),
    });
  }
  const seeThrough = sum(reports, (report) => report.seeThroughWalls);
  if (seeThrough > 0) {
    rows.push({
      label: plural(seeThrough, "see-through wall"),
      detail: "Grates, fences and windows lose their middle texture.",
    });
  }
  if (textures.length > 0) {
    rows.push({
      label: plural(textures.length, "texture"),
      detail: `Not in Freedoom's editable set, so replaced: ${textures.join(", ")}.`,
    });
  }
  const effects = sum(reports, (report) => report.droppedEffects);
  if (effects > 0) {
    rows.push({
      label: plural(effects, "room effect"),
      detail: "Lighting and damage effects the editor doesn't have yet.",
    });
  }
  const multiplayer = sum(reports, (report) => report.multiplayerThings);
  if (multiplayer > 0) {
    rows.push({
      label: plural(multiplayer, "multiplayer thing"),
      detail: "Things that only appear in network games.",
    });
  }
  const outside = sum(reports, (report) => report.outsideThings);
  if (outside > 0) {
    rows.push({
      label: plural(
        outside,
        "thing outside the rooms",
        "things outside the rooms",
      ),
      detail: "Usually kept out of sight for engine tricks.",
    });
  }
  const skipped = sum(reports, (report) => report.skippedSectors);
  if (skipped > 0) {
    rows.push({
      label: plural(skipped, "unclosed sector"),
      detail: "Their walls don't form a closed outline.",
    });
  }
  const plainDoors = sum(reports, (report) => report.plainDoors);
  if (plainDoors > 0) {
    rows.push({
      label: plural(plainDoors, "door"),
      detail:
        "Doors that touch another door, or that were cut around a pillar, stay closed rooms. Give them height to open them.",
    });
  }
  const backward = sum(reports, (report) => report.backwardSwitches);
  if (backward > 0) {
    rows.push({
      label: plural(backward, "line you press", "lines you press"),
      detail:
        "Switches and doors on open walls that now work only from the other side.",
    });
  }
  const skullKeys = sum(reports, (report) => report.skullKeys);
  if (skullKeys > 0) {
    rows.push({
      label: plural(skullKeys, "skull key"),
      detail: "Became keycards of the same color, which open the same doors.",
    });
  }
  return rows;
}

function WadImportDialog({
  fileName,
  maps,
  slots,
  onImport,
  onClose,
}: {
  fileName: string;
  maps: ImportedMap[];
  slots: string[];
  onImport: (picked: { map: GameMap; slot: string }[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(() =>
    maps.slice(0, slots.length).map((entry) => entry.slot),
  );
  const chosen = maps.filter((entry) => picked.includes(entry.slot));
  const rows = losses(chosen.map((entry) => entry.report));
  const split = sum(
    chosen.map((entry) => entry.report),
    (report) => report.splitSectors,
  );
  const target = (entry: ImportedMap) => slots[chosen.indexOf(entry)];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop className="fixed inset-0 z-40 bg-scrim" />
      <DialogContent className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[600px] max-w-[calc(100vw-32px)] -translate-1/2 flex-col rounded-[4px] border border-border-strong bg-surface outline-none">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-5">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <DialogTitle className="block shrink-0 font-sans text-xl font-semibold tracking-normal text-fg normal-case">
              Import maps
            </DialogTitle>
            <DialogDescription className="truncate font-mono text-xs text-fg-muted">
              {fileName} · {plural(maps.length, "map")}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close"
            className="border-0 bg-transparent p-1 text-fg-muted hover:text-fg"
          >
            <X size={16} aria-hidden="true" />
          </DialogClose>
        </header>
        <div className="grid min-h-0 gap-5 overflow-y-auto p-5">
          <section aria-label="Maps to import" className="grid gap-2">
            <h3 className="m-0 flex justify-between font-mono text-xs font-normal text-fg-muted">
              <span>MAPS</span>
              <span>
                {picked.length} of {plural(slots.length, "free slot")}
              </span>
            </h3>
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {maps.map((entry) => {
                const on = picked.includes(entry.slot);
                const full = !on && picked.length >= slots.length;
                return (
                  <li key={entry.slot}>
                    <label className="grid cursor-pointer grid-cols-[16px_48px_minmax(0,1fr)_auto] items-center gap-2.5 text-sm has-[[data-disabled]]:cursor-default has-[[data-disabled]]:opacity-50">
                      <Checkbox
                        className="flex size-4 items-center justify-center rounded-[2px] border border-input bg-transparent p-0 text-accent-fg aria-checked:border-accent aria-checked:bg-accent"
                        checked={on}
                        disabled={full}
                        onCheckedChange={(checked) =>
                          setPicked((current) =>
                            checked
                              ? maps
                                  .map((item) => item.slot)
                                  .filter(
                                    (slot) =>
                                      current.includes(slot) ||
                                      slot === entry.slot,
                                  )
                              : current.filter((slot) => slot !== entry.slot),
                          )
                        }
                      >
                        <CheckboxIndicator>
                          <Check size={12} aria-hidden="true" />
                        </CheckboxIndicator>
                      </Checkbox>
                      <span className="font-mono text-xs text-fg-muted">
                        {entry.slot}
                      </span>
                      <span className="min-w-0 truncate text-fg-muted">
                        {plural(entry.report.rooms, "room")} ·{" "}
                        {plural(entry.map.things.length, "thing")}
                      </span>
                      <span className="font-mono text-xs text-fg-muted">
                        {on ? `→ ${target(entry)}` : ""}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
          {rows.length > 0 ? (
            <section aria-label="Left out" className="grid gap-2">
              <h3 className="m-0 font-mono text-xs font-normal text-fg-muted">
                LEFT OUT OR CHANGED
              </h3>
              <dl className="m-0 grid gap-2">
                {rows.map((row) => (
                  <div
                    key={row.label}
                    className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 text-sm"
                  >
                    <dt className="text-fg">{row.label}</dt>
                    <dd className="m-0 text-fg-muted">{row.detail}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="muted min-w-0">
            {split > 0
              ? `${plural(split, "sector")} with pillars or holes become several rooms.`
              : "Each sector becomes a room."}
          </p>
          <button
            type="button"
            className="button primary shrink-0"
            disabled={chosen.length === 0}
            onClick={() =>
              onImport(
                chosen.map((entry) => ({
                  map: entry.map,
                  slot: target(entry),
                })),
              )
            }
          >
            Import {chosen.length > 1 ? plural(chosen.length, "map") : "map"}
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

export { WadImportDialog, type ImportedMap };
