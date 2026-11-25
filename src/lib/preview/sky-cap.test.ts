import { describe, expect, it } from "vitest";

import type { Picture } from "@/lib/wad/assets";

import { skyCapOf, skyCapRows } from "./sky-cap";

const width = 256;
const height = 128;
const shades = Uint32Array.from({ length: 256 }, (_, index) =>
  index === 1 ? 0xffffffff : 0xff000000,
);

function skyOf(topRow: (column: number) => number): Picture {
  const pixels = new Uint8Array(width * height);
  for (let column = 0; column < width; column += 1) {
    pixels[column * height] = topRow(column);
  }
  return {
    width,
    height,
    leftOffset: 0,
    topOffset: 0,
    pixels,
    opaque: new Uint8Array(width * height).fill(1),
  };
}

function redsOf(cap: Uint8Array, row: number) {
  return Array.from({ length: width }, (_, column) => {
    return cap[(row * width + column) * 4];
  });
}

function contrastOf(reds: number[]) {
  return Math.max(
    ...reds.map((red, column) => Math.abs(red - reds[(column + 1) % width])),
  );
}

describe("skyCapOf", () => {
  it("blurs a striped top row instead of stretching its stripes", () => {
    const { cap } = skyCapOf(
      skyOf((column) => column % 2),
      shades,
    );
    for (let row = 8; row < skyCapRows; row += 1) {
      expect(contrastOf(redsOf(cap, row))).toBeLessThan(255 * 0.25);
    }
  });

  it("ends in the top row's average color", () => {
    const { cap } = skyCapOf(
      skyOf((column) => (column < width / 4 ? 1 : 0)),
      shades,
    );
    expect(new Set(redsOf(cap, skyCapRows - 1))).toEqual(new Set([64]));
  });

  it("keeps a plain top row's color", () => {
    const { cap } = skyCapOf(
      skyOf(() => 1),
      shades,
    );
    expect(new Set(cap)).toEqual(new Set([255]));
  });
});
