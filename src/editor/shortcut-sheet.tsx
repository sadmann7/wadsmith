import { ariaKeyshortcuts, formatShortcut } from "@ui-sdk/core";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { X } from "lucide-react";

type Key = { text: string; spoken?: string };
type Shortcut = { keys: Key[]; does: string };

function key(text: string, spoken?: string): Key {
  return { text, spoken };
}

function chord(shortcut: string): Key {
  return {
    text: formatShortcut(shortcut),
    spoken: ariaKeyshortcuts(shortcut).replaceAll("+", " "),
  };
}

const backspace = key("⌫", "Backspace");

function groups(): { title: string; items: Shortcut[] }[] {
  return [
    {
      title: "Map",
      items: [
        {
          keys: ["V", "L", "S", "T"].map((letter) => key(letter)),
          does: "Edit vertices, lines, sectors or things",
        },
        {
          keys: [key("Arrows")],
          does: "Nudge the selection, with Shift for 8 steps",
        },
        { keys: [key("Shift-click")], does: "Add to the selection" },
        { keys: [backspace], does: "Delete the selection" },
        { keys: [chord("mod+d")], does: "Duplicate the selected things" },
        { keys: [chord("mod+z")], does: "Undo" },
        { keys: [chord("mod+shift+z")], does: "Redo" },
        { keys: [key("+"), key("−", "minus")], does: "Zoom in or out" },
        { keys: [key("0")], does: "Reset the zoom" },
        { keys: [key("C")], does: "Wire the focused switch to a door" },
      ],
    },
    {
      title: "Drawing a room",
      items: [
        { keys: [key("Enter")], does: "Close the room" },
        { keys: [backspace], does: "Remove the last corner" },
        { keys: [key("Esc")], does: "Throw away the corners so far" },
      ],
    },
    {
      title: "Anywhere in the editor",
      items: [
        {
          keys: [key("M")],
          does: "Maximise the pane under the pointer, or split again",
        },
        { keys: [key("C")], does: "Point the 3D camera at the pointer" },
        { keys: [chord("shift+F10")], does: "Open the menu for the selection" },
        { keys: [key("?")], does: "Show these shortcuts" },
      ],
    },
    {
      title: "3D view",
      items: [
        { keys: [key("W"), key("S")], does: "Walk forward or back" },
        { keys: [key("A"), key("D")], does: "Step sideways" },
        { keys: [key("←", "left"), key("→", "right")], does: "Turn" },
        {
          keys: [key("N"), key("P")],
          does: "Select the next or previous surface",
        },
        {
          keys: [key("Page Up"), key("Page Down")],
          does: "Raise or lower the selected surface, with Shift for 3 steps",
        },
        { keys: [key("Alt-arrows")], does: "Nudge the selected thing" },
        { keys: [backspace], does: "Delete the selected thing" },
        {
          keys: [key("Enter")],
          does: "Place the chosen thing in front of you",
        },
        { keys: [key("Esc")], does: "Clear the selection" },
      ],
    },
    {
      title: "Playing",
      items: [
        { keys: [key("W"), key("A"), key("S"), key("D")], does: "Move" },
        { keys: [key("←", "left"), key("→", "right")], does: "Turn" },
        {
          keys: [key("Space")],
          does: "Fire, or click once the mouse is captured",
        },
        { keys: [key("E")], does: "Use doors and switches" },
        { keys: [key("Shift")], does: "Run" },
        { keys: [key("Tab")], does: "Automap, or scores in a co-op game" },
        { keys: [key("N")], does: "Leave a note at this spot" },
        { keys: [key("F2")], does: "Edit this spot in the editor" },
        {
          keys: [key("Esc")],
          does: "Release the mouse, then press again to exit",
        },
      ],
    },
  ];
}

function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop className="fixed inset-0 z-40 bg-scrim" />
      <DialogContent className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[680px] max-w-[calc(100vw-32px)] -translate-1/2 flex-col rounded-[4px] border border-border-strong bg-surface outline-none">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
          <DialogTitle className="block font-sans text-xl font-semibold tracking-normal text-fg normal-case">
            Keyboard shortcuts
          </DialogTitle>
          <DialogClose
            aria-label="Close"
            className="border-0 bg-transparent p-1 text-fg-muted hover:text-fg"
          >
            <X size={16} aria-hidden="true" />
          </DialogClose>
        </header>
        <div className="grid min-h-0 grid-cols-2 gap-x-8 gap-y-6 overflow-y-auto p-5 max-[640px]:grid-cols-1">
          {groups().map((group) => (
            <section key={group.title} className="grid content-start gap-2">
              <h3 className="m-0 font-mono text-[11px] font-normal tracking-wide text-fg-muted uppercase">
                {group.title}
              </h3>
              <dl className="m-0 grid gap-1.5">
                {group.items.map((item) => (
                  <div
                    key={item.does}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3"
                  >
                    <dt className="text-[13px] text-fg-soft">{item.does}</dt>
                    <dd className="m-0 flex items-baseline gap-1">
                      {item.keys.map((entry, index) => (
                        <span key={entry.text} className="flex gap-1">
                          {index > 0 ? (
                            <span className="text-[11px] text-fg-muted">
                              <span aria-hidden="true">/</span>
                              <span className="sr-only">or</span>
                            </span>
                          ) : null}
                          <kbd
                            aria-label={entry.spoken}
                            className="rounded-[3px] border border-border-strong px-1.5 font-mono text-[11px] text-fg"
                          >
                            {entry.text}
                          </kbd>
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <footer className="border-t border-border px-5 py-3 text-xs text-fg-muted">
          Walking and the N and P keys go by position, as on a US keyboard.
        </footer>
      </DialogContent>
    </Dialog>
  );
}

export { ShortcutSheet };
