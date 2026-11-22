import { describe, expect, it } from "vitest";

import { FramePacer } from "./frame-pacer";

describe("frame pacer", () => {
  it.each([60, 75, 90, 120, 144, 165, 240, 360])(
    "holds about 60 frames a second at %i Hz",
    (hertz) => {
      for (const jitter of [0, 1, 2]) {
        const rate = framesOnDisplay(hertz, jitter).length / 60;
        expect(rate).toBeGreaterThan(hertz === 60 ? 58 : 59);
        expect(rate).toBeLessThanOrEqual(60.1);
      }
    },
  );

  it.each([120, 144, 240, 360])("spaces frames evenly at %i Hz", (hertz) => {
    const times = framesOnDisplay(hertz, 0);
    const gaps = times.slice(1).map((time, index) => time - times[index]);
    expect(Math.max(...gaps)).toBeLessThan(1000 / 60 + 1000 / hertz + 0.01);
  });

  it("shows every frame a slower display can", () => {
    expect(framesOnDisplay(30, 0).length / 60).toBeCloseTo(30, 0);
  });

  it("does not catch up with a burst after a stall", () => {
    const pacer = new FramePacer();
    pacer.start(0);
    expect(pacer.onDisplay(1000)).toBe(true);
    expect(pacer.onDisplay(1004)).toBe(false);
  });

  it("uses the timer only when the display stops", () => {
    const pacer = new FramePacer();
    pacer.start(0);
    pacer.onDisplay(20);
    expect(pacer.onTimer(40)).toBe(false);
    expect(pacer.onTimer(200)).toBe(true);
  });
});

function framesOnDisplay(hertz: number, jitterMs: number, seconds = 60) {
  const random = randomSource(hertz);
  const pacer = new FramePacer();
  pacer.start(0);
  const times: number[] = [];
  const refreshes = Math.floor(seconds * hertz);
  for (let index = 1; index <= refreshes; index += 1) {
    const now = (index * 1000) / hertz + (random() - 0.5) * 2 * jitterMs;
    if (pacer.onDisplay(now)) times.push(now);
  }
  return times;
}

function randomSource(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}
