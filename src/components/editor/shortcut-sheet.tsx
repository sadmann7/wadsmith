import { ariaKeyshortcuts, formatShortcut } from "@ui-sdk/core";

import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { editorShortcuts } from "@/lib/editor/shortcuts";

interface Key {
  text: string;
  spoken?: string;
}
interface Shortcut {
  keys: Key[];
  does: string;
}

function key(text: string, spoken?: string): Key {
  return { text, spoken };
}

type TableEntry = (typeof editorShortcuts)[keyof typeof editorShortcuts];

interface ShortcutSheetProps {
  onClose: () => void;
}

export function ShortcutSheet({ onClose }: ShortcutSheetProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent className="w-[680px]">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <div className="relative grid min-h-0 grid-cols-2 gap-x-8 gap-y-6 overflow-y-auto p-5 max-[640px]:grid-cols-1">
          {groups().map((group) => (
            <section key={group.title} className="grid content-start gap-2">
              <h3 className="m-0 font-mono text-xs font-normal tracking-wide text-muted-foreground uppercase">
                {group.title}
              </h3>
              <dl className="m-0 grid gap-1.5">
                {group.items.map((item) => (
                  <div
                    key={item.does}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3"
                  >
                    <dt className="text-sm text-foreground">{item.does}</dt>
                    <dd className="m-0 flex items-baseline gap-1">
                      {item.keys.map((entry, index) => (
                        <span key={entry.text} className="flex gap-1">
                          {index > 0 ? (
                            <span className="text-xs text-muted-foreground">
                              <span aria-hidden="true">/</span>
                              <span className="sr-only">or</span>
                            </span>
                          ) : null}
                          <kbd
                            aria-label={entry.spoken}
                            className="rounded-[3px] border border-input px-1.5 font-mono text-xs text-foreground"
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
        <footer className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
          Walking and the N and P keys go by position, as on a US keyboard.
        </footer>
      </DialogContent>
    </Dialog>
  );
}

const backspace = key("⌫", "Backspace");

function groups(): { title: string; items: Shortcut[] }[] {
  return [
    {
      title: "Editor",
      items: tableRows((item) => !("area" in item)),
    },
    {
      title: "Map",
      items: [
        ...tableRows((item) => "area" in item),
        {
          keys: [key("Arrows")],
          does: "Nudge the selection, with Shift for 8 steps",
        },
        {
          keys: [key("Shift-click")],
          does: "Add a corner, a thing or a room to the selection",
        },
        {
          keys: [key("Shift-drag")],
          does: "Select every corner and thing in a box",
        },
        { keys: [chord("mod+c")], does: "Copy the selected rooms and things" },
        { keys: [chord("mod+x")], does: "Cut them" },
        { keys: [chord("mod+v")], does: "Paste at the pointer" },
        { keys: [backspace], does: "Delete the selection" },
        { keys: [key("+"), key("−", "minus")], does: "Zoom in or out" },
        { keys: [key("0")], does: "Reset the zoom" },
        { keys: [key("C")], does: "Wire the focused switch to a door" },
        { keys: [chord("shift+F10")], does: "Open the menu for the selection" },
      ],
    },
    {
      title: "Drawing a room or line",
      items: [
        { keys: [key("Enter")], does: "Close the room or finish the line" },
        { keys: [backspace], does: "Remove the last corner" },
        { keys: [key("Esc")], does: "Throw away the corners so far" },
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
        {
          keys: [key("O")],
          does: "Open or shut the door or lift under the pointer",
        },
        {
          keys: [chord("mod+c"), chord("mod+v")],
          does: "Copy a surface's look, and paste it on another",
        },
        { keys: [key("Alt-click")], does: "Paint the copied look on" },
        {
          keys: [key("F")],
          does: "Flood the copied texture along joined walls",
        },
        {
          keys: [key("Shift-click")],
          does: "Pick several surfaces, for a gradient",
        },
        {
          keys: [key("Wheel")],
          does: "Raise or lower a floor or ceiling, with Shift for brightness",
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

function tableRows(include: (item: TableEntry) => boolean): Shortcut[] {
  return Object.values(editorShortcuts)
    .filter(include)
    .map((item) => ({ keys: [chord(item.keys)], does: item.description }));
}

function chord(shortcut: string): Key {
  return {
    text: formatShortcut(shortcut),
    spoken: ariaKeyshortcuts(shortcut).replaceAll("+", " "),
  };
}
