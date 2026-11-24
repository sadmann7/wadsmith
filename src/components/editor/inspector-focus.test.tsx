// @vitest-environment happy-dom
import { useShortcut } from "@ui-sdk/react/shortcuts";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";

import { endsFieldEdit, notTyping } from "@/lib/editor/field-keys";
import { updateSector } from "@/lib/map/edit";
import { gradient, gradientEnds } from "@/lib/map/look";
import { surfaceKey } from "@/lib/map/surfaces";
import { testMap } from "@/lib/map/test-map";
import { createFlatAssets } from "@/lib/wad/assets";

import { RoomsInspector } from "./inspector";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ids = ["sector-1", "sector-2", "sector-3"];
const start = updateSector(testMap, "sector-2", { floor: 0 });

let root: Root | null = null;
let shown: GameMap = start;

afterEach(() => {
  React.act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

it("slopes the floors with Shift+G after a ceiling height and Enter", () => {
  render();
  const ceiling = field("Ceiling");
  type(ceiling, "160");
  press(ceiling, "Enter");
  const map = document.querySelector('[aria-roledescription="map editor"]');
  expect(document.activeElement).toBe(map);
  press(document.activeElement ?? document.body, "G", true);
  expect(heights()).toEqual([
    [0, 160],
    [-16, 160],
    [-32, 160],
  ]);
  expect(field("Ceiling").value).toBe("160");
});

it("lets go of a field on Escape and keeps it on Tab", () => {
  render();
  const floor = field("Floor");
  floor.focus();
  press(floor, "Tab");
  expect(document.activeElement).toBe(floor);
  press(floor, "Escape");
  expect(document.activeElement?.getAttribute("aria-roledescription")).toBe(
    "map editor",
  );
});

it("keeps Escape for closing an open list", () => {
  const panel = document.createElement("aside");
  const input = document.createElement("input");
  input.setAttribute("aria-expanded", "true");
  panel.append(input);
  document.body.append(panel);
  const escape = new KeyboardEvent("keydown", { key: "Escape" });
  Object.defineProperty(escape, "target", { value: input });
  expect(endsFieldEdit(escape, panel)).toBe(false);
  const enter = new KeyboardEvent("keydown", { key: "Enter" });
  Object.defineProperty(enter, "target", { value: input });
  expect(endsFieldEdit(enter, panel)).toBe(true);
  expect(endsFieldEdit(enter, document.createElement("aside"))).toBe(false);
  const composing = new KeyboardEvent("keydown", {
    key: "Enter",
    keyCode: 229,
  });
  Object.defineProperty(composing, "target", { value: input });
  expect(endsFieldEdit(composing, panel)).toBe(false);
});

function render() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  React.act(() =>
    root?.render(
      <Harness
        onMap={(map) => {
          shown = map;
        }}
      />,
    ),
  );
}

const floors = ids.map((id) => surfaceKey({ kind: "floor", sector: id }));
const assets = createFlatAssets();

interface HarnessProps {
  onMap: (map: GameMap) => void;
}

function Harness({ onMap }: HarnessProps) {
  const [map, setMap] = React.useState(start);
  const pane = React.useRef<HTMLDivElement>(null);
  const rooms = ids.map(
    (id) => map.sectors.find((room) => room.id === id) ?? map.sectors[0],
  );
  onMap(map);
  useShortcut(
    "shift+g",
    () =>
      setMap((current) => {
        const ends = gradientEnds(current, floors, "height");
        return ends
          ? gradient(current, floors, "height", ends[0], ends[1])
          : current;
      }),
    { when: notTyping },
  );
  return (
    <>
      <div ref={pane} aria-roledescription="map editor" tabIndex={0} />
      <aside
        onKeyDownCapture={(event) => {
          if (endsFieldEdit(event.nativeEvent, event.currentTarget)) {
            pane.current?.focus();
          }
        }}
      >
        <RoomsInspector
          map={map}
          rooms={rooms}
          assets={assets}
          onChange={(patch) =>
            setMap((current) =>
              ids.reduce((next, id) => updateSector(next, id, patch), current),
            )
          }
          onShift={() => {}}
          onDoor={() => {}}
        />
      </aside>
    </>
  );
}

function press(target: Element, key: string, shiftKey = false) {
  React.act(() => {
    target.dispatchEvent(
      trusted(
        new KeyboardEvent("keydown", {
          key,
          code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  });
}

// UI SDK ignores events a page script sends, as a browser marks them.
function trusted<T extends Event>(event: T) {
  Object.defineProperty(event, "isTrusted", { value: true });
  return event;
}

function type(field: HTMLInputElement, text: string) {
  React.act(() => {
    field.focus();
    // React tracks the value it set, so text goes in through the DOM's setter.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(field, text);
    field.dispatchEvent(
      trusted(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text,
        }),
      ),
    );
  });
}

function field(label: string) {
  const found = document.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  );
  if (!found) throw new Error(`No ${label} field`);
  return found;
}

const heights = () =>
  ids.map((id) => {
    const room = shown.sectors.find((item) => item.id === id);
    return [room?.floor, room?.ceiling];
  });
