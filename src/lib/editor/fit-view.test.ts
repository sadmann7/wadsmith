import { describe, expect, it } from "vitest";

import { type Box, type FitView, fitView } from "./fit-view";

const options = { padding: 56, minZoom: 0.1, maxZoom: 4 };
const surface = { width: 1000, height: 800 };
const card = { left: 12, top: 633, right: 392, bottom: 788 };
const dock = { left: 704, top: 598, right: 988, bottom: 788 };

function onScreen(rect: Box, view: FitView): Box {
  return {
    left: view.x + rect.left * view.zoom,
    top: view.y + rect.top * view.zoom,
    right: view.x + rect.right * view.zoom,
    bottom: view.y + rect.bottom * view.zoom,
  };
}

function getIsClear(a: Box, b: Box) {
  return (
    a.right <= b.left ||
    b.right <= a.left ||
    a.bottom <= b.top ||
    b.bottom <= a.top
  );
}

describe("fitView", () => {
  it("keeps the plain fit when the map already clears the card", () => {
    const rect = { left: 0, top: 0, right: 2000, bottom: 400 };
    expect(fitView(rect, surface, options, [card])).toEqual(
      fitView(rect, surface, options),
    );
  });

  it("moves a map the card would cover out from under it", () => {
    const rect = { left: 0, top: 0, right: 1000, bottom: 1000 };
    const plain = fitView(rect, surface, options);
    expect(getIsClear(onScreen(rect, plain), card)).toBe(false);

    const view = fitView(rect, surface, options, [card]);
    expect(getIsClear(onScreen(rect, view), card)).toBe(true);
    expect(view.zoom).toBeCloseTo((633 - 112) / 1000);
  });

  it("keeps clear of a card and a dock in both bottom corners", () => {
    const rect = { left: 0, top: 0, right: 1000, bottom: 1000 };
    const view = fitView(rect, surface, options, [card, dock]);
    const shown = onScreen(rect, view);
    expect(getIsClear(shown, card)).toBe(true);
    expect(getIsClear(shown, dock)).toBe(true);
  });

  it("ignores an overlay outside the surface", () => {
    const rect = { left: 0, top: 0, right: 1000, bottom: 1000 };
    const away = { left: 1200, top: 0, right: 1400, bottom: 200 };
    expect(fitView(rect, surface, options, [away])).toEqual(
      fitView(rect, surface, options),
    );
  });

  it("falls back to the plain fit when no clear part has room", () => {
    const small = { width: 300, height: 200 };
    const rect = { left: 0, top: 0, right: 1000, bottom: 1000 };
    const cover = { left: 0, top: 0, right: 300, bottom: 200 };
    expect(fitView(rect, small, options, [cover])).toEqual(
      fitView(rect, small, options),
    );
  });
});
