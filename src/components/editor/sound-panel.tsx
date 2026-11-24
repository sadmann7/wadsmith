import { Volume2, X } from "lucide-react";

import type { SoundReach } from "@/lib/map/sound";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

interface SoundPanelProps {
  reach: SoundReach;
  source: string;
  doorsOpen: boolean;
  floorsMoved: boolean;
  onDoorsOpenChange: (open: boolean) => void;
  onFloorsMovedChange: (moved: boolean) => void;
  onClose: () => void;
}

export function SoundPanel({
  reach,
  source,
  doorsOpen,
  floorsMoved,
  onDoorsOpenChange,
  onFloorsMovedChange,
  onClose,
}: SoundPanelProps) {
  const hearing = [...reach.rooms.values()];
  const muffled = hearing.filter((kind) => kind === "muffled").length;
  return (
    <section
      aria-labelledby="sound-title"
      data-agent-hidden
      className="absolute top-3 left-3 z-4 grid w-[min(280px,calc(100%-24px))] gap-2.5 rounded-[3px] border border-border bg-card p-3 text-sm shadow-lg"
    >
      <div className="flex items-center gap-2">
        <Volume2 size={14} className="text-primary" aria-hidden="true" />
        <h2 id="sound-title" className="min-w-0 flex-1 truncate font-semibold">
          Sound from {source}
        </h2>
        <Button size="icon" aria-label="Hide sound" onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </Button>
      </div>
      <p className="text-muted-foreground">
        {plural(hearing.length, "room hears", "rooms hear")} a shot
        {muffled > 0 ? `, ${muffled} only past a sound blocker` : ""}. It wakes{" "}
        {plural(reach.woken.length, "monster", "monsters")}
        {reach.deaf.length > 0
          ? `, and ${plural(reach.deaf.length, "deaf one needs", "deaf ones need")} to see you`
          : ""}
        .
      </p>
      <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="sound-swatch" data-sound="heard" />
          Hears
        </li>
        <li className="flex items-center gap-1.5">
          <span className="sound-swatch" data-sound="muffled" />
          Past a blocker
        </li>
        <li className="flex items-center gap-1.5">
          <span className="sound-swatch" data-sound="silent" />
          Silent
        </li>
      </ul>
      <label className="flex items-center justify-between gap-3">
        <span>Doors open</span>
        <Switch checked={doorsOpen} onCheckedChange={onDoorsOpenChange} />
      </label>
      <label className="flex items-center justify-between gap-3">
        <span>Lifts and floors moved</span>
        <Switch checked={floorsMoved} onCheckedChange={onFloorsMovedChange} />
      </label>
      <p className="text-xs text-muted-foreground">
        Select a room to hear a shot from there instead.
      </p>
    </section>
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}
