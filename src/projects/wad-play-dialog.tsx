import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { Play, X } from "lucide-react";
import { useState } from "react";

import { skillNames } from "../engine/coop";
import { Choice } from "../engine/coop-ui";
import type { Complevel, GameFiles, Skill } from "../engine/runtime";
import type { WadSummary } from "../wad/inspect";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectCheck,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { FieldItem, Label } from "../components/ui/field";

const complevelNames: Record<Complevel, string> = {
  vanilla: "Vanilla",
  boom: "Boom",
  mbf: "MBF",
  mbf21: "MBF21",
};

const complevelHelp: Record<Complevel, string> = {
  vanilla: "Plays like doom2.exe, with its limits and bugs.",
  boom: "Adds Boom's line actions, scrollers, friction and deep water.",
  mbf: "Adds MBF's helper dogs, sky transfers and code pointers.",
  mbf21: "Adds MBF21's line flags and DEHACKED extensions.",
};

const slotOf = (map: number) => `MAP${String(map).padStart(2, "0")}`;

function WadPlayDialog({
  title,
  summary,
  onPlay,
  onClose,
}: {
  title: string;
  summary: WadSummary;
  onPlay: (files: GameFiles, skill: Skill) => void;
  onClose: () => void;
}) {
  const [complevel, setComplevel] = useState(summary.complevel);
  const [warp, setWarp] = useState(summary.maps[0]);
  const [skill, setSkill] = useState<Skill>("medium");
  const slots = summary.maps.map(slotOf);
  const patches = summary.dehacked.length;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop className="fixed inset-0 z-40 bg-scrim" />
      <DialogContent className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[520px] max-w-[calc(100vw-32px)] -translate-1/2 flex-col rounded-[4px] border border-input bg-card outline-none">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-5">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <DialogTitle className="block shrink-0 font-sans text-xl font-semibold tracking-normal text-foreground normal-case">
              Play WAD
            </DialogTitle>
            <DialogDescription className="truncate font-mono text-xs text-muted-foreground">
              {title} · {summary.maps.length}{" "}
              {summary.maps.length === 1 ? "map" : "maps"}
              {patches > 0
                ? ` · ${patches} DEHACKED ${patches === 1 ? "patch" : "patches"}`
                : ""}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close"
            className="border-0 bg-transparent p-1 text-muted-foreground hover:text-foreground"
          >
            <X size={16} aria-hidden="true" />
          </DialogClose>
        </header>
        <div className="grid min-h-0 gap-4 overflow-y-auto p-5">
          <FieldItem>
            <Label>Compatibility</Label>
            <Choice
              label="Compatibility"
              value={complevel}
              options={(Object.keys(complevelNames) as Complevel[]).map(
                (value) => ({ value, label: complevelNames[value] }),
              )}
              onChange={setComplevel}
            />
            <p className="m-0 text-xs text-muted-foreground">
              {complevelHelp[complevel]}{" "}
              {complevel === summary.complevel
                ? summary.declared
                  ? "The WAD asks for this."
                  : "Detected from its maps and patches."
                : `The WAD looks like ${complevelNames[summary.complevel]}.`}
            </p>
          </FieldItem>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-3">
            <Select
              value={slotOf(warp)}
              items={slots}
              onValueChange={(next) => {
                if (next) setWarp(Number(next.slice(3)));
              }}
            >
              <FieldItem>
                <SelectLabel>Start at</SelectLabel>
                <SelectTrigger>
                  <SelectValue />
                  <span aria-hidden="true">▾</span>
                </SelectTrigger>
              </FieldItem>
              <SelectContent>
                {slots.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                    <SelectCheck />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldItem>
              <Label>Skill</Label>
              <Choice
                label="Skill"
                value={skill}
                options={(["easy", "medium", "hard"] as const).map((value) => ({
                  value,
                  label: skillNames[value],
                }))}
                onChange={setSkill}
              />
            </FieldItem>
          </div>
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="muted min-w-0">
            Anything the WAD doesn&apos;t replace comes from Freedoom.
          </p>
          <Button
            variant="primary"
            className="shrink-0"
            onClick={() =>
              onPlay(
                {
                  wads: summary.wads,
                  dehacked: summary.dehacked,
                  complevel,
                  warp,
                },
                skill,
              )
            }
          >
            <Play size={14} aria-hidden="true" />
            Play
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

export { WadPlayDialog };
