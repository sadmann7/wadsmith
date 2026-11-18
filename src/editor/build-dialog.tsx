import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { Input } from "@ui-sdk/react/input";
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  TriangleAlert,
  X,
} from "lucide-react";
import { useState } from "react";

import { buildChecks, issueText, type CheckedIssue } from "../map/checks";
import type { GameMap } from "../map/types";

const maxNameLength = 64;

const statusIcons = {
  passed: { icon: CircleCheck, className: "text-acid", label: "Passed" },
  warning: { icon: TriangleAlert, className: "text-key", label: "Warning" },
  error: { icon: CircleX, className: "text-danger", label: "Error" },
  waiting: {
    icon: CircleDashed,
    className: "text-muted",
    label: "Not checked",
  },
};

function wadFileName(name: string) {
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

function BuildDialog({
  map,
  name,
  slot,
  onBuild,
  onShow,
  onClose,
}: {
  map: GameMap;
  name: string;
  slot: string;
  onBuild: (fileName: string) => string | null;
  onShow: (issue: CheckedIssue) => void;
  onClose: () => void;
}) {
  const [fileName, setFileName] = useState(() => defaultFileName(name));
  const [buildError, setBuildError] = useState<string | null>(null);
  const checks = buildChecks(map);
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
      <DialogBackdrop className="fixed inset-0 z-40 bg-black/65" />
      <DialogContent className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[560px] max-w-[calc(100vw-32px)] -translate-1/2 flex-col rounded-[4px] border border-[#3a352e] bg-panel outline-none">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <DialogTitle className="block font-sans text-xl font-semibold tracking-normal text-text normal-case">
              Build WAD
            </DialogTitle>
            <DialogDescription className="truncate font-mono text-xs text-muted">
              {slot} {name}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close"
            className="border-0 bg-transparent p-1 text-muted hover:text-text"
          >
            <X size={16} aria-hidden="true" />
          </DialogClose>
        </header>
        <div className="grid min-h-0 gap-4 overflow-y-auto p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
            <label className="field">
              <span className="label">File name</span>
              <Input
                className="text-input"
                value={fileName}
                onValueChange={setFileName}
              />
            </label>
            <div className="field">
              <span className="label">Format</span>
              <div className="flex min-h-[30px] items-center">Classic Doom</div>
            </div>
          </div>
          <section aria-label="Build checks" className="grid gap-2">
            <h3 className="m-0 flex justify-between font-mono text-[11px] font-normal text-muted">
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
                      <div className="truncate font-mono text-[11px] text-muted">
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
                        className="border-0 bg-transparent p-0 text-muted hover:text-text"
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
        <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <p
            className={buildError ? "min-w-0 text-danger" : "muted min-w-0"}
            role={buildError ? "alert" : undefined}
          >
            {buildError ??
              (errors.length > 0
                ? "Fix the errors before building."
                : "Ready to download.")}
          </p>
          <button
            type="button"
            className="button primary shrink-0"
            disabled={errors.length > 0}
            onClick={() => setBuildError(onBuild(wadFileName(fileName)))}
          >
            Download WAD
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

export { BuildDialog, wadFileName };
