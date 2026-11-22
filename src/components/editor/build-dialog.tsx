import {
  CircleCheck,
  CircleDashed,
  CircleX,
  TriangleAlert,
} from "lucide-react";
import * as React from "react";

import { engineSlot, type GameInfo } from "@/lib/engine/game";
import { buildChecks, issueText, type CheckedIssue } from "@/lib/map/checks";
import type { GameMap } from "@/lib/map/types";
import type { CheckContext } from "@/lib/map/validate";
import { Button } from "@/components/ui/button";
import { Field, FieldItem, FieldLabel, Label } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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

const maxNameLength = 64;

const statusIcons = {
  passed: { icon: CircleCheck, className: "text-success", label: "Passed" },
  warning: { icon: TriangleAlert, className: "text-warning", label: "Warning" },
  error: { icon: CircleX, className: "text-destructive", label: "Error" },
  waiting: {
    icon: CircleDashed,
    className: "text-muted-foreground",
    label: "Not checked",
  },
};

export function wadFileName(name: string) {
  const stem = name.trim().replace(/\.wad\.*$/i, "");
  const safe = stem
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, maxNameLength);
  return `${safe || "wadsmith-map01"}.wad`;
}

function defaultFileName(name: string) {
  return wadFileName(name.toLowerCase());
}

interface BuildDialogProps {
  map: GameMap;
  name: string;
  slot: string;
  game: GameInfo;
  context: CheckContext;
  onBuild: (fileName: string) => string | null;
  onShow: (issue: CheckedIssue) => void;
  onClose: () => void;
}

export function BuildDialog({
  map,
  name,
  slot,
  game,
  context,
  onBuild,
  onShow,
  onClose,
}: BuildDialogProps) {
  const [fileName, setFileName] = React.useState(() => defaultFileName(name));
  const [buildError, setBuildError] = React.useState<string | null>(null);
  const checks = buildChecks(map, context);
  const issues = checks.flatMap((check) => check.issues);
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.length - errors.length;
  const passed = checks.filter(
    (check) => check.issues.length === 0 && !check.waiting,
  ).length;
  const summary = [
    `${passed} passed`,
    ...(errors.length > 0
      ? [`${errors.length} ${errors.length === 1 ? "error" : "errors"}`]
      : []),
    ...(warnings > 0
      ? [`${warnings} ${warnings === 1 ? "warning" : "warnings"}`]
      : []),
  ].join(" · ");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent className="w-[560px]">
        <DialogHeader>
          <div className="flex min-w-0 items-baseline gap-2.5">
            <DialogTitle>Build WAD</DialogTitle>
            <DialogDescription>
              {engineSlot(slot, game)} {name}
            </DialogDescription>
          </div>
          <DialogCloseButton />
        </DialogHeader>
        <div className="relative grid min-h-0 gap-4 overflow-y-auto p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
            <Field>
              <FieldLabel>File name</FieldLabel>
              <Input value={fileName} onValueChange={setFileName} />
            </Field>
            <FieldItem>
              <Label>Format</Label>
              <div className="flex min-h-[30px] items-center">
                {game.episodes > 0 ? "Doom" : "Doom II"}
              </div>
            </FieldItem>
          </div>
          <section aria-label="Build checks" className="grid gap-2">
            <h3 className="m-0 flex justify-between font-mono text-xs font-normal text-muted-foreground">
              <span>MAP CHECK</span>
              <span>{summary}</span>
            </h3>
            <ul className="m-0 grid list-none gap-2 p-0">
              {checks.map((check) => {
                const issue =
                  check.issues.find((item) => item.severity === "error") ??
                  check.issues[0];
                const status =
                  issue?.severity ?? (check.waiting ? "waiting" : "passed");
                const { icon: Icon, className, label } = statusIcons[status];
                const more = check.issues.length - 1;
                return (
                  <li
                    key={check.name}
                    className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-2"
                  >
                    <Icon
                      size={14}
                      className={`mt-0.5 ${className}`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <div>
                        <span className="sr-only">{label}: </span>
                        {check.name}
                      </div>
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {issue
                          ? `${issueText(issue).title}${more > 0 ? ` · +${more} more` : ""}`
                          : check.waiting
                            ? "Checked after errors are fixed"
                            : check.passed}
                      </div>
                    </div>
                    {issue?.target ? (
                      <button
                        type="button"
                        className="border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
                        aria-label={`Show: ${check.name}`}
                        onClick={() => onShow(issue)}
                      >
                        Show
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
        <DialogFooter className="justify-between">
          <p
            className={
              buildError
                ? "min-w-0 text-destructive"
                : "min-w-0 text-muted-foreground"
            }
            role={buildError ? "alert" : undefined}
          >
            {buildError ??
              (errors.length > 0
                ? "Fix the errors before building."
                : "Ready to download.")}
          </p>
          <Button
            variant="primary"
            className="shrink-0"
            disabled={errors.length > 0}
            onClick={() => setBuildError(onBuild(wadFileName(fileName)))}
          >
            Download WAD
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
