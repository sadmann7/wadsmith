// @vitest-environment happy-dom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import { LightSetting } from "./light-setting";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
let changes: number[];

beforeEach(() => {
  changes = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  React.act(() => root.unmount());
  host.remove();
});

it("shows the light level in a field beside the slider", () => {
  render(160);
  expect(field().value).toBe("160");
  expect(slider().value).toBe("160");
  expect(button("Lower Light level")).toBeTruthy();
  expect(button("Raise Light level")).toBeTruthy();
});

it("steps by 16 with the buttons and by 1 with Shift", () => {
  render(160);
  press(button("Raise Light level"));
  expect(field().value).toBe("176");
  press(button("Lower Light level"));
  press(button("Lower Light level"));
  expect(field().value).toBe("144");
  press(button("Raise Light level"), true);
  expect(field().value).toBe("145");
  expect(slider().value).toBe("145");
});

it("steps by 16 with the arrow keys and by 1 with Shift", () => {
  render(160);
  key(field(), "ArrowUp");
  expect(field().value).toBe("176");
  key(field(), "ArrowDown", true);
  expect(field().value).toBe("175");
  key(field(), "PageDown");
  expect(field().value).toBe("159");
});

it("keeps stepping inside 0 to 255", () => {
  render(250);
  press(button("Raise Light level"));
  expect(field().value).toBe("255");
  render(8);
  key(field(), "ArrowDown");
  expect(field().value).toBe("0");
});

it("takes a typed level as it is", () => {
  render(160);
  type("203");
  expect(changes.at(-1)).toBe(203);
  expect(field().value).toBe("203");
  expect(slider().value).toBe("203");
  type("300");
  expect(changes.at(-1)).toBe(255);
});

it("focuses the slider when its thumb is clicked", () => {
  render(160);
  const thumb = slider().closest<HTMLElement>('[data-slot="slider-thumb"]');
  React.act(() => thumb?.click());
  expect(document.activeElement).toBe(slider());
});

function render(initial: number) {
  React.act(() => root.render(<Harness key={initial} initial={initial} />));
}

function type(text: string) {
  const input = field();
  React.act(() => {
    input.focus();
    // React tracks the value it set, so only the prototype's setter makes
    // the change look typed.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, text);
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );
  });
  key(input, "Enter");
}

function press(target: HTMLElement, shiftKey = false) {
  React.act(() => {
    const init = { bubbles: true, cancelable: true, button: 0, shiftKey };
    const pointer = { ...init, pointerId: 1 };
    target.dispatchEvent(new PointerEvent("pointerdown", pointer));
    target.dispatchEvent(new MouseEvent("mousedown", init));
    target.dispatchEvent(new PointerEvent("pointerup", pointer));
    target.dispatchEvent(new MouseEvent("mouseup", init));
    target.dispatchEvent(new MouseEvent("click", init));
  });
}

function key(target: HTMLElement, name: string, shiftKey = false) {
  React.act(() => {
    const init = { key: name, bubbles: true, cancelable: true, shiftKey };
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
  });
}

function button(name: string) {
  const found = host.querySelector<HTMLElement>(`[aria-label="${name}"]`);
  if (!found) throw new Error(`No ${name} button.`);
  return found;
}

function slider() {
  const input = host.querySelector<HTMLInputElement>(
    'input[type="range"][aria-label="Light level"]',
  );
  if (!input) throw new Error("No light level slider.");
  return input;
}

function field() {
  const input = host.querySelector<HTMLInputElement>(
    'input[aria-label="Light level"]:not([type="range"])',
  );
  if (!input) throw new Error("No light level field.");
  return input;
}

interface HarnessProps {
  initial: number;
}

function Harness({ initial }: HarnessProps) {
  const [light, setLight] = React.useState(initial);
  return (
    <LightSetting
      value={light}
      onChange={(next) => {
        changes.push(next);
        setLight(next);
      }}
    />
  );
}
