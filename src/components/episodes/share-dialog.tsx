import { Check, Copy } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { type CloudLink, editLink, viewLink } from "@/lib/episodes/cloud";

interface ShareDialogProps {
  name: string;
  link: CloudLink | null;
  // Why the online copy can't be reached, or null while it can.
  problem: string | null;
  onShare: () => Promise<void>;
  onStop: () => void;
  onClose: () => void;
}

export function ShareDialog({
  name,
  link,
  problem,
  onShare,
  onStop,
  onClose,
}: ShareDialogProps) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const share = () => {
    setBusy(true);
    setError(null);
    onShare()
      .catch((error_: Error) => setError(error_.message))
      .finally(() => setBusy(false));
  };
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
            <DialogTitle>Keep online</DialogTitle>
            <DialogDescription>{name}</DialogDescription>
          </div>
          <DialogCloseButton />
        </DialogHeader>
        <div className="grid gap-4 p-5">
          {link ? (
            <>
              {link.secret ? (
                <LinkField
                  label="Edit link"
                  value={editLink(location.origin, link)}
                  hint="Opens this map to edit on any device. Anyone with it can change the map, so keep it to yourself and people you trust."
                />
              ) : null}
              <LinkField
                label="View link"
                value={viewLink(location.origin, link)}
                hint="Gives someone their own copy of the map. Their changes stay with them."
              />
              {problem ? (
                <p className="m-0 text-sm text-warning" role="status">
                  {problem} Edits wait in this browser and go online once it can
                  reach the copy again.
                </p>
              ) : null}
            </>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">
              Keep a copy of this map online, so it survives clearing this
              browser and opens on another device from its link. Your IWAD stays
              in this browser.
            </p>
          )}
          {error ? (
            <p className="m-0 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="justify-between">
          {link ? (
            <Button onClick={onStop}>Stop keeping it online here</Button>
          ) : (
            <span />
          )}
          {link ? (
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          ) : (
            <Button variant="primary" disabled={busy} onClick={share}>
              {busy ? "Putting it online…" : "Put it online"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface LinkFieldProps {
  label: string;
  value: string;
  hint: string;
}

function LinkField({ label, value, hint }: LinkFieldProps) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="grid gap-1.5">
      <div className="flex gap-2">
        <Input
          className="min-w-0 flex-1 font-mono text-xs"
          aria-label={label}
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          onClick={() =>
            void navigator.clipboard
              ?.writeText(value)
              .then(() => setCopied(true))
          }
        >
          {copied ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}
          {copied ? "Copied" : `Copy ${label.toLowerCase()}`}
        </Button>
      </div>
      <p className="m-0 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
