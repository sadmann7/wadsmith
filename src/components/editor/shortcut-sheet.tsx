import { ariaKeyshortcuts, formatShortcut } from "@ui-sdk/core";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldItem } from "@/components/ui/field";
import {
  Select,
  SelectCheck,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEditorKeys } from "@/hooks/use-editor-keys";
import {
  bindingProblem,
  bindKeys,
  getSavedKeys,
  type Keymap,
  type KeyPreset,
  keyPresets,
  keysFromEvent,
  saveKeys,
} from "@/lib/editor/keymap";
import { type EditorShortcut, editorShortcuts } from "@/lib/editor/shortcuts";

interface Key {
  text: string;
  spoken?: string;
}
interface Shortcut {
  keys: Key[];
  does: string;
  name?: EditorShortcut;
}

function key(text: string, spoken?: string): Key {
  return { text, spoken };
}

type TableEntry = (typeof editorShortcuts)[EditorShortcut];

const presetItems = (Object.keys(keyPresets) as KeyPreset[]).map((value) => ({
  value,
  label: keyPresets[value].label,
}));

interface ShortcutSheetProps {
  onClose: () => void;
}

export function ShortcutSheet({ onClose }: ShortcutSheetProps) {
  const keymap = useEditorKeys();
  const [preset, setPreset] = React.useState(() => getSavedKeys().preset);
  const [binding, setBinding] = React.useState<EditorShortcut | null>(null);
  const [status, setStatus] = React.useState("");

  const choosePreset = (next: KeyPreset) => {
    setPreset(next);
    saveKeys({ preset: next, keys: {} });
    setStatus(`Using the ${keyPresets[next].label} keys.`);
  };

  const capture = (event: React.KeyboardEvent, name: EditorShortcut) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setBinding(null);
      setStatus("");
      return;
    }
    const pressed = keysFromEvent(
      event.nativeEvent,
      ariaKeyshortcuts("mod") === "Meta",
    );
    if (!pressed) return;
    if ("problem" in pressed) {
      setStatus(pressed.problem);
      return;
    }
    const problem = bindingProblem(name, pressed.keys);
    if (problem) {
      setStatus(problem);
      return;
    }
    const { saved, taken } = bindKeys(getSavedKeys(), name, pressed.keys);
    saveKeys(saved);
    setBinding(null);
    const what = editorShortcuts[name].description;
    setStatus(
      taken.length > 0
        ? `${what}: ${formatShortcut(pressed.keys)}, taken from ${taken
            .map((other) => editorShortcuts[other].description)
            .join(" and ")}.`
        : `${what}: ${formatShortcut(pressed.keys)}.`,
    );
  };

  const unbind = (name: EditorShortcut) => {
    saveKeys(bindKeys(getSavedKeys(), name, "").saved);
    setBinding(null);
    setStatus(`${editorShortcuts[name].description}: no key.`);
  };

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
        <div className="flex flex-wrap items-end gap-3 border-b border-border px-5 py-3">
          <Select
            value={preset}
            items={presetItems}
            onValueChange={(next) => {
              if (next) choosePreset(next);
            }}
          >
            <FieldItem className="min-w-[220px]">
              <SelectLabel>Keys</SelectLabel>
              <SelectTrigger>
                <SelectValue />
                <span aria-hidden="true">▾</span>
              </SelectTrigger>
            </FieldItem>
            <SelectContent>
              {presetItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                  <SelectCheck />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => choosePreset(preset)}>Reset changes</Button>
          <p
            role="status"
            className="m-0 min-h-5 basis-full text-xs text-muted-foreground"
          >
            {status ||
              "Click a key in the Editor, Map or 3D view list to change it, then press the new key."}
          </p>
        </div>
        <div className="relative grid min-h-0 grid-cols-2 gap-x-8 gap-y-6 overflow-y-auto p-5 max-[640px]:grid-cols-1">
          {groups(keymap).map((group) => (
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
                      {item.name ? (
                        <KeyButton
                          name={item.name}
                          keys={item.keys}
                          binding={binding === item.name}
                          onStart={() => {
                            setBinding(item.name ?? null);
                            setStatus(
                              "Press the new key, Esc to keep the old one, or Delete for no key.",
                            );
                          }}
                          onCapture={capture}
                          onUnbind={unbind}
                          onCancel={() => setBinding(null)}
                        />
                      ) : (
                        <Keys keys={item.keys} />
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <footer className="grid gap-1 border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <p>Walking and flying go by key position, as on a US keyboard.</p>
          <p>
            In a browser with WebMCP, such as ChatGPT's, its built-in agent can
            edit this map. It asks before removing anything.
          </p>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

interface KeyButtonProps {
  name: EditorShortcut;
  keys: Key[];
  binding: boolean;
  onStart: () => void;
  onCapture: (event: React.KeyboardEvent, name: EditorShortcut) => void;
  onUnbind: (name: EditorShortcut) => void;
  onCancel: () => void;
}

function KeyButton({
  name,
  keys,
  binding,
  onStart,
  onCapture,
  onUnbind,
  onCancel,
}: KeyButtonProps) {
  const label = keys.map((entry) => entry.spoken ?? entry.text).join(" ");
  return (
    <button
      type="button"
      aria-label={
        binding
          ? `Press a new key for ${editorShortcuts[name].description}`
          : `${label || "No key"}, change the key for ${editorShortcuts[name].description}`
      }
      className="rounded-[3px] border border-input px-1.5 font-mono text-xs text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring data-[binding]:border-ring data-[binding]:text-muted-foreground"
      data-binding={binding ? "" : undefined}
      onClick={() => {
        if (!binding) onStart();
      }}
      onBlur={() => {
        if (binding) onCancel();
      }}
      onKeyDown={(event) => {
        if (!binding) return;
        if (event.key === "Tab") {
          onCancel();
          return;
        }
        if (
          (event.key === "Delete" || event.key === "Backspace") &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
          event.stopPropagation();
          onUnbind(name);
          return;
        }
        onCapture(event, name);
      }}
    >
      {binding ? "Press keys" : keys.length > 0 ? keys[0].text : "None"}
    </button>
  );
}

interface KeysProps {
  keys: Key[];
}

function Keys({ keys }: KeysProps) {
  return keys.map((entry, index) => (
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
  ));
}

const backspace = key("⌫", "Backspace");

function groups(keymap: Keymap): { title: string; items: Shortcut[] }[] {
  return [
    {
      title: "Editor",
      items: tableRows(keymap, (item) => !("area" in item)),
    },
    {
      title: "Map",
      items: [
        ...tableRows(keymap, (item) => "area" in item && item.area === "map"),
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
          does: "Move what's under the pointer: a thing, a corner, a wall, or a room with what stands in it. Esc puts it back",
        },
        {
          keys: [key("Drag"), key("Shift-drag")],
          does: "From empty space, or anywhere with Shift, select what a box holds, with Shift to add and Ctrl or ⌘ to take away",
        },
        {
          keys: [key("Space-drag"), key("Middle-drag")],
          does: "Pan the map, as a trackpad's two-finger scroll does too",
        },
        {
          keys: [key("Wheel")],
          does: "Zoom at the pointer, as a trackpad pinch does too",
        },
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
        ...tableRows(keymap, (item) => "area" in item && item.area === "scene"),
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
        { keys: [key("Space"), key("C")], does: "Fly up or down" },
        {
          keys: [key("Right-drag")],
          does: "Look around, while a right-click still opens the menu",
        },
        {
          keys: [key("Page Up"), key("Page Down")],
          does: "Raise or lower the selected surfaces by the grid, with Shift to the next height beside them and Alt for light",
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
          does: "Flood the copied texture along joined walls from the one clicked",
        },
        {
          keys: [key("Shift")],
          does: "While dragging a wall's texture, align the walls beside it",
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

function tableRows(
  keymap: Keymap,
  include: (item: TableEntry) => boolean,
): Shortcut[] {
  return (Object.keys(editorShortcuts) as EditorShortcut[])
    .filter((name) => include(editorShortcuts[name]))
    .map((name) => ({
      name,
      keys: keymap[name] ? [chord(keymap[name])] : [],
      does: editorShortcuts[name].description,
    }));
}

function chord(shortcut: string): Key {
  return {
    text: formatShortcut(shortcut),
    spoken: ariaKeyshortcuts(shortcut).replaceAll("+", " "),
  };
}
