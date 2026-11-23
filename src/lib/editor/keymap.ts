import { createLocalStorage } from "@ui-sdk/core";

import { type EditorShortcut, editorShortcuts } from "./shortcuts";

export type KeyPreset = "wadsmith" | "udb";

export interface SavedKeys {
  preset: KeyPreset;
  keys: Partial<Record<EditorShortcut, string>>;
}

export type Keymap = Record<EditorShortcut, string>;

export const keyPresets: Record<
  KeyPreset,
  { label: string; keys: Partial<Keymap> }
> = {
  wadsmith: { label: "Wadsmith", keys: {} },
  udb: {
    label: "Ultimate Doom Builder",
    keys: {
      draw: "mod+d",
      drawLine: "",
      duplicate: "",
      makeDoor: "shift+d",
      snap: "",
      lightGradient: "g",
      floorGradient: "mod+g",
      ceilingGradient: "shift+g",
      find: "f3",
      redo: "mod+y",
      look: "",
      clearSelection: "c",
    },
  },
};

export const defaultKeys: SavedKeys = { preset: "wadsmith", keys: {} };

// Keys the browser keeps for itself, which a page never hears, and the keys
// copy, cut and paste need.
const reservedKeys = new Set([
  "mod+n",
  "mod+t",
  "mod+w",
  "mod+q",
  "mod+c",
  "mod+x",
  "mod+v",
]);
// Keys the map and the sheet handle themselves, some whatever else is held.
const ownedKeys = new Set([
  "tab",
  "escape",
  "enter",
  "space",
  "backspace",
  "delete",
  "insert",
  "home",
  "end",
  "pageup",
  "pagedown",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
]);
const modifierKeys = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph"]);

const savedKeys = createLocalStorage("wadsmith:keys");
let cached: { text: string | null; keys: SavedKeys } = {
  text: null,
  keys: defaultKeys,
};

export function resolveKeys(saved: SavedKeys): Keymap {
  const preset = keyPresets[saved.preset].keys;
  const names = Object.keys(editorShortcuts) as EditorShortcut[];
  return Object.fromEntries(
    names.map((name) => [
      name,
      saved.keys[name] ?? preset[name] ?? editorShortcuts[name].keys,
    ]),
  ) as Keymap;
}

export function parseSavedKeys(text: string | null): SavedKeys {
  if (!text) return defaultKeys;
  try {
    const value = JSON.parse(text) as Partial<SavedKeys>;
    const preset = value.preset === "udb" ? "udb" : "wadsmith";
    const keys: SavedKeys["keys"] = {};
    for (const [name, bound] of Object.entries(value.keys ?? {})) {
      if (name in editorShortcuts && typeof bound === "string") {
        keys[name as EditorShortcut] = bound;
      }
    }
    return { preset, keys };
  } catch {
    return defaultKeys;
  }
}

// Gives an action its keys, and takes them from any other action that had
// them. The actions that lost them come back too.
export function bindKeys(saved: SavedKeys, name: EditorShortcut, keys: string) {
  const current = resolveKeys(saved);
  const taken = (Object.keys(current) as EditorShortcut[]).filter(
    (other) => other !== name && keys !== "" && current[other] === keys,
  );
  const next: SavedKeys = {
    preset: saved.preset,
    keys: { ...saved.keys, [name]: keys },
  };
  for (const other of taken) next.keys[other] = "";
  return { saved: next, taken };
}

// The shortcut a key press makes, or a reason it can't be one. A shortcut
// matches the character typed, so the key is read the same way, and only a
// letter or digit typed with Option falls back to the key's position.
export function keysFromEvent(
  event: Pick<
    KeyboardEvent,
    "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
  apple: boolean,
): { keys: string } | { problem: string } | null {
  if (modifierKeys.has(event.key)) return null;
  const typed = event.key.length === 1 ? event.key.toLowerCase() : null;
  const position = /^(?:Key([A-Z])|Digit(\d))$/.exec(event.code);
  const key =
    typed === " "
      ? "space"
      : typed && /^[\x21-\x7e]$/.test(typed)
        ? typed
        : typed
          ? (position?.[1]?.toLowerCase() ?? position?.[2] ?? null)
          : /^[A-Z][A-Za-z0-9]+$/.test(event.key) && event.key !== "Dead"
            ? event.key.toLowerCase()
            : null;
  if (!key || key === "+" || key === "unidentified") {
    return { problem: "That key can't be a shortcut." };
  }
  if (ownedKeys.has(key)) {
    return { problem: "The map already uses that key." };
  }
  const parts = [
    ...((apple ? event.metaKey : event.ctrlKey) ? ["mod"] : []),
    ...(apple && event.ctrlKey ? ["ctrl"] : []),
    ...(!apple && event.metaKey ? ["meta"] : []),
    ...(event.altKey ? ["alt"] : []),
    ...(event.shiftKey ? ["shift"] : []),
    key,
  ];
  const keys = parts.join("+");
  if (reservedKeys.has(keys)) {
    return { problem: "The browser keeps that key for itself." };
  }
  return { keys };
}

export function getSavedKeys() {
  const text = savedKeys.get();
  if (text !== cached.text) cached = { text, keys: parseSavedKeys(text) };
  return cached.keys;
}

export function saveKeys(saved: SavedKeys) {
  savedKeys.set(JSON.stringify(saved));
}

export function subscribeKeys(listener: () => void) {
  return savedKeys.subscribe(listener);
}

export function currentKeys() {
  return resolveKeys(getSavedKeys());
}
