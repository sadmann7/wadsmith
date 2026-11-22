import { CircleCheck, CircleX, Loader, TriangleAlert } from "lucide-react";
import * as React from "react";

import { wadFileName } from "@/components/editor/build-dialog";
import { engineSlot, type GameInfo } from "@/lib/engine/game";
import type { CheckContext } from "@/lib/map/validate";
import { useBuildChecks } from "@/hooks/use-build-checks";
import {
  mapName,
  mapSlots,
  mapStatus,
  type EpisodeMap,
} from "@/lib/episodes/episode-data";
import { Button } from "@/components/ui/button";
import { Field, FieldItem, FieldLabel, Label } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const statusIcons = {
  ready: { icon: CircleCheck, className: "text-success" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  error: { icon: CircleX, className: "text-destructive" },
  checking: {
    icon: Loader,
    className: "text-muted-foreground motion-safe:animate-spin",
  },
};

interface EpisodeBuildDialogProps {
  name: string;
  maps: EpisodeMap[];
  game: GameInfo;
  context: CheckContext;
  onBuild: (fileName: string) => string | null;
  onOpenMap: (entry: EpisodeMap) => void;
  onClose: () => void;
}

export function EpisodeBuildDialog({
  name,
  maps,
  game,
  context,
  onBuild,
  onOpenMap,
  onClose,
}: EpisodeBuildDialogProps) {
  const [fileName, setFileName] = React.useState(() =>
    wadFileName(name.toLowerCase()),
  );
  const [buildError, setBuildError] = React.useState<string | null>(null);
  const checks = useBuildChecks(maps);
  const rows = maps.map((entry) => ({
    entry,
    status: mapStatus(entry, checks.problem(entry), context),
  }));
  const blocked = rows.filter((row) => row.status.kind === "error");
  const checking = rows.some((row) => row.status.kind === "checking");
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
      <DialogBackdrop />
      <DialogContent className="w-[560px]">
        <DialogHeader>
          <div className="flex min-w-0 items-baseline gap-2.5">
            <DialogTitle>Build WAD</DialogTitle>
            <DialogDescription>
              {name} · {maps.length} {maps.length === 1 ? "map" : "maps"}
            </DialogDescription>
          </div>
          <DialogCloseButton />
        </DialogHeader>
        <div className="relative grid min-h-0 gap-4 overflow-y-auto p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
            <Field>
              <FieldLabel>File name</FieldLabel>
              <Input value={fileName} onValueChange={setFileName} />
            </Field>
            <FieldItem>
              <Label>Format</Label>
              <div className="flex min-h-[30px] items-center">Classic Doom</div>
            </FieldItem>
          </div>
          <section aria-label="Maps in the WAD" className="grid gap-2">
            <h3 className="m-0 flex justify-between font-mono text-xs font-normal text-muted-foreground">
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
                    <span className="font-mono text-xs text-muted-foreground">
                      {entry.slot}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">
                        {mapName(entry)}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {status.label}
                          {entry.broken ? " · delete it to build" : ""}
                        </span>
                      </span>
                      {"detail" in status ? (
                        <span className="block text-xs text-muted-foreground">
                          {status.detail}
                        </span>
                      ) : null}
                    </span>
                    {status.kind === "error" && !entry.broken ? (
                      <button
                        type="button"
                        className="border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
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
              <p className="m-0 text-sm text-muted-foreground">
                {gaps.map((slot) => engineSlot(slot, game)).join(", ")}{" "}
                {gaps.length === 1 ? "has" : "have"} no map, so the game uses{" "}
                {game.label}&apos;s own {gaps.length === 1 ? "level" : "levels"}{" "}
                there.
              </p>
            ) : null}
          </section>
        </div>
        <DialogFooter className="justify-between">
          <p
            className={
              buildError
                ? "min-w-0 text-destructive"
                : "min-w-0 text-muted-foreground"
            }
            role={buildError ? "alert" : undefined}
          >
            {buildError ??
              (maps.length === 0
                ? "This episode has no maps."
                : blocked.length > 0
                  ? `Fix ${blocked.map((row) => row.entry.slot).join(", ")} before building.`
                  : checking
                    ? "Checking that every map builds…"
                    : "Ready to download.")}
          </p>
          <Button
            variant="primary"
            className="shrink-0"
            disabled={blocked.length > 0 || checking || maps.length === 0}
            onClick={() => setBuildError(onBuild(wadFileName(fileName)))}
          >
            Download WAD
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
