export type MouseMode = "idle" | "capturing" | "locked" | "released" | "denied";

export interface MouseCapture {
  mode: MouseMode;
  hasLocked: boolean;
}

type MouseEvent =
  | "request"
  | "locked"
  | "failed"
  | "lost"
  | "suspended"
  | "cancelled"
  | "keyboard";

export const initialMouseCapture: MouseCapture = {
  mode: "idle",
  hasLocked: false,
};
// Chrome refuses to lock the pointer again right after Escape released it.
const relockDelayMs = 1300;
const primaryButton = 1;

// The cooldown belongs to the page, so it outlives a restarted game.
let pointerReleasedAt = -Infinity;

export function notePointerReleased(now: number) {
  pointerReleasedAt = now;
}

export function msSincePointerRelease(now: number) {
  return now - pointerReleasedAt;
}

export function relockWait(now: number) {
  return Math.max(0, relockDelayMs - msSincePointerRelease(now));
}

export function nextMouseCapture(
  capture: MouseCapture,
  event: MouseEvent,
): MouseCapture {
  const { mode, hasLocked } = capture;
  switch (event) {
    case "request":
      return mode === "denied" || mode === "locked"
        ? capture
        : { mode: "capturing", hasLocked };
    case "locked":
      return { mode: "locked", hasLocked: true };
    // A failure after the mouse has worked is the browser's short cooldown
    // following Escape, so another click can still succeed. A denied page keeps
    // click to fire, and each later click asks again.
    case "failed":
      return { mode: hasLocked ? "released" : "denied", hasLocked };
    case "lost":
      return mode === "locked" || mode === "capturing"
        ? { mode: hasLocked ? "released" : "idle", hasLocked }
        : capture;
    case "suspended":
      return mode === "locked" ? { mode: "idle", hasLocked } : capture;
    case "cancelled":
      return mode === "capturing"
        ? { mode: hasLocked ? "released" : "idle", hasLocked }
        : capture;
    case "keyboard":
      return mode === "released" ? { mode: "idle", hasLocked } : capture;
  }
}

export function clickFires({ mode }: MouseCapture) {
  return mode === "locked" || mode === "denied";
}

export function wantsFire(
  capture: MouseCapture,
  buttons: number,
  blocked: boolean,
) {
  return clickFires(capture) && !blocked && (buttons & primaryButton) !== 0;
}

// Tracks the left button from each pointer event's held buttons, because a
// second button turns presses and releases of the first into plain moves.
export class MouseFire {
  private ignoringHeldButton = false;

  // The click that captures the mouse must not fire, even if the lock arrives
  // while the button is still down.
  ignoreUntilReleased() {
    this.ignoringHeldButton = true;
  }

  update(capture: MouseCapture, buttons: number, blocked: boolean) {
    if (this.ignoringHeldButton) {
      if ((buttons & primaryButton) !== 0) return false;
      this.ignoringHeldButton = false;
    }
    return wantsFire(capture, buttons, blocked);
  }
}

export function holdsGame({ mode, hasLocked }: MouseCapture) {
  return mode === "released" || (mode === "capturing" && hasLocked);
}
