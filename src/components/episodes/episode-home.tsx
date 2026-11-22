import {
  FileInput,
  FileInputDropzone,
  FileInputTrigger,
} from "@ui-sdk/react/file-input";
import {
  Download,
  Ellipsis,
  GripVertical,
  Package,
  Pencil,
  Play,
  Plus,
  Route,
  Upload,
} from "lucide-react";
import * as React from "react";

import type { CheckContext } from "@/lib/map/validate";

import { AppShell, Crumb, type SidebarProps } from "@/components/app-sidebar";
import { MapPlan } from "@/components/map-plan";
import { Alert } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { useBuildProblem } from "@/hooks/use-build-checks";
import { useNow } from "@/hooks/use-now";
import { engineSlot, type GameInfo, slotCount } from "@/lib/engine/game";
import {
  bySlot,
  type Episode,
  type EpisodeMap,
  formatPar,
  freeSlots,
  mapName,
  mapStatus,
  maxNameLength,
} from "@/lib/episodes/episode-data";

import type { MapDetails } from "./map-dialog";

import { MapDialog } from "./map-dialog";
import { MapOrder, MapOrderHandle, MapOrderRow } from "./map-order";

type MapAction = "open" | "settings" | "duplicate" | "delete" | "up" | "down";

interface Confirmation {
  title: string;
  body: string;
  run: () => void;
}

const statusDots = {
  ready: "bg-success",
  warning: "bg-warning",
  error: "bg-destructive",
  checking: "bg-muted-foreground",
};

interface MapRowProps {
  entry: EpisodeMap;
  now: number;
  slot: string;
  context: CheckContext;
  canDuplicate: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  hint: string;
  onAction: (action: MapAction, entry: EpisodeMap) => void;
}

// Memoized so a drag, which rerenders the list on every swap, redraws only the
// rows whose props changed.
const MapRow = React.memo(function MapRow({
  entry,
  now,
  slot,
  context,
  canDuplicate,
  canMoveUp,
  canMoveDown,
  hint,
  onAction,
}: MapRowProps) {
  const onOpen = () => onAction("open", entry);
  const problem = useBuildProblem(entry);
  const status = mapStatus(entry, problem, context);
  const name = mapName(entry);
  return (
    <MapOrderRow
      value={entry.id}
      className="group h-24 select-none *:border-b *:border-border hover:*:bg-muted data-drag-preview:flex data-drag-preview:items-center data-drag-preview:rounded-[4px] data-drag-preview:border! data-drag-preview:border-border! data-drag-preview:bg-card! data-drag-preview:shadow-xl data-drag-preview:*:shrink-0 data-drag-preview:*:border-b-0 data-dragging:text-transparent data-dragging:*:*:invisible data-dragging:*:border-y-2 data-dragging:*:border-dashed data-dragging:*:bg-muted/60 data-dragging:*:first:border-l-2 data-dragging:*:last:border-r-2 data-moving:*:bg-muted data-moving:*:first:shadow-[inset_2px_0_0_var(--color-primary)]"
      onClick={(event) => {
        if (
          !entry.broken &&
          !(event.target as Element).closest("button, [role=menu]")
        ) {
          onOpen();
        }
      }}
    >
      <td className="w-6">
        <MapOrderHandle
          value={entry.id}
          aria-label={`Move ${name}`}
          aria-describedby={hint}
          className="flex h-8 w-full cursor-grab touch-none items-center justify-center rounded-[3px] border-0 bg-transparent p-0 text-muted-foreground/60 group-hover:text-muted-foreground group-data-drag-preview:cursor-grabbing group-data-moving:text-primary focus-visible:-outline-offset-2"
        >
          <GripVertical size={14} aria-hidden="true" />
        </MapOrderHandle>
      </td>
      <td className="w-16 font-mono text-xs">{slot}</td>
      <td className="w-36 max-[900px]:hidden">
        <MapPlan
          map={entry.map}
          className="h-[76px] w-[128px] rounded-[2px] border border-input bg-card"
        />
      </td>
      <td className="max-w-0 pr-4 pl-6 group-data-drag-preview:max-w-none group-data-drag-preview:min-w-0 group-data-drag-preview:flex-1 group-data-drag-preview:shrink! max-[900px]:pl-0">
        <button
          type="button"
          disabled={entry.broken}
          className="block max-w-full truncate border-0 bg-transparent p-0 text-left text-[17px] font-semibold text-foreground"
          onClick={onOpen}
        >
          {name}
        </button>
        <div className="truncate text-sm text-muted-foreground">
          {entry.description}
        </div>
      </td>
      <td className="w-20 text-right font-mono text-sm max-[700px]:hidden">
        {entry.map.sectors.length}
      </td>
      <td className="w-20 text-right font-mono text-sm max-[700px]:hidden">
        {entry.map.things.length}
      </td>
      <td className="w-16 text-right font-mono text-sm max-[480px]:hidden">
        {formatPar(entry.par) || (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="w-32 pl-4">
        <span
          className="flex items-center gap-2 text-sm whitespace-nowrap"
          title={"detail" in status ? status.detail : undefined}
        >
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${statusDots[status.kind]}`}
          />
          {status.label}
        </span>
      </td>
      <td className="w-24 text-sm whitespace-nowrap text-muted-foreground max-[900px]:hidden">
        {formatEdited(entry.editedAt, now)}
      </td>
      <td className="w-10">
        <Menu>
          <MenuTrigger
            className={buttonVariants({ variant: "ghost", size: "icon" })}
            aria-label={`Actions for ${name}`}
          >
            <Ellipsis size={16} aria-hidden="true" />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem disabled={entry.broken} onSelect={onOpen}>
              Open
            </MenuItem>
            <MenuItem
              disabled={entry.broken}
              onSelect={() => onAction("settings", entry)}
            >
              Map settings
            </MenuItem>
            <MenuItem
              disabled={entry.broken || !canDuplicate}
              onSelect={() => onAction("duplicate", entry)}
            >
              Duplicate
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              disabled={!canMoveUp}
              onSelect={() => onAction("up", entry)}
            >
              Move up
            </MenuItem>
            <MenuItem
              disabled={!canMoveDown}
              onSelect={() => onAction("down", entry)}
            >
              Move down
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              variant="destructive"
              destructive
              onSelect={() => onAction("delete", entry)}
            >
              Delete
            </MenuItem>
          </MenuContent>
        </Menu>
      </td>
    </MapOrderRow>
  );
});

const importTypes = [
  ".json",
  ".wad",
  ".zip",
  ".deh",
  ".bex",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
];
const noFiles: File[] = [];

interface EpisodeHomeProps {
  sidebar: SidebarProps;
  episode: Episode;
  maps: EpisodeMap[];
  game: GameInfo;
  context: CheckContext;
  message: string | null;
  onRenameEpisode: (name: string) => void;
  onDeleteEpisode: () => void;
  onExportEpisode: () => void;
  onImportEpisode: (file: File) => void;
  onImportFiles: (files: File[]) => void;
  onBuildEpisode: () => void;
  onPlayEpisode: () => void;
  onOpenMap: (entry: EpisodeMap) => void;
  onCreateMap: (details: MapDetails) => Promise<string | null>;
  onUpdateMap: (
    entry: EpisodeMap,
    details: MapDetails,
  ) => Promise<string | null>;
  onDuplicateMap: (entry: EpisodeMap) => void;
  onDeleteMap: (entry: EpisodeMap) => void;
  onReorderMaps: (order: string[]) => Promise<void>;
}

export function EpisodeHome({
  sidebar,
  episode,
  maps,
  game,
  context,
  message,
  onRenameEpisode,
  onDeleteEpisode,
  onExportEpisode,
  onImportEpisode,
  onImportFiles,
  onBuildEpisode,
  onPlayEpisode,
  onOpenMap,
  onCreateMap,
  onUpdateMap,
  onDuplicateMap,
  onDeleteMap,
  onReorderMaps,
}: EpisodeHomeProps) {
  const now = useNow(60_000);
  const [creatingMap, setCreatingMap] = React.useState(false);
  const [editing, setEditing] = React.useState<EpisodeMap | null>(null);
  const [renaming, setRenaming] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState<Confirmation | null>(
    null,
  );
  const hint = React.useId();
  const [saving, setSaving] = React.useState<string[] | null>(null);
  const accepted = React.useRef(false);
  const episodeFile = React.useRef<HTMLInputElement>(null);
  const { durable } = sidebar;
  const sorted = React.useMemo(() => bySlot(maps), [maps]);
  const byId = React.useMemo(
    () => new Map(sorted.map((entry) => [entry.id, entry])),
    [sorted],
  );
  const nextSlot = freeSlots(maps, undefined, game)[0];
  const lastEdited = Math.max(...maps.map((entry) => entry.editedAt));
  const label = (slot: string) => engineSlot(slot, game);
  const range =
    sorted.length > 1
      ? `${label(sorted[0].slot)} to ${label(sorted[sorted.length - 1].slot)}`
      : sorted[0] && label(sorted[0].slot);

  // Holds the dropped order until the save lands, so rows don't snap back meanwhile.
  const saveOrder = (order: string[]) => {
    setSaving(order);
    void onReorderMaps(order).finally(() => setSaving(null));
  };

  const reorder = (id: string, index: number) => {
    const order = sorted.map((entry) => entry.id).filter((item) => item !== id);
    const from = sorted.findIndex((entry) => entry.id === id);
    order.splice(index > from ? index - 1 : index, 0, id);
    saveOrder(order);
  };

  const act = (action: MapAction, entry: EpisodeMap) => {
    const index = sorted.findIndex((item) => item.id === entry.id);
    if (action === "open") onOpenMap(entry);
    else if (action === "settings") setEditing(entry);
    else if (action === "duplicate") onDuplicateMap(entry);
    else if (action === "up") reorder(entry.id, index - 1);
    else if (action === "down") reorder(entry.id, index + 2);
    else {
      setConfirmation({
        title: `Delete ${mapName(entry)}?`,
        body: `${label(entry.slot)} is removed from this browser. Back up the episode first if you might need it.`,
        run: () => onDeleteMap(entry),
      });
    }
  };
  const latestAct = React.useRef(act);
  React.useLayoutEffect(() => {
    latestAct.current = act;
  });
  const onAction = React.useCallback(
    (action: MapAction, entry: EpisodeMap) => latestAct.current(action, entry),
    [],
  );
  const order = React.useMemo(
    () => saving ?? sorted.map((entry) => entry.id),
    [saving, sorted],
  );

  return (
    <AppShell
      sidebar={sidebar}
      crumbs={<Crumb>{episode.name}</Crumb>}
      actions={
        <>
          <Button onClick={onExportEpisode}>
            <Download size={14} aria-hidden="true" />
            <span className="max-[1000px]:sr-only">Back up</span>
          </Button>
          <Button disabled={maps.length === 0} onClick={onBuildEpisode}>
            <Package size={14} aria-hidden="true" />
            <span className="max-[1000px]:sr-only">Build WAD</span>
          </Button>
          <Menu>
            <MenuTrigger
              className={buttonVariants({ className: "px-2" })}
              aria-label="More episode actions"
            >
              <Ellipsis size={16} aria-hidden="true" />
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem onSelect={() => episodeFile.current?.click()}>
                Import episode backup
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                variant="destructive"
                destructive
                disabled={sidebar.episodes.length === 1}
                onSelect={() =>
                  setConfirmation({
                    title: `Delete ${episode.name}?`,
                    body: `This removes the episode and its ${countLabel(maps.length)} from this browser.`,
                    run: onDeleteEpisode,
                  })
                }
              >
                Delete episode
              </MenuItem>
            </MenuContent>
          </Menu>
          <Button
            variant="primary"

            disabled={maps.length === 0}
            onClick={onPlayEpisode}
          >
            <Play size={14} aria-hidden="true" />
            <span className="max-[600px]:sr-only">Play</span>
          </Button>
        </>
      }
    >
      <main className="flex flex-col gap-5 px-8 pt-10 pb-6 max-[760px]:px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="m-0 truncate text-4xl leading-tight font-bold">
              {episode.name}
            </h1>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label="Rename episode"
              title="Rename episode"
              onClick={() => setRenaming(true)}
            >
              <Pencil size={15} aria-hidden="true" />
            </Button>
          </div>
          <p className="m-0 mt-1 font-mono text-xs text-muted-foreground">
            {[
              countLabel(maps.length),
              range,
              maps.length > 0
                ? `edited ${formatEdited(lastEdited, now).toLowerCase()}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {!durable ? (
          <Alert variant="destructive" role="alert">
            Browser storage is unavailable, so episodes last only until this tab
            closes. Back up to keep your work.
          </Alert>
        ) : null}
        {message ? <Alert role="status">{message}</Alert> : null}
        {sorted.length > 1 ? (
          <p className="m-0 flex items-center gap-2.5 rounded-[3px] border border-border bg-card px-3 py-2.5 text-sm text-foreground">
            <Route size={15} aria-hidden="true" className="text-info" />
            Maps play in slot order, and an exit takes everyone to the next
            slot. Drag a row to change the order.
          </p>
        ) : null}
        <FileInput
          multiple
          accept={importTypes}
          disabled={!nextSlot}
          value={noFiles}
          onValueChange={(_, details) => {
            const { added } = details;
            details.cancel();
            if (added.length === 0) return;
            accepted.current = true;
            queueMicrotask(() => {
              accepted.current = false;
            });
            onImportFiles(added);
          }}
          // A drop with a WAD and its readme leaves the readme out quietly.
          onReject={(rejected) => {
            if (!accepted.current) {
              onImportFiles(rejected.map((item) => item.file));
            }
          }}
        >
          <FileInputDropzone className="group relative flex flex-col gap-5 rounded-[6px] outline-2 outline-offset-4 outline-transparent data-[dragging]:outline-primary data-[dragging]:outline-dashed">
            {sorted.length > 0 ? (
              <table className="w-full border-separate border-spacing-0 text-left">
                <thead>
                  <tr className="h-8 font-mono text-xs tracking-wide text-muted-foreground [&>th]:border-b [&>th]:border-border [&>th]:font-normal">
                    <th className="w-6">
                      <span className="sr-only">Order</span>
                    </th>
                    <th className="w-16">SLOT</th>
                    <th className="w-36 max-[900px]:hidden">
                      <span className="sr-only">Preview</span>
                    </th>
                    <th className="pl-6 max-[900px]:pl-0">MAP</th>
                    <th className="w-20 text-right max-[700px]:hidden">
                      SECTORS
                    </th>
                    <th className="w-20 text-right max-[700px]:hidden">
                      THINGS
                    </th>
                    <th className="w-16 text-right max-[480px]:hidden">PAR</th>
                    <th className="w-32 pl-4">STATUS</th>
                    <th className="w-24 max-[900px]:hidden">EDITED</th>
                    <th className="w-10">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <MapOrder
                  value={order}
                  onValueChange={saveOrder}
                  label={(id) => {
                    const entry = byId.get(id);
                    return entry ? mapName(entry) : undefined;
                  }}
                >
                  {({ order: shown }) =>
                    shown.map((id, index) => {
                      const entry = byId.get(id);
                      if (!entry) return null;
                      return (
                        <MapRow
                          key={entry.id}
                          entry={entry}
                          now={now}
                          slot={label(sorted[index]?.slot ?? entry.slot)}
                          context={context}
                          canDuplicate={Boolean(nextSlot)}
                          canMoveUp={index > 0}
                          canMoveDown={index < sorted.length - 1}
                          hint={hint}
                          onAction={onAction}
                        />
                      );
                    })
                  }
                </MapOrder>
              </table>
            ) : (
              <p className="m-0 text-muted-foreground">
                This episode has no maps yet.
              </p>
            )}
            <p id={hint} hidden>
              Press Space to pick up a map, the arrow keys to move it, and Space
              again to drop it. Escape puts it back.
            </p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-6">
              {nextSlot ? (
                <>
                  <button
                    type="button"
                    className="flex min-h-[24px] items-center gap-2 border-0 bg-transparent p-0 text-sm font-semibold text-primary hover:underline"
                    onClick={() => setCreatingMap(true)}
                  >
                    <Plus size={14} aria-hidden="true" />
                    Add a map in {nextSlot}
                  </button>
                  <FileInputTrigger className="min-h-[24px] border-0 bg-transparent p-0 text-sm text-muted-foreground hover:text-foreground hover:underline">
                    or import a map file or WAD
                  </FileInputTrigger>
                </>
              ) : (
                <p className="m-0 text-sm text-muted-foreground">
                  All {slotCount(game)} map slots are in use.
                </p>
              )}
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 hidden items-center justify-center gap-2 rounded-[6px] bg-background/95 text-sm font-semibold text-primary group-data-[dragging]:flex"
            >
              <Upload size={16} />
              Drop a map file, WAD or zip to import it
            </div>
          </FileInputDropzone>
        </FileInput>
      </main>
      <input
        ref={episodeFile}
        type="file"
        hidden
        accept=".json,application/json"
        aria-label="Import episode backup"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImportEpisode(file);
          event.target.value = "";
        }}
      />
      {creatingMap ? (
        <MapDialog
          maps={maps}
          game={game}
          onClose={() => setCreatingMap(false)}
          onSubmit={onCreateMap}
        />
      ) : null}
      {editing ? (
        <MapDialog
          maps={maps}
          entry={editing}
          game={game}
          onClose={() => setEditing(null)}
          onSubmit={(details) => onUpdateMap(editing, details)}
        />
      ) : null}
      {renaming ? (
        <NameDialog
          initial={episode.name}
          onClose={() => setRenaming(false)}
          onSubmit={(name) => {
            onRenameEpisode(name);
            setRenaming(false);
          }}
        />
      ) : null}
      {confirmation ? (
        <ConfirmDialog
          confirmation={confirmation}
          onClose={() => setConfirmation(null)}
        />
      ) : null}
    </AppShell>
  );
}

function formatEdited(time: number, now: number) {
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} hr ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(time);
}

function countLabel(count: number) {
  return `${count} ${count === 1 ? "map" : "maps"}`;
}

interface NameDialogProps {
  initial: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

function NameDialog({ initial, onSubmit, onClose }: NameDialogProps) {
  const [name, setName] = React.useState(initial);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim()) onSubmit(name.trim());
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent className="w-[420px]">
        <form onSubmit={submit} className="grid gap-4 p-5">
          <DialogTitle>Rename episode</DialogTitle>
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input
              maxLength={maxNameLength}
              value={name}
              onValueChange={setName}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              type="submit"

              disabled={!name.trim()}
            >
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ConfirmDialogProps {
  confirmation: Confirmation;
  onClose: () => void;
}

function ConfirmDialog({ confirmation, onClose }: ConfirmDialogProps) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogBackdrop />
      <AlertDialogContent className="w-[420px]">
        <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
        <AlertDialogDescription>{confirmation.body}</AlertDialogDescription>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"

            onClick={() => {
              confirmation.run();
              onClose();
            }}
          >
            Delete
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
