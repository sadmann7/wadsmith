import { describe, expect, it } from "vitest";

import {
  clickFires,
  holdsGame,
  initialMouseCapture,
  type MouseCapture,
  MouseFire,
  nextMouseCapture,
  notePointerReleased,
  relockWait,
  wantsFire,
} from "./mouse-capture";

describe("mouse capture", () => {
  it("uses the first click to capture rather than fire", () => {
    expect(clickFires(initialMouseCapture)).toBe(false);
    expect(after("request").mode).toBe("capturing");
    expect(clickFires(after("request"))).toBe(false);
    expect(clickFires(after("request", "locked"))).toBe(true);
  });

  it("holds the game when the browser releases the mouse", () => {
    const released = after("request", "locked", "lost");
    expect(released.mode).toBe("released");
    expect(holdsGame(released)).toBe(true);
    expect(clickFires(released)).toBe(false);
  });

  it("keeps the game held until a new capture succeeds", () => {
    const retrying = after("request", "locked", "lost", "request");
    expect(holdsGame(retrying)).toBe(true);
    expect(holdsGame(nextMouseCapture(retrying, "locked"))).toBe(false);
  });

  it("falls back to click to fire when capture is denied", () => {
    const denied = after("request", "failed");
    expect(denied.mode).toBe("denied");
    expect(clickFires(denied)).toBe(true);
    expect(holdsGame(denied)).toBe(false);
    expect(nextMouseCapture(denied, "request")).toBe(denied);
  });

  it("allows another try after the cooldown following Escape", () => {
    const refused = after("request", "locked", "lost", "request", "failed");
    expect(refused.mode).toBe("released");
  });

  it("does not hold the game for a release the page asked for", () => {
    const suspended = after("request", "locked", "suspended");
    expect(suspended.mode).toBe("idle");
    expect(holdsGame(suspended)).toBe(false);
  });

  it("lets the keyboard resume without the mouse", () => {
    const resumed = after("request", "locked", "lost", "keyboard");
    expect(resumed.mode).toBe("idle");
    expect(holdsGame(resumed)).toBe(false);
  });

  it("captures from a denied state when a later click succeeds", () => {
    const denied = after("request", "failed");
    expect(nextMouseCapture(denied, "locked").mode).toBe("locked");
    expect(nextMouseCapture(denied, "failed").mode).toBe("denied");
  });

  it("follows the left button through chorded presses", () => {
    const locked = after("request", "locked");
    const left = 1;
    const right = 2;
    expect(wantsFire(locked, left, false)).toBe(true);
    expect(wantsFire(locked, left | right, false)).toBe(true);
    expect(wantsFire(locked, right, false)).toBe(false);
    expect(wantsFire(locked, 0, false)).toBe(false);
    expect(wantsFire(locked, left, true)).toBe(false);
    expect(wantsFire(initialMouseCapture, left, false)).toBe(false);
    expect(wantsFire(after("request", "failed"), left, false)).toBe(true);
  });

  it("keeps the pointer cooldown when a restarted game starts fresh", () => {
    const beforeRestart = after("request", "locked", "lost");
    expect(beforeRestart.hasLocked).toBe(true);
    notePointerReleased(10_000);
    const restarted = nextMouseCapture(initialMouseCapture, "request");
    expect(restarted).toEqual({ mode: "capturing", hasLocked: false });
    expect(relockWait(10_200)).toBe(1100);
    expect(relockWait(11_300)).toBe(0);
  });

  it("does not fire from the click that captures the mouse", () => {
    const fire = new MouseFire();
    const locked = after("request", "locked");
    fire.ignoreUntilReleased();
    expect(fire.update(locked, 1, false)).toBe(false);
    expect(fire.update(locked, 3, false)).toBe(false);
    expect(fire.update(locked, 0, false)).toBe(false);
    expect(fire.update(locked, 1, false)).toBe(true);
  });

  it("follows a chord where the left button lifts first", () => {
    const fire = new MouseFire();
    const locked = after("request", "locked");
    expect(fire.update(locked, 1, false)).toBe(true);
    expect(fire.update(locked, 3, false)).toBe(true);
    expect(fire.update(locked, 2, false)).toBe(false);
    expect(fire.update(locked, 0, false)).toBe(false);
  });

  it("gives up a capture that is no longer wanted", () => {
    expect(after("request", "cancelled").mode).toBe("idle");
    expect(
      after("request", "locked", "lost", "request", "cancelled").mode,
    ).toBe("released");
    expect(after("request", "locked", "cancelled").mode).toBe("locked");
  });
});

function after(...events: Parameters<typeof nextMouseCapture>[1][]) {
  return events.reduce<MouseCapture>(nextMouseCapture, initialMouseCapture);
}
