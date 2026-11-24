import { expect, it } from "vitest";

import { defaultLayout, parseLayout, serializeLayout } from "./layout";

it("starts with the player view docked and open", () => {
  expect(parseLayout(null)).toEqual(defaultLayout);
  expect(defaultLayout).toMatchObject({ dock: true, isDockCollapsed: false });
});

it("remembers a collapsed player view", () => {
  const layout = { ...defaultLayout, view: "map" as const };
  const collapsed = { ...layout, isDockCollapsed: true };
  expect(parseLayout(serializeLayout(collapsed))).toEqual(collapsed);
  expect(parseLayout(serializeLayout(layout))).toEqual(layout);
});

it("keeps layouts saved before the player view could collapse", () => {
  expect(
    parseLayout(
      JSON.stringify({ view: "split", sizes: [40, 60], dock: false }),
    ),
  ).toEqual({
    view: "split",
    sizes: [40, 60],
    dock: false,
    isDockCollapsed: false,
  });
});

it("falls back to the defaults for broken saves", () => {
  expect(parseLayout("{")).toEqual(defaultLayout);
  expect(parseLayout("3")).toEqual(defaultLayout);
  expect(
    parseLayout(
      JSON.stringify({ view: "wide", sizes: [1], dockCollapsed: "yes" }),
    ),
  ).toEqual(defaultLayout);
});
