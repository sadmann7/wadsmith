import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { Input } from "@ui-sdk/react/input";
import { CircleCheck, CircleX, TriangleAlert, X } from "lucide-react";
import { useState } from "react";

import { wadFileName } from "../editor/build-dialog";
import { mapName, mapSlots, mapStatus, type ProjectMap } from "./project-data";

const statusIcons = {
  ready: { icon: CircleCheck, className: "text-success" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  error: { icon: CircleX, className: "text-danger" },
};

function EpisodeBuildDialog({
  name,
  maps,
  onBuild,
  onOpenMap,
  onClose,
}: {
  name: string;
  maps: ProjectMap[];
  onBuild: (fileName: string) => string | null;
  onOpenMap: (entry: ProjectMap) => void;
  onClose: () => void;
}) {
  const [fileName, setFileName] = useState(() =>
    wadFileName(name.toLowerCase()),
  );
  const [buildError, setBuildError] = useState<string | null>(null);
  const rows = maps.map((entry) => ({ entry, status: mapStatus(entry) }));
  const blocked = rows.filter((row) => row.status.kind === "error");
  const last = maps.at(-1);
  const gaps = last
    ? mapSlots
        .slice(0, mapSlots.indexOf(last.slot))
        .filter((slot) => !maps.some((entry) => entry.slot === slot))
    : [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop className="fixed inset-0 z-40 bg-scrim" />
      <DialogContent className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[560px] max-w-[calc(100vw-32px)] -translate-1/2 flex-col rounded-[4px] border border-border-strong bg-surface outline-none">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <DialogTitle className="block font-sans text-xl font-semibold tracking-normal text-fg normal-case">
              Build WAD
            </DialogTitle>
            <DialogDescription className="truncate font-mono text-xs text-fg-muted">
              {name} · {maps.length} {maps.length === 1 ? "map" : "maps"}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close"
            className="border-0 bg-transparent p-1 text-fg-muted hover:text-fg"
          >
            <X size={16} aria-hidden="true" />
          </DialogClose>
        </header>
        <div className="grid min-h-0 gap-4 overflow-y-auto p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
            <label className="field">
              <span className="label">File name</span>
              <Input
                className="text-input"
                value={fileName}
                onValueChange={setFileName}
              />
            </label>
            <div className="field">
              <span className="label">Format</span>
              <div className="flex min-h-[30px] items-center">Classic Doom</div>
            </div>
          </div>
          <section aria-label="Maps in the WAD" className="grid gap-2">
            <h3 className="m-0 flex justify-between font-mono text-xs font-normal text-fg-muted">
              <span>MAPS</span>
              <span>
                {blocked.length > 0
                  ? `${blocked.length} to fix`
                  : maps.length > 0
                    ? `${maps.length} ready`
                    : null}
              </span>
            </h3>
            <ul className="m-0 grid list-none gap-2 p-0">
              {rows.map(({ entry, status }) => {
                const { icon: Icon, className } = statusIcons[status.kind];
                return (
                  <li
                    key={entry.id}
                    className="grid grid-cols-[14px_48px_minmax(0,1fr)_auto] items-center gap-2"
                  >
                    <Icon size={14} className={className} aria-hidden="true" />
                    <span className="font-mono text-xs text-fg-muted">
                      {entry.slot}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">
                        {mapName(entry)}
                        <span className="ml-2 font-mono text-xs text-fg-muted">
                          {status.label}
                          {entry.broken ? " · delete it to build" : ""}
                        </span>
                      </span>
                      {"detail" in status ? (
                        <span className="block text-xs text-fg-muted">
                          {status.detail}
                        </span>
                      ) : null}
                    </span>
                    {status.kind === "error" && !entry.broken ? (
                      <button
                        type="button"
                        className="border-0 bg-transparent p-0 text-fg-muted hover:text-fg"
                        aria-label={`Open ${entry.slot} to fix it`}
                        onClick={() => onOpenMap(entry)}
                      >
                        Open
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {gaps.length > 0 ? (
              <p className="m-0 text-sm text-fg-muted">
                {gaps.join(", ")} {gaps.length === 1 ? "has" : "have"} no map,
                so the game uses Freedoom&apos;s own{" "}
                {gaps.length === 1 ? "level" : "levels"} there.
              </p>
            ) : null}
          </section>
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p
            className={buildError ? "min-w-0 text-danger" : "muted min-w-0"}
            role={buildError ? "alert" : undefined}
          >
            {buildError ??
              (maps.length === 0
                ? "This episode has no maps."
                : blocked.length > 0
                  ? `Fix ${blocked.map((row) => row.entry.slot).join(", ")} before building.`
                  : "Ready to download.")}
          </p>
          <button
            type="button"
            className="button primary shrink-0"
            disabled={blocked.length > 0 || maps.length === 0}
            onClick={() => setBuildError(onBuild(wadFileName(fileName)))}
          >
            Download WAD
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

export { EpisodeBuildDialog };
