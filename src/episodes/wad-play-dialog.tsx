import { Play } from "lucide-react";
import * as React from "react";

import { skillNames } from "@/engine/coop";
import { Choice } from "@/engine/coop-ui";
import type { Complevel, GameFiles, Skill } from "@/engine/runtime";
import { complevelLabels } from "@/map/complevel";
import type { WadSummary } from "@/wad/inspect";
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
  const [complevel, setComplevel] = React.useState(summary.complevel);
  const [warp, setWarp] = React.useState(summary.maps[0]);
  const [skill, setSkill] = React.useState<Skill>("medium");
  const slots = summary.maps.map(slotOf);
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
        <div className="grid min-h-0 gap-4 overflow-y-auto p-5">
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
        <DialogFooter className="justify-between">
          <p className="text-muted-foreground min-w-0">
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { WadPlayDialog };
