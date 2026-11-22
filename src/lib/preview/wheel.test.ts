import { describe, expect, it } from "vitest";

import { countNotches, type WheelTurns } from "./wheel";

const turnAll = (events: [delta: number, time: number][], mode = 0) => {
  let turns: WheelTurns = { sum: 0, at: 0 };
  let total = 0;
  for (const [delta, time] of events) {
    const { notches, ...rest } = countNotches(turns, delta, mode, time);
    turns = rest;
    total += notches;
  }
  return total;
};

describe("wheel notches", () => {
  it("counts a notch for each click of a mouse wheel", () => {
    // A wheel that reports a hundred pixels a click.
    expect(
      turnAll([
        [100, 1000],
        [100, 1010],
        [-100, 1020],
      ]),
    ).toBe(1);
    // A wheel that reports a few pixels a click, turned slowly.
    expect(
      turnAll([
        [4, 1000],
        [4, 1300],
        [4, 1600],
      ]),
    ).toBe(3);
    expect(turnAll([[-4, 1000]])).toBe(-1);
  });

  it("adds a trackpad's small turns up to whole notches", () => {
    const swipe = Array.from({ length: 30 }, (_, index): [number, number] => [
      10,
      1000 + index * 16,
    ]);
    // The first turn counts, and then one notch for every hundred pixels.
    expect(turnAll(swipe)).toBe(3);
  });

  it("reads lines and pages as pixels", () => {
    expect(turnAll([[3, 1000]], 1)).toBe(1);
    expect(
      turnAll(
        [
          [3, 1000],
          [3, 1010],
          [3, 1020],
        ],
        1,
      ),
    ).toBe(3);
    expect(turnAll([[1, 1000]], 2)).toBe(1);
    expect(turnAll([[0, 1000]])).toBe(0);
  });
});
