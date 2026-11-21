import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@ui-sdk/react/alert-dialog";
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { Input } from "@ui-sdk/react/input";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@ui-sdk/react/menu";
import {
  Download,
  Ellipsis,
  GripVertical,
  Package,
  Pencil,
  Play,
  Plus,
  Route,
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";

import { MapPlan } from "../editor/map-plan";
import { MapDialog, dialogClass, titleClass } from "./map-dialog";
import type { MapDetails } from "./map-dialog";
import {
  bySlot,
  formatPar,
  freeSlots,
  mapName,
  mapStatus,
  maxNameLength,
  type Project,
  type ProjectMap,
} from "./project-data";
import { AppShell, Crumb, type SidebarProps } from "./app-sidebar";

type Confirmation = { title: string; body: string; run: () => void };

const statusDots = {
  ready: "bg-success",
  warning: "bg-warning",
  error: "bg-danger",
};

function formatEdited(time: number) {
  const minutes = Math.floor((Date.now() - time) / 60_000);
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

function NameDialog({
  initial,
  onSubmit,
  onClose,
}: {
  initial: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const submit = (event: FormEvent) => {
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
      <DialogBackdrop className="fixed inset-0 z-40 bg-scrim" />
      <DialogContent className={`${dialogClass} w-[420px]`}>
        <form onSubmit={submit} className="grid gap-4 p-5">
          <DialogTitle className={titleClass}>Rename episode</DialogTitle>
          <label className="field">
            <span className="label">Name</span>
            <Input
              className="text-input"
              maxLength={maxNameLength}
              value={name}
              onValueChange={setName}
            />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={!name.trim()}
            >
              Save
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({
  confirmation,
  onClose,
}: {
  confirmation: Confirmation;
  onClose: () => void;
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogBackdrop className="fixed inset-0 z-40 bg-scrim" />
      <AlertDialogContent className={`${dialogClass} w-[420px] gap-3 p-5`}>
        <AlertDialogTitle className={titleClass}>
          {confirmation.title}
        </AlertDialogTitle>
        <AlertDialogDescription className="m-0 text-fg-muted">
          {confirmation.body}
        </AlertDialogDescription>
        <div className="flex justify-end gap-2">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button border-danger text-danger"
            onClick={() => {
              confirmation.run();
              onClose();
            }}
          >
            Delete
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MapRow({
  entry,
  canDuplicate,
  canMoveUp,
  canMoveDown,
  dragging,
  dropBefore,
  onOpen,
  onSettings,
  onDuplicate,
  onDelete,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  entry: ProjectMap;
  canDuplicate: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dragging: boolean;
  dropBefore: boolean;
  onOpen: () => void;
  onSettings: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (step: -1 | 1) => void;
  onDragStart: () => void;
  onDragOver: (after: boolean) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const status = useMemo(() => mapStatus(entry), [entry]);
  const name = mapName(entry);
  return (
    <tr
      draggable
      data-map={entry.id}
      className={`group h-24 border-b border-border hover:bg-surface-raised ${dragging ? "opacity-40" : ""} ${dropBefore ? "shadow-[inset_0_2px_0_var(--color-accent)]" : ""}`}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", entry.id);
        onDragStart();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        onDragOver(event.clientY > box.top + box.height / 2);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      onClick={(event) => {
        if (
          !entry.broken &&
          !(event.target as Element).closest("button, [role=menu]")
        ) {
          onOpen();
        }
      }}
    >
      <td className="w-6 text-fg-disabled group-hover:text-fg-muted">
        <GripVertical size={14} aria-hidden="true" className="cursor-grab" />
      </td>
      <td className="font-mono text-xs">{entry.slot}</td>
      <td className="max-[900px]:hidden">
        <MapPlan
          map={entry.map}
          className="h-[76px] w-[128px] rounded-[2px] border border-border-strong bg-canvas"
        />
      </td>
      <td className="max-w-0 pr-4 pl-6 max-[900px]:pl-0">
        <button
          type="button"
          disabled={entry.broken}
          className="block max-w-full truncate border-0 bg-transparent p-0 text-left text-[17px] font-semibold text-fg"
          onClick={onOpen}
        >
          {name}
        </button>
        <div className="truncate text-[13px] text-fg-muted">
          {entry.description}
        </div>
      </td>
      <td className="text-right font-mono text-[13px] max-[700px]:hidden">
        {entry.map.sectors.length}
      </td>
      <td className="text-right font-mono text-[13px] max-[700px]:hidden">
        {entry.map.things.length}
      </td>
      <td className="text-right font-mono text-[13px]">
        {formatPar(entry.par) || <span className="text-fg-muted">—</span>}
      </td>
      <td className="pl-4">
        <span className="flex items-center gap-2 text-[13px] whitespace-nowrap">
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${statusDots[status.kind]}`}
          />
          {status.label}
        </span>
      </td>
      <td className="text-[13px] whitespace-nowrap text-fg-muted max-[900px]:hidden">
        {formatEdited(entry.editedAt)}
      </td>
      <td>
        <Menu>
          <MenuTrigger
            className="icon-button"
            aria-label={`Actions for ${name}`}
          >
            <Ellipsis size={16} aria-hidden="true" />
          </MenuTrigger>
          <MenuContent className="select-content" align="end">
            <MenuItem
              className="select-item"
              disabled={entry.broken}
              onSelect={onOpen}
            >
              Open
            </MenuItem>
            <MenuItem
              className="select-item"
              disabled={entry.broken}
              onSelect={onSettings}
            >
              Map settings
            </MenuItem>
            <MenuItem
              className="select-item"
              disabled={entry.broken || !canDuplicate}
              onSelect={onDuplicate}
            >
              Duplicate
            </MenuItem>
            <MenuSeparator className="menu-separator" />
            <MenuItem
              className="select-item"
              disabled={!canMoveUp}
              onSelect={() => onMove(-1)}
            >
              Move up
            </MenuItem>
            <MenuItem
              className="select-item"
              disabled={!canMoveDown}
              onSelect={() => onMove(1)}
            >
              Move down
            </MenuItem>
            <MenuSeparator className="menu-separator" />
            <MenuItem
              className="select-item data-[highlighted]:bg-danger/15"
              destructive
              onSelect={onDelete}
            >
              Delete
            </MenuItem>
          </MenuContent>
        </Menu>
      </td>
    </tr>
  );
}

function ProjectHome({
  sidebar,
  project,
  maps,
  message,
  onRenameProject,
  onDeleteProject,
  onExportProject,
  onImportProject,
  onImportMap,
  onBuildEpisode,
  onPlayEpisode,
  onOpenMap,
  onCreateMap,
  onUpdateMap,
  onDuplicateMap,
  onDeleteMap,
  onReorderMaps,
}: {
  sidebar: SidebarProps;
  project: Project;
  maps: ProjectMap[];
  message: string | null;
  onRenameProject: (name: string) => void;
  onDeleteProject: () => void;
  onExportProject: () => void;
  onImportProject: (file: File) => void;
  onImportMap: (file: File) => void;
  onBuildEpisode: () => void;
  onPlayEpisode: () => void;
  onOpenMap: (entry: ProjectMap) => void;
  onCreateMap: (details: MapDetails) => Promise<string | null>;
  onUpdateMap: (
    entry: ProjectMap,
    details: MapDetails,
  ) => Promise<string | null>;
  onDuplicateMap: (entry: ProjectMap) => void;
  onDeleteMap: (entry: ProjectMap) => void;
  onReorderMaps: (order: string[]) => void;
}) {
  const [creatingMap, setCreatingMap] = useState(false);
  const [editing, setEditing] = useState<ProjectMap | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const mapFile = useRef<HTMLInputElement>(null);
  const projectFile = useRef<HTMLInputElement>(null);
  const { durable } = sidebar;
  const sorted = bySlot(maps);
  const nextSlot = freeSlots(maps)[0];
  const lastEdited = Math.max(...maps.map((entry) => entry.editedAt));
  const range =
    sorted.length > 1
      ? `${sorted[0].slot} to ${sorted.at(-1)!.slot}`
      : sorted[0]?.slot;

  const reorder = (id: string, index: number) => {
    const order = sorted.map((entry) => entry.id).filter((item) => item !== id);
    const from = sorted.findIndex((entry) => entry.id === id);
    order.splice(index > from ? index - 1 : index, 0, id);
    onReorderMaps(order);
  };

  const endDrag = () => {
    setDragged(null);
    setDropIndex(null);
  };

  return (
    <AppShell
      sidebar={sidebar}
      crumbs={<Crumb>{project.name}</Crumb>}
      actions={
        <>
          <button type="button" className="button" onClick={onExportProject}>
            <Download size={14} aria-hidden="true" />
            <span className="max-[1000px]:sr-only">Back up</span>
          </button>
          <button
            type="button"
            className="button"
            disabled={maps.length === 0}
            onClick={onBuildEpisode}
          >
            <Package size={14} aria-hidden="true" />
            <span className="max-[1000px]:sr-only">Build WAD</span>
          </button>
          <Menu>
            <MenuTrigger
              className="button px-2"
              aria-label="More episode actions"
            >
              <Ellipsis size={16} aria-hidden="true" />
            </MenuTrigger>
            <MenuContent className="select-content" align="end">
              <MenuItem
                className="select-item"
                onSelect={() => projectFile.current?.click()}
              >
                Import episode backup
              </MenuItem>
              <MenuSeparator className="menu-separator" />
              <MenuItem
                className="select-item data-[highlighted]:bg-danger/15"
                destructive
                disabled={sidebar.projects.length === 1}
                onSelect={() =>
                  setConfirmation({
                    title: `Delete ${project.name}?`,
                    body: `This removes the episode and its ${countLabel(maps.length)} from this browser.`,
                    run: onDeleteProject,
                  })
                }
              >
                Delete episode
              </MenuItem>
            </MenuContent>
          </Menu>
          <button
            type="button"
            className="button primary"
            disabled={maps.length === 0}
            onClick={onPlayEpisode}
          >
            <Play size={14} aria-hidden="true" />
            <span className="max-[600px]:sr-only">Play</span>
          </button>
        </>
      }
    >
      <main className="flex flex-col gap-5 px-8 pt-10 pb-6 max-[760px]:px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="m-0 truncate text-4xl leading-tight font-bold">
              {project.name}
            </h1>
            <button
              type="button"
              className="icon-button shrink-0"
              aria-label="Rename episode"
              title="Rename episode"
              onClick={() => setRenaming(true)}
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
          </div>
          <p className="m-0 mt-1 font-mono text-xs text-fg-muted">
            {[
              countLabel(maps.length),
              range,
              maps.length > 0
                ? `edited ${formatEdited(lastEdited).toLowerCase()}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {!durable ? (
          <p role="alert" className="notice m-0">
            Browser storage is unavailable, so episodes last only until this tab
            closes. Back up to keep your work.
          </p>
        ) : null}
        {message ? (
          <p role="status" className="notice m-0">
            {message}
          </p>
        ) : null}
        {sorted.length > 1 ? (
          <p className="m-0 flex items-center gap-2.5 rounded-[3px] border border-border bg-surface px-3 py-2.5 text-[13px] text-fg-soft">
            <Route size={15} aria-hidden="true" className="text-info" />
            Maps play in slot order, and an exit takes everyone to the next
            slot. Drag a row to change the order.
          </p>
        ) : null}
        {sorted.length > 0 ? (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="h-8 border-b border-border font-mono text-[11px] tracking-wide text-fg-muted [&>th]:font-normal">
                <th className="w-6">
                  <span className="sr-only">Order</span>
                </th>
                <th className="w-16">SLOT</th>
                <th className="w-36 max-[900px]:hidden">
                  <span className="sr-only">Preview</span>
                </th>
                <th className="pl-6 max-[900px]:pl-0">MAP</th>
                <th className="w-20 text-right max-[700px]:hidden">SECTORS</th>
                <th className="w-20 text-right max-[700px]:hidden">THINGS</th>
                <th className="w-16 text-right">PAR</th>
                <th className="w-32 pl-4">STATUS</th>
                <th className="w-24 max-[900px]:hidden">EDITED</th>
                <th className="w-10">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(event.relatedTarget as Node)
                ) {
                  setDropIndex(null);
                }
              }}
            >
              {sorted.map((entry, index) => (
                <MapRow
                  key={entry.id}
                  entry={entry}
                  canDuplicate={Boolean(nextSlot)}
                  canMoveUp={index > 0}
                  canMoveDown={index < sorted.length - 1}
                  dragging={dragged === entry.id}
                  dropBefore={
                    dragged !== null &&
                    dropIndex === index &&
                    dragged !== entry.id
                  }
                  onOpen={() => onOpenMap(entry)}
                  onSettings={() => setEditing(entry)}
                  onDuplicate={() => onDuplicateMap(entry)}
                  onDelete={() =>
                    setConfirmation({
                      title: `Delete ${mapName(entry)}?`,
                      body: `${entry.slot} is removed from this browser. Back up the episode first if you might need it.`,
                      run: () => onDeleteMap(entry),
                    })
                  }
                  onMove={(step) =>
                    reorder(entry.id, step < 0 ? index - 1 : index + 2)
                  }
                  onDragStart={() => setDragged(entry.id)}
                  onDragOver={(after) =>
                    setDropIndex(after ? index + 1 : index)
                  }
                  onDrop={() => {
                    if (dragged && dropIndex !== null) {
                      reorder(dragged, dropIndex);
                    }
                    endDrag();
                  }}
                  onDragEnd={endDrag}
                />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="m-0 text-fg-muted">This episode has no maps yet.</p>
        )}
        <div
          className={`flex flex-wrap items-center gap-x-2 gap-y-1 px-6 ${dragged !== null && dropIndex === sorted.length ? "shadow-[inset_0_2px_0_var(--color-accent)]" : ""}`}
        >
          {nextSlot ? (
            <>
              <button
                type="button"
                className="flex items-center gap-2 border-0 bg-transparent p-0 text-sm font-semibold text-accent hover:underline"
                onClick={() => setCreatingMap(true)}
              >
                <Plus size={14} aria-hidden="true" />
                Add a map in {nextSlot}
              </button>
              <button
                type="button"
                className="border-0 bg-transparent p-0 text-[13px] text-fg-muted hover:text-fg hover:underline"
                onClick={() => mapFile.current?.click()}
              >
                or import a map file
              </button>
            </>
          ) : (
            <p className="m-0 text-[13px] text-fg-muted">
              All 32 map slots are in use.
            </p>
          )}
        </div>
      </main>
      <input
        ref={mapFile}
        type="file"
        hidden
        accept=".json,application/json"
        aria-label="Import map file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImportMap(file);
          event.target.value = "";
        }}
      />
      <input
        ref={projectFile}
        type="file"
        hidden
        accept=".json,application/json"
        aria-label="Import episode backup"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImportProject(file);
          event.target.value = "";
        }}
      />
      {creatingMap ? (
        <MapDialog
          maps={maps}
          onClose={() => setCreatingMap(false)}
          onSubmit={onCreateMap}
        />
      ) : null}
      {editing ? (
        <MapDialog
          maps={maps}
          entry={editing}
          onClose={() => setEditing(null)}
          onSubmit={(details) => onUpdateMap(editing, details)}
        />
      ) : null}
      {renaming ? (
        <NameDialog
          initial={project.name}
          onClose={() => setRenaming(false)}
          onSubmit={(name) => {
            onRenameProject(name);
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

export { ProjectHome };
