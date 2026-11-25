// @vitest-environment happy-dom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import type { Transform } from "@/lib/map/fragment";

import { TransformDialog } from "./transform-dialog";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
let applied: Transform[][];

beforeEach(() => {
  applied = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  React.act(() =>
    root.render(
      <TransformDialog
        onApply={(steps) => applied.push(steps)}
        onClose={() => undefined}
      />,
    ),
  );
});

afterEach(() => {
  React.act(() => root.unmount());
  host.remove();
});

it("resizes by a typed size as it is", () => {
  type(field("Size, in percent"), "105");
  expect(field("Size, in percent").value).toBe("105");
  apply();
  expect(applied).toEqual([[{ kind: "scale", factor: 1.05 }]]);
});

it("steps the size by 10, and by 1 with Shift", () => {
  type(field("Size, in percent"), "105");
  press(button("Raise Size, in percent"));
  expect(field("Size, in percent").value).toBe("115");
  press(button("Lower Size, in percent"), true);
  expect(field("Size, in percent").value).toBe("114");
  key(field("Size, in percent"), "ArrowDown");
  expect(field("Size, in percent").value).toBe("104");
});

it("turns by a typed angle as it is", () => {
  type(field("Turn right, in degrees"), "10");
  expect(field("Turn right, in degrees").value).toBe("10");
  apply();
  expect(applied).toEqual([[{ kind: "rotate", degrees: 10 }]]);
});

it("steps the turn by 15, and by 1 with Shift", () => {
  type(field("Turn right, in degrees"), "10");
  press(button("Raise Turn right, in degrees"));
  expect(field("Turn right, in degrees").value).toBe("25");
  press(button("Lower Turn right, in degrees"), true);
  expect(field("Turn right, in degrees").value).toBe("24");
  key(field("Turn right, in degrees"), "ArrowDown");
  expect(field("Turn right, in degrees").value).toBe("9");
});

function apply() {
  const submit = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === "Apply",
  );
  if (!submit) throw new Error("No Apply button.");
  React.act(() => submit.click());
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
  const found = document.querySelector<HTMLElement>(`[aria-label="${name}"]`);
  if (!found) throw new Error(`No ${name} button.`);
  return found;
}

function type(input: HTMLInputElement, text: string) {
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

function field(name: string) {
  const input = document.querySelector<HTMLInputElement>(
    `input[aria-label="${name}"]`,
  );
  if (!input) throw new Error(`No ${name} field.`);
  return input;
}
