import { describe, expect, it } from "vitest";

import { createWheelZoom, steppedZoom, type WheelInput } from "./zoom";

const mouseNotch = { deltaY: 100, wheelDeltaY: -120 };

describe("stepped zoom", () => {
  it("steps by a quarter from 100%", () => {
    expect(steppedZoom(1, 1)).toBeCloseTo(1.25);
    expect(steppedZoom(1, -1)).toBeCloseTo(0.8);
    expect(steppedZoom(1.25, -1)).toBeCloseTo(1);
    expect(steppedZoom(0.8, -2)).toBeCloseTo(0.512);
  });

  it("lands a zoom between steps on the next step its way", () => {
    expect(steppedZoom(0.9, 1)).toBeCloseTo(1);
    expect(steppedZoom(0.9, -1)).toBeCloseTo(0.8);
    expect(steppedZoom(0.37, 1)).toBeCloseTo(0.4096);
  });
});

describe("wheel zoom", () => {
  it("zooms a notch at a time for a mouse wheel", () => {
    const read = createWheelZoom();
    expect(read(wheel(mouseNotch))).toBe(-1);
    expect(read(wheel({ deltaY: -100, wheelDeltaY: 120, timeStamp: 50 }))).toBe(
      1,
    );
    expect(read(wheel({ deltaY: 200, wheelDeltaY: -240, timeStamp: 90 }))).toBe(
      -2,
    );
  });

  it("zooms for a wheel that scrolls by lines", () => {
    const read = createWheelZoom();
    expect(read(wheel({ deltaMode: 1, deltaY: 3 }))).toBe(-1);
    expect(read(wheel({ deltaMode: 1, deltaY: -3, timeStamp: 40 }))).toBe(1);
    expect(read(wheel({ deltaMode: 1, deltaY: 6, timeStamp: 80 }))).toBe(-2);
    expect(read(wheel({ deltaMode: 1, deltaY: 1, timeStamp: 120 }))).toBe(-1);
    expect(read(wheel({ deltaMode: 1, deltaY: 1.5, timeStamp: 160 }))).toBe(0);
    expect(read(wheel({ deltaMode: 1, deltaY: 1.5, timeStamp: 200 }))).toBe(-1);
  });

  it("leaves a scroll by part of a line to pan", () => {
    expect(createWheelZoom()(wheel({ deltaMode: 1, deltaY: 0.25 }))).toBe(null);
  });

  it("leaves a trackpad's scroll to pan", () => {
    expect(createWheelZoom()(wheel({ deltaY: 4, wheelDeltaY: -12 }))).toBe(
      null,
    );
    expect(createWheelZoom()(wheel({ deltaY: 40, wheelDeltaY: -120 }))).toBe(
      null,
    );
    expect(createWheelZoom()(wheel({ deltaY: 40.3, wheelDeltaY: -120 }))).toBe(
      null,
    );
    expect(createWheelZoom()(wheel({ deltaY: 2.5, wheelDeltaY: -3 }))).toBe(
      null,
    );
    expect(
      createWheelZoom()(wheel({ deltaX: 6, deltaY: 100, wheelDeltaY: -120 })),
    ).toBe(null);
    expect(createWheelZoom()(wheel({ deltaY: 100 }))).toBe(null);
  });

  it("keeps a scroll's first kind until it pauses", () => {
    const read = createWheelZoom();
    expect(read(wheel({ deltaY: 4, wheelDeltaY: -12 }))).toBe(null);
    expect(read(wheel({ ...mouseNotch, timeStamp: 100 }))).toBe(null);
    expect(read(wheel({ ...mouseNotch, timeStamp: 600 }))).toBe(-1);
    expect(read(wheel({ deltaY: 4, wheelDeltaY: -12, timeStamp: 650 }))).toBe(
      0,
    );
  });

  it("pans with Shift held", () => {
    expect(createWheelZoom()(wheel({ ...mouseNotch, shiftKey: true }))).toBe(
      null,
    );
  });
});

function wheel(input: Partial<WheelInput>): WheelInput {
  return {
    deltaMode: 0,
    deltaX: 0,
    deltaY: 0,
    shiftKey: false,
    timeStamp: 0,
    ...input,
  };
}
