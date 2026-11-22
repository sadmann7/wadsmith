import { Play } from "lucide-react";
import * as React from "react";

import { skillNames } from "@/lib/engine/coop";
import { Choice } from "@/components/play/coop-ui";
import { slotName, type GameInfo } from "@/lib/engine/game";
import type { Complevel, GameFiles, Skill } from "@/lib/engine/runtime";
import { complevelLabels } from "@/lib/map/complevel";
import type { WadSummary } from "@/lib/wad/inspect";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectCheck,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldItem, Label } from "@/components/ui/field";
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

const complevelHelp: Record<Complevel, string> = {
  vanilla: "Plays like doom2.exe, with its limits and bugs.",
  boom: "Adds Boom's line actions, scrollers, friction and deep water.",
  mbf: "Adds MBF's helper dogs, sky transfers and code pointers.",
  mbf21: "Adds MBF21's line flags and DEHACKED extensions.",
};

interface WadPlayDialogProps {
  title: string;
  summary: WadSummary;
  game: GameInfo;
  onPlay: (files: GameFiles, skill: Skill) => void;
  onClose: () => void;
}

export function WadPlayDialog({
  title,
  summary,
  game,
  onPlay,
  onClose,
}: WadPlayDialogProps) {
  const [complevel, setComplevel] = React.useState(summary.complevel);
  const [warp, setWarp] = React.useState(summary.maps[0]);
  const [skill, setSkill] = React.useState<Skill>("medium");
  const slotOf = (map: number) => slotName(map, summary.episodes);
  const slots = summary.maps.map((map) => ({
    value: String(map),
    label: slotOf(map),
  }));
  const patches = summary.dehacked.length;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent className="w-[520px]">
        <DialogHeader>
          <div className="flex min-w-0 items-baseline gap-2.5">
            <DialogTitle>Play WAD</DialogTitle>
            <DialogDescription>
              {title} · {summary.maps.length}{" "}
              {summary.maps.length === 1 ? "map" : "maps"}
              {patches > 0
                ? ` · ${patches} DEHACKED ${patches === 1 ? "patch" : "patches"}`
                : ""}
            </DialogDescription>
          </div>
          <DialogCloseButton />
        </DialogHeader>
        <div className="relative grid min-h-0 gap-4 overflow-y-auto p-5">
          <FieldItem>
            <Label>Compatibility</Label>
            <Choice
              label="Compatibility"
              value={complevel}
              options={(Object.keys(complevelLabels) as Complevel[]).map(
                (value) => ({ value, label: complevelLabels[value] }),
              )}
              onChange={setComplevel}
            />
            <p className="m-0 text-xs text-muted-foreground">
              {complevelHelp[complevel]}{" "}
              {complevel === summary.complevel
                ? summary.declared
                  ? "The WAD asks for this."
                  : "Detected from its maps and patches."
                : `The WAD looks like ${complevelLabels[summary.complevel]}.`}
            </p>
          </FieldItem>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-3">
            <Select
              value={String(warp)}
              items={slots}
              onValueChange={(next) => {
                if (next) setWarp(Number(next));
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
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
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
        <DialogFooter className="justify-between">
          <p className="min-w-0 text-muted-foreground">
            Anything the WAD doesn&apos;t replace comes from {game.label}.
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
