import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@ui-sdk/react/menu";
import { ChevronDown, LayoutList, Plus } from "lucide-react";

type MapHealth = "ready" | "warning" | "error";

type EpisodeEntry = {
  id: string;
  slot: string;
  name: string;
  health: MapHealth;
};

const healthDots: Record<MapHealth, string> = {
  ready: "bg-success",
  warning: "bg-warning",
  error: "bg-danger",
};

const healthLabels: Record<MapHealth, string> = {
  ready: "playable",
  warning: "has warnings",
  error: "has errors",
};

function MapSwitcher({
  episodeName,
  maps,
  currentId,
  canAddMap,
  onOpenMap,
  onAddMap,
  onEpisodeHome,
}: {
  episodeName: string;
  maps: EpisodeEntry[];
  currentId: string;
  canAddMap: boolean;
  onOpenMap: (id: string) => void;
  onAddMap: () => void;
  onEpisodeHome: () => void;
}) {
  const current = maps.find((entry) => entry.id === currentId);
  return (
    <nav aria-label="Breadcrumb" className="map-title min-w-0 gap-2">
      <button
        type="button"
        className="min-w-0 truncate border-0 bg-transparent p-0 text-[13px] text-fg-muted hover:text-fg max-lg:hidden"
        onClick={onEpisodeHome}
      >
        {episodeName}
      </button>
      <span aria-hidden="true" className="text-fg-disabled max-lg:hidden">
        /
      </span>
      <Menu
        onAction={(action) => {
          const value = action as string;
          if (value === "add") onAddMap();
          else if (value === "home") onEpisodeHome();
          else if (value !== currentId) onOpenMap(value);
        }}
      >
        <MenuTrigger
          className="flex min-w-[120px] items-center gap-2 rounded-[3px] border-0 bg-transparent px-2 py-1 text-fg hover:bg-surface-raised aria-expanded:bg-surface-raised"
          aria-label={`Switch map, now ${current?.slot ?? ""} ${current?.name ?? ""}`}
        >
          <span className="flex-none font-mono text-xs text-fg-muted">
            {current?.slot}
          </span>
          <strong className="max-w-[240px] min-w-0 truncate text-[15px] font-semibold">
            {current?.name}
          </strong>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className="shrink-0 text-fg-muted"
          />
        </MenuTrigger>
        <MenuContent className="select-content min-w-[300px]" align="center">
          <MenuGroup>
            <MenuGroupLabel className="px-2 pt-1 pb-1.5 font-mono text-[11px] tracking-wide text-fg-muted uppercase">
              {episodeName} · {maps.length} {maps.length === 1 ? "map" : "maps"}
            </MenuGroupLabel>
            {maps.map((entry) => (
              <MenuItem
                key={entry.id}
                value={entry.id}
                aria-current={entry.id === currentId ? "page" : undefined}
                aria-label={`${entry.slot} ${entry.name}, ${healthLabels[entry.health]}`}
                className="select-item gap-3 aria-[current=page]:bg-surface-hover aria-[current=page]:font-semibold"
              >
                <span className="font-mono text-xs text-fg-muted">
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
          <MenuSeparator className="menu-separator" />
          <MenuItem
            value="add"
            className="select-item gap-3"
            disabled={!canAddMap}
          >
            <Plus size={14} aria-hidden="true" className="text-fg-muted" />
            Add a map
          </MenuItem>
          <MenuItem value="home" className="select-item gap-3">
            <LayoutList
              size={14}
              aria-hidden="true"
              className="text-fg-muted"
            />
            Episode home
          </MenuItem>
        </MenuContent>
      </Menu>
    </nav>
  );
}

export { MapSwitcher, type EpisodeEntry, type MapHealth };
