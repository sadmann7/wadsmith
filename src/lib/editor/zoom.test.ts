import { describe, expect, it } from "vitest";

import {
  createPinchZoom,
  createWheelZoom,
  furthestZoom,
  minZoom,
  restingZoom,
  steppedZoom,
  viewBetween,
  type WheelInput,
  zoomedView,
} from "./zoom";

const mouseNotch = { deltaY: 100, wheelDeltaY: -120 };

describe("stepped zoom", () => {
  it("steps through the zoom levels", () => {
    expect(steppedZoom(1, 1)).toBeCloseTo(1.5);
    expect(steppedZoom(1, -1)).toBeCloseTo(2 / 3);
    expect(steppedZoom(1.5, -1)).toBeCloseTo(1);
    expect(steppedZoom(1, -3)).toBeCloseTo(1 / 3);
    expect(steppedZoom(0.1, 1)).toBeCloseTo(0.25);
  });

  it("changes the zoom visibly from anywhere between levels", () => {
    expect(steppedZoom(0.48, 1)).toBeCloseTo(2 / 3);
    expect(steppedZoom(0.48, -1)).toBeCloseTo(1 / 3);
    expect(steppedZoom(0.95, 1)).toBeCloseTo(1.5);
    for (let zoom = 0.02; zoom < 3.5; zoom *= 1.07) {
      expect(steppedZoom(zoom, 1) / zoom).toBeGreaterThanOrEqual(1.1);
      expect(zoom / steppedZoom(zoom, -1)).toBeGreaterThanOrEqual(1.1);
    }
  });

  it("stops at the bounds it is given", () => {
    expect(steppedZoom(3, 1)).toBe(4);
    expect(steppedZoom(4, 1)).toBe(4);
    expect(steppedZoom(0.26, -1, 0.24)).toBe(0.24);
    expect(steppedZoom(0.24, -1, 0.24)).toBe(0.24);
  });
});

describe("furthest zoom", () => {
  it("is half of what fits the map", () => {
    expect(furthestZoom(0.48)).toBeCloseTo(0.24);
    expect(furthestZoom(0.1)).toBeCloseTo(0.05);
  });

  it("still lets a tiny map zoom out, and a huge one fit", () => {
    expect(furthestZoom(1.25)).toBe(0.25);
    expect(furthestZoom(0.002)).toBe(minZoom);
  });
});

describe("resting zoom", () => {
  it("settles a zoom near 100% on 100%", () => {
    expect(restingZoom(0.97)).toBe(1);
    expect(restingZoom(1.04)).toBe(1);
    expect(restingZoom(0.9)).toBe(0.9);
    expect(restingZoom(1.1)).toBe(1.1);
  });
});

describe("view between", () => {
  const from = { x: 100, y: 50, zoom: 0.5 };

  it("starts and ends on the two views", () => {
    const to = zoomedView(from, 2, { x: 300, y: 200 });
    expect(viewBetween(from, to, 0)).toEqual(from);
    const end = viewBetween(from, to, 1);
    expect(end.x).toBeCloseTo(to.x);
    expect(end.y).toBeCloseTo(to.y);
    expect(end.zoom).toBeCloseTo(2);
  });

  it("keeps the point it zooms around still", () => {
    const at = { x: 300, y: 200 };
    const to = zoomedView(from, 2, at);
    const middle = viewBetween(from, to, 0.5);
    expect(middle.zoom).toBeCloseTo(1);
    expect((at.x - middle.x) / middle.zoom).toBeCloseTo(
      (at.x - from.x) / from.zoom,
    );
    expect((at.y - middle.y) / middle.zoom).toBeCloseTo(
      (at.y - from.y) / from.zoom,
    );
  });

  it("pans straight when the zoom stays", () => {
    expect(viewBetween(from, { x: 200, y: 150, zoom: 0.5 }, 0.5)).toEqual({
      x: 150,
      y: 100,
      zoom: 0.5,
    });
  });
});

describe("pinch zoom", () => {
  it("follows small moves exactly", () => {
    const read = createPinchZoom();
    expect(read({ deltaY: -3, timeStamp: 0 })).toBeCloseTo(Math.exp(0.03));
    expect(read({ deltaY: 4, timeStamp: 16 })).toBeCloseTo(Math.exp(-0.04));
  });

  it("caps a spike and a frame's total", () => {
    const read = createPinchZoom();
    expect(read({ deltaY: -80, timeStamp: 0 })).toBeCloseTo(Math.exp(0.1));
    let total = 1;
    for (let event = 0; event < 12; event++) {
      total *= read({ deltaY: -25, timeStamp: 20 });
    }
    expect(total).toBeCloseTo(Math.exp(0.2));
  });

  it("caps a fast pinch over many frames to a few levels", () => {
    const read = createPinchZoom();
    let total = 1;
    for (let frame = 0; frame < 12; frame++) {
      total *= read({ deltaY: 25, timeStamp: frame * 16 });
    }
    expect(total).toBeCloseTo(Math.exp(-1.2));
  });

  it("scales lines to pixels", () => {
    expect(createPinchZoom()({ deltaY: -0.5, timeStamp: 0 }, 16)).toBeCloseTo(
      Math.exp(0.08),
    );
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
