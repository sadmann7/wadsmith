// What one notch of a mouse wheel turns by, in pixels. A slow click of a
// wheel is only a few pixels on macOS, so the first turn after a pause this
// long counts as a notch whatever its size.
const wheelNotch = 100;
const wheelPause = 80;
// How many pixels a wheel's turn is worth in each of its delta modes: pixels,
// lines and pages.
const wheelUnits = [1, wheelNotch / 3, wheelNotch];

export interface WheelTurns {
  // What has turned since the last whole notch, and when the wheel last moved.
  sum: number;
  at: number;
}

// Adds a wheel event's turn to the turns so far and counts the whole notches
// it makes. A trackpad sends many small turns, so they add up.
export function countNotches(
  turns: WheelTurns,
  delta: number,
  mode: number,
  time: number,
): WheelTurns & { notches: number } {
  const turn = delta * (wheelUnits[mode] ?? 1);
  if (turn === 0) return { ...turns, notches: 0 };
  const sum = turns.sum + turn;
  const notches = Math.trunc(sum / wheelNotch);
  if (notches === 0 && time - turns.at > wheelPause) {
    return { sum: 0, at: time, notches: Math.sign(turn) };
  }
  return { sum: sum - notches * wheelNotch, at: time, notches };
}
