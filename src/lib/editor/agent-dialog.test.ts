import { describe, expect, it } from "vitest";

import { dialogOpenError } from "./agent-actions";

describe("a map action while a dialog is open", () => {
  it("names the dialog and asks for the person", () => {
    expect(
      dialogOpenError("listRooms", [
        { component: "map-editor", label: "Map" },
        { component: "dialog", label: "Keep online", open: true },
      ]),
    ).toBe(
      'The "Keep online" dialog is open, so the map takes no listRooms until it closes. Ask the person to finish or close it, then run listRooms again.',
    );
  });

  it("names the topmost of several open dialogs", () => {
    expect(
      dialogOpenError("addRoom", [
        { component: "dialog", label: "Map settings", open: true },
        { component: "alert-dialog", open: true },
      ]),
    ).toBe(
      "A dialog is open, so the map takes no addRoom until it closes. Ask the person to finish or close it, then run addRoom again.",
    );
  });

  it("names an open drawer", () => {
    expect(
      dialogOpenError("listRooms", [
        { component: "drawer", label: "Navigation", open: true },
      ]),
    ).toMatch(/^The "Navigation" drawer is open/);
  });

  it("leaves the error alone when nothing modal is open", () => {
    expect(
      dialogOpenError("listRooms", [
        { component: "dialog", label: "Map settings", open: false },
        { component: "select", label: "Game", open: true },
      ]),
    ).toBeNull();
  });
});
