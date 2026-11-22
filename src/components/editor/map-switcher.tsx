import { ChevronDown, LayoutList, Plus } from "lucide-react";

import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";

export type MapHealth = "ready" | "warning" | "error" | "checking";

export interface EpisodeEntry {
  id: string;
  slot: string;
  name: string;
  health: MapHealth;
}

const healthDots: Record<MapHealth, string> = {
  ready: "bg-success",
  warning: "bg-warning",
  error: "bg-destructive",
  checking: "bg-muted-foreground",
};

const healthLabels: Record<MapHealth, string> = {
  ready: "playable",
  warning: "has warnings",
  error: "has errors",
  checking: "being checked",
};

interface MapSwitcherProps {
  episodeName: string;
  maps: EpisodeEntry[];
  currentId: string;
  canAddMap: boolean;
  onOpenMap: (id: string) => void;
  onAddMap: () => void;
  onEpisodeHome: () => void;
}

export function MapSwitcher({
  episodeName,
  maps,
  currentId,
  canAddMap,
  onOpenMap,
  onAddMap,
  onEpisodeHome,
}: MapSwitcherProps) {
  const current = maps.find((entry) => entry.id === currentId);
  return (
    <nav aria-label="Breadcrumb" className="map-title min-w-0 gap-2">
      <button
        type="button"
        className="min-w-0 truncate border-0 bg-transparent p-0 text-sm text-muted-foreground hover:text-foreground max-lg:hidden"
        onClick={onEpisodeHome}
      >
        {episodeName}
      </button>
      <span
        aria-hidden="true"
        className="text-muted-foreground/60 max-lg:hidden"
      >
        /
      </span>
      <Menu
        onAction={(action) => {
          const value = action;
          if (value === "add") onAddMap();
          else if (value === "home") onEpisodeHome();
          else if (value !== currentId) onOpenMap(value);
        }}
      >
        <MenuTrigger
          className="flex min-w-[120px] items-center gap-2 rounded-[3px] border-0 bg-transparent px-2 py-1 text-foreground hover:bg-muted aria-expanded:bg-muted"
          aria-label={`Switch map, now ${current?.slot ?? ""} ${current?.name ?? ""}`}
        >
          <span className="flex-none font-mono text-xs text-muted-foreground">
            {current?.slot}
          </span>
          <strong className="max-w-[240px] min-w-0 truncate text-base font-semibold">
            {current?.name}
          </strong>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className="shrink-0 text-muted-foreground"
          />
        </MenuTrigger>
        <MenuContent className="min-w-[300px]" align="center">
          <MenuGroup>
            <MenuGroupLabel className="px-2 pt-1 pb-1.5 font-mono text-xs tracking-wide text-muted-foreground uppercase">
              {episodeName} · {maps.length} {maps.length === 1 ? "map" : "maps"}
            </MenuGroupLabel>
            {maps.map((entry) => (
              <MenuItem
                key={entry.id}
                value={entry.id}
                aria-current={entry.id === currentId ? "page" : undefined}
                aria-label={`${entry.slot} ${entry.name}, ${healthLabels[entry.health]}`}
                className="gap-3 aria-[current=page]:bg-accent aria-[current=page]:font-semibold"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {entry.slot}
                </span>
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span
                  aria-hidden="true"
                  className={`size-1.5 shrink-0 rounded-full ${healthDots[entry.health]}`}
                />
              </MenuItem>
            ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuItem value="add" className="gap-3" disabled={!canAddMap}>
            <Plus
              size={14}
              aria-hidden="true"
              className="text-muted-foreground"
            />
            Add a map
          </MenuItem>
          <MenuItem value="home" className="gap-3">
            <LayoutList
              size={14}
              aria-hidden="true"
              className="text-muted-foreground"
            />
            Episode home
          </MenuItem>
        </MenuContent>
      </Menu>
    </nav>
  );
}
