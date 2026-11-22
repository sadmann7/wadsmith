import { Check, Copy } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { playLink } from "@/lib/episodes/published";

interface PublishDialogProps {
  kind: "map" | "episode";
  title: string;
  author: string;
  // Textures added from files, which travel inside the published WAD.
  customTextures: number;
  // Why it can't be published yet, or null when it can.
  blocked: string | null;
  onPublish: (details: {
    title: string;
    author: string;
    listed: boolean;
  }) => Promise<string>;
  onClose: () => void;
}

export function PublishDialog({
  kind,
  title: initialTitle,
  author: initialAuthor,
  customTextures,
  blocked,
  onPublish,
  onClose,
}: PublishDialogProps) {
  const [title, setTitle] = React.useState(initialTitle);
  const [author, setAuthor] = React.useState(initialAuthor);
  const [listed, setListed] = React.useState(true);
  const [mayShare, setMayShare] = React.useState(customTextures === 0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [id, setId] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const link = id ? playLink(location.origin, id) : null;
  const publish = () => {
    setBusy(true);
    setError(null);
    onPublish({ title, author, listed })
      .then(setId)
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
            <DialogTitle>
              {kind === "map" ? "Publish map" : "Publish episode"}
            </DialogTitle>
            <DialogDescription>A link anyone can play</DialogDescription>
          </div>
          <DialogCloseButton />
        </DialogHeader>
        <div className="grid gap-4 p-5">
          {link ? (
            <div className="grid gap-1.5">
              <div className="flex gap-2">
                <Input
                  className="min-w-0 flex-1 font-mono text-xs"
                  aria-label="Play link"
                  readOnly
                  value={link}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  onClick={() =>
                    void navigator.clipboard
                      ?.writeText(link)
                      .then(() => setCopied(true))
                  }
                >
                  {copied ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <Copy size={14} aria-hidden="true" />
                  )}
                  {copied ? "Copied" : "Copy link"}
                </Button>
              </div>
              <p className="m-0 text-sm text-muted-foreground">
                The link opens the game, with no editor. It always plays this
                version: publish again after changes for a new link.
              </p>
            </div>
          ) : (
            <>
              <Field>
                <FieldLabel>Title</FieldLabel>
                <Input value={title} onValueChange={setTitle} maxLength={80} />
              </Field>
              <Field>
                <FieldLabel>Your name</FieldLabel>
                <Input
                  value={author}
                  onValueChange={setAuthor}
                  maxLength={40}
                  placeholder="Shown with the map"
                />
              </Field>
              <label className="flex items-center justify-between gap-2">
                List it in the gallery
                <Switch checked={listed} onCheckedChange={setListed} />
              </label>
              {customTextures > 0 ? (
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={mayShare}
                    onCheckedChange={(checked) => setMayShare(checked === true)}
                    className="mt-0.5"
                  />
                  <span>
                    The map uses {customTextures}{" "}
                    {customTextures === 1 ? "texture file" : "texture files"}{" "}
                    added to this browser. They go out inside the published WAD,
                    and I may share them.
                  </span>
                </label>
              ) : null}
            </>
          )}
          {blocked && !link ? (
            <p className="m-0 text-sm text-destructive" role="alert">
              {blocked}
            </p>
          ) : null}
          {error ? (
            <p className="m-0 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="justify-end">
          {link ? (
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={busy || !title.trim() || !mayShare || Boolean(blocked)}
              onClick={publish}
            >
              {busy ? "Publishing…" : "Publish"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
