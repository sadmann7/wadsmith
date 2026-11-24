const zoomFactor = 1.25;

export const minZoom = zoomFactor ** -10;

const gestureGap = 250;
const notch = 120;
const pixels = 0;

export type WheelInput = Pick<
  WheelEvent,
  "deltaMode" | "deltaX" | "deltaY" | "shiftKey" | "timeStamp"
> & { wheelDeltaY?: number };

export function steppedZoom(zoom: number, steps: number) {
  const level = Math.log(zoom) / Math.log(zoomFactor);
  const from = steps > 0 ? Math.floor(level + 1e-6) : Math.ceil(level - 1e-6);
  return zoomFactor ** (from + steps);
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
