// @vitest-environment happy-dom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { SceneRenderer } from "@/lib/preview/scene-renderer";
import type { SpeedTestClock } from "@/lib/preview/speed-test";

import { testMap } from "@/lib/map/test-map";
import { createFlatAssets } from "@/lib/wad/assets";

import { SpeedTestDialog } from "./speed-test-dialog";

const renderers = vi.hoisted(() => ({ made: [] as { destroyed: boolean }[] }));

vi.mock("@/lib/preview/scene-renderer", () => ({
  createSceneRenderer: (_canvas: unknown, kind: "columns" | "webgl") => {
    const made = { destroyed: false };
    renderers.made.push(made);
    const renderer: SceneRenderer = {
      kind,
      width: 640,
      height: 400,
      focal: 320,
      sizeFor: () => ({ width: 640, height: 400 }),
      resize: () => undefined,
      render: () => undefined,
      surfaceAt: () => ({ key: null, distance: Infinity }),
      surfaceCounts: () => new Map(),
      destroy() {
        made.destroyed = true;
      },
    };
    return renderer;
  },
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const savedRenderer = "wadsmith:scene-renderer";

let root: Root;
let host: HTMLElement;
let closed: number;

beforeEach(() => {
  renderers.made = [];
  closed = 0;
  localStorage.setItem(savedRenderer, "webgl");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  React.act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

it("runs both renderers and shows the results to copy", async () => {
  const writes: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => void writes.push(text) },
  });
  const before = structuredClone(testMap);
  show(testClock().clock);
  await React.act(async () => {
    button("Start").click();
    for (let tries = 0; tries < 50; tries += 1) await settle();
  });
  const results = document.querySelector('[aria-label="Results"]');
  expect(results?.textContent).toContain("Map: Bundled map");
  expect(results?.textContent).toContain("Column renderer");
  expect(results?.textContent).toContain("WebGL renderer");
  expect(renderers.made).toEqual([{ destroyed: true }, { destroyed: true }]);
  await React.act(async () => button("Copy results").click());
  expect(writes).toEqual([results?.textContent]);
  expect(button("Copied")).toBeTruthy();
  expect(localStorage.getItem(savedRenderer)).toBe("webgl");
  expect(testMap).toEqual(before);
});

it("goes back to the start when cancelled, destroying the renderer", async () => {
  const { clock, held, release } = testClock(50);
  show(clock);
  await React.act(async () => {
    button("Start").click();
    await held;
  });
  expect(document.querySelector('[role="status"]')?.textContent).toContain(
    "column renderer",
  );
  await React.act(async () => {
    button("Cancel").click();
    release();
    await settle();
  });
  expect(button("Start")).toBeTruthy();
  expect(renderers.made).toEqual([{ destroyed: true }]);
  expect(localStorage.getItem(savedRenderer)).toBe("webgl");
  expect(closed).toBe(0);
});

const assets = createFlatAssets();

function show(clock: SpeedTestClock) {
  React.act(() =>
    root.render(
      <SpeedTestDialog
        map={testMap}
        mapName="Test map"
        assets={assets}
        sky="SKY1"
        clock={clock}
        loadScene={async () => ({
          name: "Bundled map",
          map: testMap,
          assets,
          sky: "SKY1",
        })}
        onClose={() => {
          closed += 1;
        }}
      />,
    ),
  );
}

// A clock whose frames come at once, until a frame given to hold at.
function testClock(holdAt = Infinity) {
  let frames = 0;
  let release = () => {};
  let reached = () => {};
  const held = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const clock: SpeedTestClock = {
    frame: () => {
      frames += 1;
      if (frames !== holdAt) return Promise.resolve(frames * 16);
      reached();
      return new Promise((resolve) => {
        release = () => resolve(frames * 16);
      });
    },
    now: () => frames * 16,
  };
  return { clock, held, release: () => release() };
}

function button(name: string) {
  const found = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === name,
  );
  if (!found) throw new Error(`No ${name} button.`);
  return found;
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
