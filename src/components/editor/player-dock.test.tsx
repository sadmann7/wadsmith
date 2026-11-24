// @vitest-environment happy-dom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { PlayerDock } from "./player-dock";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

afterEach(() => {
  React.act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

it("shows the player view under an expanded bar", () => {
  const { container, bar } = renderDock(false);
  expect(bar.textContent).toBe("Player view");
  expect(bar.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector("[data-testid=scene]")).not.toBeNull();
});

it("collapses to the bar when the bar is pressed", () => {
  const { bar, onCollapsedChange } = renderDock(false);
  React.act(() => bar.click());
  expect(onCollapsedChange).toHaveBeenCalledWith(true);
});

it("leaves only the bar while collapsed, and expands from it", () => {
  const { container, bar, onCollapsedChange } = renderDock(true);
  expect(bar.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector("[data-testid=scene]")).toBeNull();
  React.act(() => bar.click());
  expect(onCollapsedChange).toHaveBeenCalledWith(false);
});

function renderDock(isCollapsed: boolean) {
  const onCollapsedChange = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  React.act(() =>
    root?.render(
      <PlayerDock
        isCollapsed={isCollapsed}
        onCollapsedChange={onCollapsedChange}
      >
        <canvas data-testid="scene" />
      </PlayerDock>,
    ),
  );
  const bar = container.querySelector("button");
  if (!bar) throw new Error("The dock has no bar to press.");
  return { container, bar, onCollapsedChange };
}
