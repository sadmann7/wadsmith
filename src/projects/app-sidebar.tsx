import Link from "next/link";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@ui-sdk/react/drawer";
import { Input } from "@ui-sdk/react/input";
import { PanelLeft, Plus, Star, X } from "lucide-react";
import {
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { MapOutline } from "../editor/map-outline";
import { MapPlan } from "../editor/map-plan";
import { featuredMaps } from "../map/featured";
import { blankMap } from "../map/starter-map";
import { dialogClass, titleClass } from "./map-dialog";
import { maxNameLength, type EpisodeStart, type Project } from "./project-data";
import { pathOf, type Route } from "./routes";

const starts: { value: EpisodeStart; label: string; detail: string }[] = [
  { value: "empty", label: "Empty", detail: "No maps yet" },
  { value: "one", label: "One map", detail: "A starter room in MAP01" },
  {
    value: "featured",
    label: "Featured maps",
    detail: `All ${featuredMaps.length}, in MAP01 to MAP${String(featuredMaps.length).padStart(2, "0")}`,
  },
];

function StartPreview({ start }: { start: EpisodeStart }) {
  if (start === "empty") {
    return (
      <div className="grid h-[92px] place-items-center bg-canvas text-fg-muted">
        <Plus size={18} aria-hidden="true" />
      </div>
    );
  }
  if (start === "one") {
    return (
      <MapOutline
        map={blankMap}
        className="h-[92px] w-full bg-canvas p-5"
        solidColor="var(--color-fg-muted)"
      />
    );
  }
  return (
    <div className="grid h-[92px] grid-cols-3 gap-1 bg-canvas p-2">
      {featuredMaps.map((item) => (
        <MapPlan key={item.id} map={item.map} className="size-full" />
      ))}
    </div>
  );
}

function NewEpisodeDialog({
  durable,
  onSubmit,
  onClose,
}: {
  durable: boolean;
  onSubmit: (name: string, start: EpisodeStart) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [start, setStart] = useState<EpisodeStart>("one");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) onSubmit(name.trim(), start);
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
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
            <DialogTitle className={titleClass}>New episode</DialogTitle>
            <DialogClose
              aria-label="Close"
              className="border-0 bg-transparent p-1 text-fg-muted hover:text-fg"
            >
              <X size={16} aria-hidden="true" />
            </DialogClose>
          </header>
          <div className="grid min-h-0 gap-5 overflow-y-auto p-5">
            <label className="field">
              <span className="label">Name</span>
              <Input
                className="text-input"
                maxLength={maxNameLength}
                value={name}
                onValueChange={setName}
              />
            </label>
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="label mb-2 p-0">Start with</legend>
              <div className="grid grid-cols-3 gap-2.5 max-[560px]:grid-cols-1">
                {starts.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={start === item.value}
                    className="grid gap-2 rounded-[3px] border border-border-strong bg-transparent p-2 text-left text-fg-soft aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-fg"
                    onClick={() => setStart(item.value)}
                  >
                    <StartPreview start={item.value} />
                    <span className="grid gap-0.5 px-1 pb-1">
                      <span className="text-sm font-semibold">
                        {item.label}
                      </span>
                      <span className="text-xs text-fg-muted">
                        {item.detail}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
          <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
            <p className="m-0 mr-auto text-[13px] text-fg-muted">
              {durable
                ? "Saved in this browser."
                : "Kept until this tab closes."}
            </p>
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={!name.trim()}
            >
              Create episode
            </button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type SidebarProps = {
  projects: Project[];
  counts: Record<string, number>;
  current: Route | null;
  durable: boolean;
  onNavigate?: (route: Route) => void;
  onCreateProject?: (name: string, start: EpisodeStart) => void;
};

const rowClass =
  "relative flex items-center gap-2.5 rounded-[3px] px-2 py-1.5 text-[14px] text-fg-soft no-underline hover:bg-surface-raised hover:text-fg aria-[current=page]:bg-surface-raised aria-[current=page]:font-semibold aria-[current=page]:text-fg";

function SidebarLink({
  route,
  current,
  onNavigate,
  children,
}: {
  route: Route;
  current: boolean;
  onNavigate?: (route: Route) => void;
  children: ReactNode;
}) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onNavigate || event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    onNavigate(route);
  };
  return (
    <a
      href={pathOf(route)}
      aria-current={current ? "page" : undefined}
      className={rowClass}
      onClick={follow}
    >
      {children}
    </a>
  );
}

function AppSidebar({
  projects,
  counts,
  current,
  durable,
  onNavigate,
  onCreateProject,
}: SidebarProps) {
  const [creating, setCreating] = useState(false);
  const currentEpisode =
    current?.kind === "episode" || current?.kind === "map" ? current.id : null;
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-[48px] shrink-0 items-center px-[18px]">
        <SidebarLink
          route={{ kind: "home" }}
          current={false}
          onNavigate={onNavigate}
        >
          <span className="text-[17px] font-bold tracking-[0.12em] text-accent">
            WADSMITH
          </span>
        </SidebarLink>
      </div>
      <nav
        aria-label="Main"
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2.5 pt-1"
      >
        <SidebarLink
          route={{ kind: "featured" }}
          current={current?.kind === "featured"}
          onNavigate={onNavigate}
        >
          <Star size={15} aria-hidden="true" className="shrink-0" />
          Featured maps
        </SidebarLink>
        <div className="grid gap-0.5">
          <div className="mb-1 flex h-6 items-center justify-between pr-1 pl-2 font-mono text-[11px] tracking-[0.08em] text-fg-muted">
            EPISODES
            {onCreateProject ? (
              <button
                type="button"
                className="grid size-6 place-items-center rounded-[3px] border-0 bg-transparent p-0 text-fg-muted hover:bg-surface-raised hover:text-fg"
                aria-label="New episode"
                title="New episode"
                onClick={() => setCreating(true)}
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {projects.map((item) => {
            const active = item.id === currentEpisode;
            return (
              <SidebarLink
                key={item.id}
                route={{ kind: "episode", id: item.id }}
                current={active}
                onNavigate={onNavigate}
              >
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-accent"
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate pl-1.5">
                  {item.name}
                </span>
                <span className="font-mono text-[11px] font-normal text-fg-muted">
                  {counts[item.id] ?? 0}
                  <span className="sr-only"> maps</span>
                </span>
              </SidebarLink>
            );
          })}
        </div>
      </nav>
      <div className="mx-2.5 grid shrink-0 gap-1 border-t border-border px-2 pt-3 pb-4">
        <div className="flex items-center gap-2 text-[13px] text-fg-soft">
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${durable ? "bg-success" : "bg-warning"}`}
          />
          {durable ? "Saved in this browser" : "Kept until this tab closes"}
        </div>
        <p className="m-0 text-xs text-fg-muted">
          Back up an episode to keep it safe or move it to another computer.
        </p>
        <Link
          href="/source"
          aria-current={current === null ? "page" : undefined}
          className="mt-1 justify-self-start text-xs text-fg-muted underline underline-offset-4 hover:text-fg aria-[current=page]:text-fg"
        >
          Source and licences
        </Link>
      </div>
      {creating && onCreateProject ? (
        <NewEpisodeDialog
          durable={durable}
          onClose={() => setCreating(false)}
          onSubmit={(name, start) => {
            onCreateProject(name, start);
            setCreating(false);
          }}
        />
      ) : null}
    </div>
  );
}

function SidebarDrawer({
  className = "",
  ...props
}: SidebarProps & { className?: string }) {
  const [open, setOpen] = useState(false);
  const navigate = props.onNavigate
    ? (route: Route) => {
        setOpen(false);
        props.onNavigate?.(route);
      }
    : undefined;
  return (
    <Drawer side="left" preventEdgeSwipe open={open} onOpenChange={setOpen}>
      <DrawerTrigger
        className={`icon-button shrink-0 ${className}`}
        aria-label="Show sidebar"
        title="Show sidebar"
      >
        <PanelLeft size={16} aria-hidden="true" />
      </DrawerTrigger>
      <DrawerBackdrop className="fixed inset-0 size-full bg-scrim" />
      <DrawerContent className="h-full w-[248px] border-r border-border-strong text-fg">
        <DrawerTitle className="sr-only">Wadsmith</DrawerTitle>
        <AppSidebar {...props} onNavigate={navigate} />
      </DrawerContent>
    </Drawer>
  );
}

function AppShell({
  sidebar,
  crumbs,
  actions,
  children,
}: {
  sidebar: SidebarProps;
  crumbs: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid h-dvh grid-cols-[248px_minmax(0,1fr)] bg-canvas text-fg max-[760px]:grid-cols-1">
      <aside className="min-h-0 border-r border-border max-[760px]:hidden">
        <AppSidebar {...sidebar} />
      </aside>
      <div className="grid min-h-0 grid-rows-[48px_minmax(0,1fr)]">
        <header className="flex min-w-0 items-center gap-3 border-b border-border px-8 max-[760px]:px-3">
          <SidebarDrawer {...sidebar} className="min-[761px]:hidden" />
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-fg-muted"
          >
            {crumbs}
          </nav>
          {actions ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </header>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Crumb({ children }: { children: ReactNode }) {
  return <span className="truncate text-fg">{children}</span>;
}

export { AppShell, AppSidebar, Crumb, SidebarDrawer, type SidebarProps };
