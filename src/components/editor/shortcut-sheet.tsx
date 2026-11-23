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
        <footer className="grid gap-1 border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <p>
            Walking and the N and P keys go by position, as on a US keyboard.
          </p>
          <p>
            In a browser with WebMCP, such as ChatGPT's, its built-in agent can
            edit this map. It asks before removing anything.
          </p>
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
          does: "Add a corner, a wall, a thing or a room to the selection",
        },
        {
          keys: [key("Drag")],
          does: "Select what a box holds, with Shift to add and Ctrl or ⌘ to take away",
        },
        {
          keys: [key("Space-drag"), key("Middle-drag")],
          does: "Pan the map",
        },
        { keys: [key("Esc")], does: "Clear the selection" },
        {
          keys: [key("Page Up"), key("Page Down")],
          does: "Raise or lower the floor of the selected rooms, or the room under the pointer, with Shift for 3 steps",
        },
        {
          keys: [key("Home"), key("End")],
          does: "Raise or lower their ceiling",
        },
        {
          keys: [key("Alt+Page Up"), key("Alt+Page Down")],
          does: "Brighten or darken them",
        },
        { keys: [chord("mod+c")], does: "Copy the selected rooms and things" },
        { keys: [chord("mod+x")], does: "Cut them" },
        { keys: [chord("mod+v")], does: "Paste at the pointer" },
        {
          keys: [backspace],
          does: "Delete the selection, or take out the selected corners",
        },
        {
          keys: [key("Insert"), key("Double-click")],
          does: "Add a corner on the wall under the pointer",
        },
        {
          keys: [key("Insert")],
          does: "Place the chosen thing at the pointer, in thing mode",
        },
        {
          keys: [key("1–9", "1 to 9")],
          does: "Select a saved group, with Shift to add it to the selection",
        },
        { keys: [chord("alt+1")], does: "Save the selection as group 1" },
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
        {
          keys: [key("←", "left"), key("→", "right")],
          does: "Turn, or move the selected walls' texture when a wall is selected",
        },
        {
          keys: [key("↑", "up"), key("↓", "down")],
          does: "Walk, or move the selected walls' texture, by 1, 8 with Shift or the grid with Ctrl or ⌘",
        },
        {
          keys: [key("G")],
          does: "Switch between walking, which stops at walls and climbs steps, and flying through them",
        },
        { keys: [key("Space"), key("C")], does: "Fly up or down" },
        {
          keys: [key("Z")],
          does: "Look with the mouse, and act on what the crosshair is over",
        },
        {
          keys: [key("N"), key("P")],
          does: "Select the next or previous surface",
        },
        {
          keys: [key("Page Up"), key("Page Down")],
          does: "Raise or lower the selected surfaces by the grid, with Shift to the next height beside them and Alt for light",
        },
        {
          keys: [key("O")],
          does: "Open or shut the door or lift under the pointer",
        },
        {
          keys: [chord("mod+c"), chord("mod+v")],
          does: "Copy a surface's look, and paste it on another",
        },
        {
          keys: [key("Alt-click"), key("Middle-click")],
          does: "Paint the copied look on, or on every picked surface when one of them is clicked",
        },
        {
          keys: [key("Shift+Middle-click")],
          does: "Flood the copied texture along joined walls",
        },
        {
          keys: [key("Shift")],
          does: "While dragging a wall's texture, align the walls beside it",
        },
        {
          keys: [key("F")],
          does: "Flood the copied texture along joined walls",
        },
        {
          keys: [key("Shift-click")],
          does: "Pick several surfaces, which the keys and the wheel then change together",
        },
        {
          keys: [key("Wheel")],
          does: "Raise or lower a floor or ceiling by the grid, by 1 with Shift, or change its light with Alt",
        },
        {
          keys: [key("Shift+A")],
          does: "Align the texture along the walls beside the one aimed at",
        },
        {
          keys: [key("Alt+A")],
          does: "Line up the texture's rows on the walls beside it",
        },
        {
          keys: [key("U"), key("L")],
          does: "Peg the upper or lower texture of the walls, or unpeg them",
        },
        { keys: [key("Shift+R")], does: "Reset the walls' texture offsets" },
        { keys: [key("B")], does: "Show everything at full light, or not" },
        { keys: [key("T")], does: "Hide things, or show them again" },
        {
          keys: [key(","), key(".")],
          does: "Turn the selected thing left or right",
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
