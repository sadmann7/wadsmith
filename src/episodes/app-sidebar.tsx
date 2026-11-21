import Link from "next/link";
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@ui-sdk/react/drawer";
import { PanelLeft, Plus, Star } from "lucide-react";
import * as React from "react";

import { MapOutline } from "../components/map-outline";
import { MapPlan } from "../components/map-plan";
import { featuredMaps } from "../map/featured";
import { blankMap } from "../map/starter-map";
import { maxNameLength, type EpisodeStart, type Episode } from "./episode-data";
import { pathOf, type Route } from "./routes";
import { Button, buttonVariants } from "../components/ui/button";
import { Field, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";

const starts: { value: EpisodeStart; label: string; detail: string }[] = [
  { value: "empty", label: "Empty", detail: "No maps yet" },
  { value: "one", label: "One map", detail: "A starter room in MAP01" },
  {
    value: "featured",
    label: "Featured maps",
    detail: `All ${featuredMaps.length}, in MAP01 to MAP${String(featuredMaps.length).padStart(2, "0")}`,
  },
  {
    value: "freedoom",
    label: "Freedoom",
    detail: "All 32 levels of Freedoom: Phase 2",
  },
];

function StartPreview({ start }: { start: EpisodeStart }) {
  if (start === "empty") {
    return (
      <div className="grid h-[92px] place-items-center bg-background text-muted-foreground">
        <Plus size={18} aria-hidden="true" />
      </div>
    );
  }
  if (start === "one") {
    return (
      <MapOutline
        map={blankMap}
        className="h-[92px] w-full bg-background p-5"
        solidColor="var(--color-muted-foreground)"
      />
    );
  }
  if (start === "freedoom") {
    return (
      <div className="grid h-[92px] grid-cols-8 content-center gap-1 bg-background p-3">
        {Array.from({ length: 32 }, (_, index) => (
          <span key={index} className="h-3 rounded-[1px] bg-input" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid h-[92px] grid-cols-3 gap-1 bg-background p-2">
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
  const [name, setName] = React.useState("");
  const [start, setStart] = React.useState<EpisodeStart>("one");
  const submit = (event: React.FormEvent) => {
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
      <DialogBackdrop />
      <DialogContent className="w-[600px]">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>New episode</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <div className="grid min-h-0 gap-5 overflow-y-auto p-5">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input
                maxLength={maxNameLength}
                value={name}
                onValueChange={setName}
              />
            </Field>
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-2 p-0 text-sm text-muted-foreground">
                Start with
              </legend>
              <div className="grid grid-cols-2 gap-2.5">
                {starts.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={start === item.value}
                    className="grid gap-2 rounded-[3px] border border-input bg-transparent p-2 text-left text-foreground aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-foreground"
                    onClick={() => {
                      setStart(item.value);
                      if (item.value === "freedoom" && !name.trim()) {
                        setName("Freedoom");
                      }
                    }}
                  >
                    <StartPreview start={item.value} />
                    <span className="grid gap-0.5 px-1 pb-1">
                      <span className="text-sm font-semibold">
                        {item.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {item.detail}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
          <DialogFooter className="justify-end">
            <p className="m-0 mr-auto text-sm text-muted-foreground">
              {durable
                ? "Saved in this browser."
                : "Kept until this tab closes."}
            </p>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              type="submit"

              disabled={!name.trim()}
            >
              Create episode
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type SidebarProps = {
  episodes: Episode[];
  counts: Record<string, number>;
  current: Route | null;
  durable: boolean;
  onNavigate?: (route: Route) => void;
  onCreateEpisode?: (name: string, start: EpisodeStart) => void;
};

const rowClass =
  "relative flex items-center gap-2.5 rounded-[3px] px-2 py-1.5 text-sm text-foreground no-underline hover:bg-muted hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:font-semibold aria-[current=page]:text-foreground";

function SidebarLink({
  route,
  current,
  onNavigate,
  children,
}: {
  route: Route;
  current: boolean;
  onNavigate?: (route: Route) => void;
  children: React.ReactNode;
}) {
  const follow = (event: React.MouseEvent<HTMLAnchorElement>) => {
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
  episodes,
  counts,
  current,
  durable,
  onNavigate,
  onCreateEpisode,
}: SidebarProps) {
  const [creating, setCreating] = React.useState(false);
  const currentEpisode =
    current?.kind === "episode" || current?.kind === "map" ? current.id : null;
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex h-[48px] shrink-0 items-center px-[18px]">
        <SidebarLink
          route={{ kind: "home" }}
          current={false}
          onNavigate={onNavigate}
        >
          <span className="text-[17px] font-bold tracking-[0.12em] text-primary">
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
          <div className="mb-1 flex h-6 items-center justify-between pr-1 pl-2 font-mono text-xs tracking-[0.08em] text-muted-foreground">
            EPISODES
            {onCreateEpisode ? (
              <button
                type="button"
                className="grid size-[24px] place-items-center rounded-[3px] border-0 bg-transparent p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="New episode"
                title="New episode"
                onClick={() => setCreating(true)}
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {episodes.map((item) => {
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
                    className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-primary"
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate pl-1.5">
                  {item.name}
                </span>
                <span className="font-mono text-xs font-normal text-muted-foreground">
                  {counts[item.id] ?? 0}
                  <span className="sr-only"> maps</span>
                </span>
              </SidebarLink>
            );
          })}
        </div>
      </nav>
      <div className="mx-2.5 grid shrink-0 gap-1 border-t border-border px-2 pt-3 pb-4">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${durable ? "bg-success" : "bg-warning"}`}
          />
          {durable ? "Saved in this browser" : "Kept until this tab closes"}
        </div>
        <p className="m-0 text-sm text-muted-foreground">
          Back up an episode to keep it safe or move it to another computer.
        </p>
        <Link
          href="/source"
          aria-current={current === null ? "page" : undefined}
          className="mt-1 justify-self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground aria-[current=page]:text-foreground"
        >
          Source and licences
        </Link>
      </div>
      {creating && onCreateEpisode ? (
        <NewEpisodeDialog
          durable={durable}
          onClose={() => setCreating(false)}
          onSubmit={(name, start) => {
            onCreateEpisode(name, start);
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
  const [open, setOpen] = React.useState(false);
  const navigate = props.onNavigate
    ? (route: Route) => {
        setOpen(false);
        props.onNavigate?.(route);
      }
    : undefined;
  return (
    <Drawer side="left" preventEdgeSwipe open={open} onOpenChange={setOpen}>
      <DrawerTrigger
        className={buttonVariants({
          variant: "ghost",
          size: "icon",
          className: `shrink-0 ${className}`,
        })}
        aria-label="Show sidebar"
        title="Show sidebar"
      >
        <PanelLeft size={16} aria-hidden="true" />
      </DrawerTrigger>
      <DrawerBackdrop className="fixed inset-0 size-full bg-scrim" />
      <DrawerContent className="h-full w-[248px] border-r border-input text-foreground">
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
  crumbs?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  // A page without crumbs or actions keeps the bar only for the phone drawer.
  const bare = !crumbs && !actions;
  return (
    <div className="grid h-dvh grid-cols-[248px_minmax(0,1fr)] bg-background text-foreground max-[760px]:grid-cols-1">
      <aside className="min-h-0 border-r border-border max-[760px]:hidden">
        <AppSidebar {...sidebar} />
      </aside>
      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <header
          className={`flex h-[48px] min-w-0 items-center gap-3 border-b border-border px-8 max-[760px]:px-3 ${bare ? "min-[760px]:hidden" : ""}`}
        >
          <SidebarDrawer {...sidebar} className="min-[760px]:hidden" />
          {crumbs ? (
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground"
            >
              {crumbs}
            </nav>
          ) : (
            <div className="flex-1">
              <SidebarLink
                route={{ kind: "home" }}
                current={false}
                onNavigate={sidebar.onNavigate}
              >
                <span className="text-base font-bold tracking-[0.12em] text-primary">
                  WADSMITH
                </span>
              </SidebarLink>
            </div>
          )}
          {actions ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </header>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Crumb({ children }: { children: React.ReactNode }) {
  return <span className="truncate text-foreground">{children}</span>;
}

export { AppShell, AppSidebar, Crumb, SidebarDrawer, type SidebarProps };
