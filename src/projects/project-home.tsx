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
  CircleCheck,
  CircleX,
  Ellipsis,
  FolderOpen,
  Hammer,
  Plus,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";

import { MapOutline } from "../editor/map-outline";
import { freedoomFlats, freedoomWalls } from "../map/freedoom-textures";
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

type Confirmation = { title: string; body: string; run: () => void };

const statusStyles = {
  ready: { icon: CircleCheck, className: "text-success" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  error: { icon: CircleX, className: "text-danger" },
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

function NameDialog({
  title,
  action,
  initial,
  onSubmit,
  onClose,
}: {
  title: string;
  action: string;
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
          <DialogTitle className={titleClass}>{title}</DialogTitle>
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
              {action}
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
  onOpen,
  onSettings,
  onDuplicate,
  onDelete,
}: {
  entry: ProjectMap;
  canDuplicate: boolean;
  onOpen: () => void;
  onSettings: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const status = useMemo(() => mapStatus(entry), [entry]);
  const { icon: StatusIcon, className } = statusStyles[status.kind];
  const name = mapName(entry);
  return (
    <tr
      className="h-[88px] border-b border-border hover:bg-surface-raised"
      onClick={(event) => {
        if (
          !entry.broken &&
          !(event.target as Element).closest("button, [role=menu]")
        ) {
          onOpen();
        }
      }}
    >
      <td className="font-mono text-xs text-fg-muted">{entry.slot}</td>
      <td className="max-[900px]:hidden">
        <MapOutline
          map={entry.map}
          className="h-[68px] w-[120px] bg-canvas"
          solidColor="var(--color-fg-muted)"
        />
      </td>
      <td className="max-w-0 pr-4">
        <button
          type="button"
          disabled={entry.broken}
          className="block max-w-full truncate border-0 bg-transparent p-0 text-left text-base font-semibold text-fg"
          onClick={onOpen}
        >
          {name}
        </button>
        <div className="truncate text-fg-muted">{entry.description}</div>
      </td>
      <td className="font-mono text-xs">{entry.map.sectors.length}</td>
      <td className="font-mono text-xs">{entry.map.things.length}</td>
      <td className="font-mono text-xs">{formatPar(entry.par) || "-"}</td>
      <td>
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <StatusIcon size={14} className={className} aria-hidden="true" />
          {status.label}
        </span>
      </td>
      <td className="whitespace-nowrap text-fg-muted max-[900px]:hidden">
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
  projects,
  project,
  maps,
  durable,
  message,
  onSelectProject,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onExportProject,
  onImportProject,
  onImportMap,
  onBuildEpisode,
  onOpenMap,
  onCreateMap,
  onUpdateMap,
  onDuplicateMap,
  onDeleteMap,
}: {
  projects: Project[];
  project: Project;
  maps: ProjectMap[];
  durable: boolean;
  message: string | null;
  onSelectProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onRenameProject: (name: string) => void;
  onDeleteProject: () => void;
  onExportProject: () => void;
  onImportProject: (file: File) => void;
  onImportMap: (file: File) => void;
  onBuildEpisode: () => void;
  onOpenMap: (entry: ProjectMap) => void;
  onCreateMap: (details: MapDetails) => Promise<string | null>;
  onUpdateMap: (
    entry: ProjectMap,
    details: MapDetails,
  ) => Promise<string | null>;
  onDuplicateMap: (entry: ProjectMap) => void;
  onDeleteMap: (entry: ProjectMap) => void;
}) {
  const [creatingMap, setCreatingMap] = useState(false);
  const [editing, setEditing] = useState<ProjectMap | null>(null);
  const [naming, setNaming] = useState<"new" | "rename" | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const mapFile = useRef<HTMLInputElement>(null);
  const projectFile = useRef<HTMLInputElement>(null);
  const sorted = bySlot(maps);
  const full = freeSlots(maps).length === 0;
  const textureCount = freedoomFlats.length + freedoomWalls.length;
  return (
    <div className="grid h-dvh grid-rows-[48px_minmax(0,1fr)] bg-canvas text-fg">
      <header className="flex items-center border-b border-border bg-surface pr-3 pl-4">
        <h1 className="m-0 text-[17px] font-bold tracking-[0.02em] text-accent">
          WADSMITH
        </h1>
      </header>
      <div className="grid min-h-0 grid-cols-[240px_minmax(0,1fr)] max-[760px]:grid-cols-1">
        <nav
          aria-label="Projects"
          className="flex min-h-0 flex-col justify-between gap-5 overflow-y-auto border-r border-border bg-surface px-3 py-5 max-[760px]:hidden"
        >
          <div className="grid gap-5">
            <div className="grid gap-0.5">
              <div className="mb-1.5 flex items-center justify-between font-mono text-[11px] text-fg-muted">
                PROJECTS
                <button
                  type="button"
                  className="border-0 bg-transparent p-0 text-fg-muted hover:text-fg"
                  aria-label="New project"
                  title="New project"
                  onClick={() => setNaming("new")}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
              </div>
              {projects.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={item.id === project.id ? "page" : undefined}
                  className="flex h-8 items-center gap-2 rounded-[3px] border-0 bg-transparent px-2 text-left text-fg-muted hover:text-fg aria-[current=page]:bg-surface-raised aria-[current=page]:text-fg"
                  onClick={() => onSelectProject(item.id)}
                >
                  <FolderOpen size={14} aria-hidden="true" />
                  <span className="truncate">{item.name}</span>
                </button>
              ))}
            </div>
            <div className="grid gap-0.5">
              <div className="mb-1.5 truncate font-mono text-[11px] text-fg-muted uppercase">
                {project.name}
              </div>
              <button
                type="button"
                className="flex h-8 items-center rounded-[3px] border-0 bg-transparent px-2 text-left text-fg-muted hover:text-fg"
                onClick={() => setNaming("rename")}
              >
                Rename project
              </button>
              <button
                type="button"
                className="flex h-8 items-center rounded-[3px] border-0 bg-transparent px-2 text-left text-fg-muted hover:text-fg"
                onClick={onExportProject}
              >
                Export backup
              </button>
              <button
                type="button"
                className="flex h-8 items-center rounded-[3px] border-0 bg-transparent px-2 text-left text-fg-muted hover:text-fg"
                onClick={() => projectFile.current?.click()}
              >
                Import backup
              </button>
              <button
                type="button"
                disabled={projects.length === 1}
                className="flex h-8 items-center rounded-[3px] border-0 bg-transparent px-2 text-left text-fg-muted hover:text-danger disabled:opacity-50"
                onClick={() =>
                  setConfirmation({
                    title: `Delete ${project.name}?`,
                    body: `This removes the project and its ${maps.length} ${maps.length === 1 ? "map" : "maps"} from this browser.`,
                    run: onDeleteProject,
                  })
                }
              >
                Delete project
              </button>
            </div>
          </div>
          <div className="grid gap-0.5 p-2">
            <div className="font-mono text-[11px] text-fg-muted">
              BASE GAME DATA
            </div>
            <div className="font-mono text-xs">freedoom2.wad</div>
            <div className="font-mono text-[11px] text-fg-muted">
              Linked, {textureCount} textures
            </div>
          </div>
        </nav>
        <main className="flex min-h-0 flex-col gap-6 overflow-y-auto px-8 pt-8 pb-6 max-[760px]:px-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="m-0 truncate text-4xl font-bold">
                {project.name}
              </h2>
              <p className="m-0 mt-1 text-[15px] text-fg-muted">
                {maps.length} {maps.length === 1 ? "map" : "maps"} · Classic
                Doom · {durable ? "Saved in this browser" : "This session only"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="button"
                disabled={full}
                onClick={() => mapFile.current?.click()}
              >
                <Upload size={14} aria-hidden="true" />
                Import map
              </button>
              <button
                type="button"
                className="button"
                disabled={maps.length === 0}
                onClick={onBuildEpisode}
              >
                <Hammer size={14} aria-hidden="true" />
                Build episode
              </button>
              <button
                type="button"
                className="button primary"
                disabled={full}
                onClick={() => setCreatingMap(true)}
              >
                <Plus size={14} aria-hidden="true" />
                New map
              </button>
            </div>
          </div>
          {!durable ? (
            <p role="alert" className="notice m-0">
              Browser storage is unavailable, so projects last only until this
              tab closes. Use Export backup to keep your work.
            </p>
          ) : null}
          {message ? (
            <p role="status" className="notice m-0">
              {message}
            </p>
          ) : null}
          {sorted.length > 0 ? (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="h-8 border-b border-border font-mono text-[11px] text-fg-muted [&>th]:font-normal">
                  <th className="w-16">SLOT</th>
                  <th className="w-36 max-[900px]:hidden">
                    <span className="sr-only">Preview</span>
                  </th>
                  <th>MAP</th>
                  <th className="w-[72px]">SECTORS</th>
                  <th className="w-[72px]">THINGS</th>
                  <th className="w-16">PAR</th>
                  <th className="w-28">STATUS</th>
                  <th className="w-24 max-[900px]:hidden">EDITED</th>
                  <th className="w-10">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((entry) => (
                  <MapRow
                    key={entry.id}
                    entry={entry}
                    canDuplicate={!full}
                    onOpen={() => onOpenMap(entry)}
                    onSettings={() => setEditing(entry)}
                    onDuplicate={() => onDuplicateMap(entry)}
                    onDelete={() =>
                      setConfirmation({
                        title: `Delete ${mapName(entry)}?`,
                        body: `${entry.slot} is removed from this browser. Export a backup first if you might need it.`,
                        run: () => onDeleteMap(entry),
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted m-0">This project has no maps yet.</p>
          )}
        </main>
      </div>
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
        aria-label="Import project backup"
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
      {naming ? (
        <NameDialog
          title={naming === "new" ? "New project" : "Rename project"}
          action={naming === "new" ? "Create project" : "Save"}
          initial={naming === "new" ? "" : project.name}
          onClose={() => setNaming(null)}
          onSubmit={(name) => {
            if (naming === "new") onCreateProject(name);
            else onRenameProject(name);
            setNaming(null);
          }}
        />
      ) : null}
      {confirmation ? (
        <ConfirmDialog
          confirmation={confirmation}
          onClose={() => setConfirmation(null)}
        />
      ) : null}
    </div>
  );
}

export { ProjectHome };
