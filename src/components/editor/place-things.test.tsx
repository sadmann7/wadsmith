// @vitest-environment happy-dom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";

import { thingCatalog } from "@/lib/map/catalog";
import { testMap } from "@/lib/map/test-map";

import { ThingInspector } from "./inspector";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

afterEach(() => {
  React.act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

it("opens on the player start while the map has none", () => {
  render({
    ...testMap,
    things: testMap.things.filter((thing) => thing.kind !== "player"),
  });
  expect(shownThings()).toContain(thingCatalog.player.label);
});

it("opens on the enemies once the map has a player start", () => {
  render(testMap);
  expect(shownThings()).toContain(thingCatalog.imp.label);
  expect(shownThings()).not.toContain(thingCatalog.player.label);
});

function render(map: GameMap) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  React.act(() =>
    root?.render(
      <ThingInspector
        map={map}
        things={[]}
        placing={null}
        onChange={() => {}}
        onPlace={() => {}}
      />,
    ),
  );
}

function shownThings() {
  return [...document.querySelectorAll("button[aria-pressed]")].map((button) =>
    button.getAttribute("title"),
  );
}
