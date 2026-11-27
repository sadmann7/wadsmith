import type { Point } from "@/lib/map/types";

export interface View {
  x: number;
  y: number;
  zoom: number;
}

const zoomLevels = [
  0.01,
  0.025,
  0.05,
  0.1,
  0.25,
  1 / 3,
  0.5,
  2 / 3,
  1,
  1.5,
  2,
  3,
  4,
];

export const maxZoom = 4;
export const minZoom = 0.005;

// A step smaller than this reads as no change at all.
const visibleStep = 1.1;
const furthestOut = 0.25;
const restZoom = 1.05;
const pinchDelta = 10;
const pinchFrame = 16;
const pinchBudget = 0.2;

const gestureGap = 250;
const notch = 120;
const pixels = 0;

export type WheelInput = Pick<
  WheelEvent,
  "deltaMode" | "deltaX" | "deltaY" | "shiftKey" | "timeStamp"
> & { wheelDeltaY?: number };

export function steppedZoom(
  zoom: number,
  steps: number,
  min = minZoom,
  max = maxZoom,
) {
  let next = zoom;
  for (let step = 0; step < Math.abs(steps); step++) {
    next =
      steps > 0
        ? Math.min(
            max,
            zoomLevels.find((level) => level >= next * visibleStep) ?? max,
          )
        : Math.max(
            min,
            zoomLevels.findLast((level) => level <= next / visibleStep) ?? min,
          );
  }
  return next;
}

export function furthestZoom(fitZoom: number) {
  return Math.min(furthestOut, Math.max(minZoom, fitZoom / 2));
}

export function restingZoom(zoom: number) {
  return Math.abs(Math.log(zoom)) < Math.log(restZoom) ? 1 : zoom;
}

export function zoomedView(view: View, zoom: number, at: Point): View {
  const k = zoom / view.zoom;
  return {
    x: at.x - (at.x - view.x) * k,
    y: at.y - (at.y - view.y) * k,
    zoom,
  };
}

// Zooms around the one screen point both views share, so a step around the
// pointer keeps that point still the whole way.
export function viewBetween(from: View, to: View, t: number): View {
  const zoom = from.zoom * (to.zoom / from.zoom) ** t;
  if (Math.abs(to.zoom - from.zoom) < 1e-9) {
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      zoom,
    };
  }
  const span = to.zoom - from.zoom;
  const at = {
    x: (from.x * to.zoom - to.x * from.zoom) / span,
    y: (from.y * to.zoom - to.y * from.zoom) / span,
  };
  return zoomedView(from, zoom, at);
}

export type PinchInput = Pick<WheelEvent, "deltaY" | "timeStamp">;

// Each event's change is capped and so is a frame's total, so one flick of
// a trackpad can't throw the zoom from end to end.
export function createPinchZoom() {
  let frameStart = Number.NEGATIVE_INFINITY;
  let spent = 0;
  return (event: PinchInput, unit = 1): number => {
    if (event.timeStamp - frameStart >= pinchFrame) {
      frameStart = event.timeStamp;
      spent = 0;
    }
    const delta = Math.max(
      -pinchDelta,
      Math.min(pinchDelta, event.deltaY * unit),
    );
    const wanted = -delta * 0.01;
    const left = pinchBudget - spent;
    const change = Math.max(-left, Math.min(left, wanted));
    spent += Math.abs(change);
    return Math.exp(change);
  };
}

// Zoom in quarter octaves, rounded up, so the canvas renders again only when
// the zoom crosses a step.
export function zoomStep(zoom: number) {
  return 2 ** (Math.ceil(Math.log2(zoom) * 4) / 4);
}

// Each scroll keeps the kind its first event had, so a trackpad's stray
// event never zooms it and a fast mouse wheel never pans.
export function createWheelZoom() {
  let kind: "mouse" | "trackpad" | null = null;
  let last = Number.NEGATIVE_INFINITY;
  let pending = 0;
  return (event: WheelInput): number | null => {
    // Firefox reports lines only to a page that reads `deltaMode` first.
    const mode = event.deltaMode;
    if (event.timeStamp - last > gestureGap) {
      kind = null;
      pending = 0;
    }
    last = event.timeStamp;
    kind ??= getIsMouseWheel(event, mode) ? "mouse" : "trackpad";
    if (kind === "trackpad" || event.shiftKey || event.deltaY === 0) {
      return null;
    }
    pending +=
      mode === pixels
        ? (event.wheelDeltaY ?? 0) / notch
        : lineSteps(event.deltaY);
    const steps = Math.trunc(pending) || 0;
    pending -= steps;
    return steps;
  };
}

// A mouse wheel turns in whole notches, which Firefox reports as lines and
// the legacy `wheelDeltaY` as multiples of 120. Chrome and Safari report a
// trackpad's `wheelDeltaY` as about -3 × `deltaY`, which can also be 120.
function getIsMouseWheel(event: WheelInput, mode: number) {
  if (event.deltaX !== 0) return false;
  if (mode !== pixels) return Number.isInteger(event.deltaY);
  const legacy = event.wheelDeltaY ?? 0;
  return (
    legacy !== 0 &&
    legacy % notch === 0 &&
    Math.abs(legacy + 3 * event.deltaY) >= 3
  );
}

function lineSteps(lines: number) {
  if (!Number.isInteger(lines)) return -lines / 3;
  return -Math.sign(lines) * Math.max(1, Math.round(Math.abs(lines) / 3));
}
