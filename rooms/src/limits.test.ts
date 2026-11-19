import { describe, expect, it } from "vitest";

import {
  Budget,
  ConnectionLimits,
  maxBinaryBytes,
  maxTextBytes,
} from "./limits";

describe("budget", () => {
  it("spends its depth, then refills over time", () => {
    const budget = new Budget(10, 20, 0);
    expect(budget.take(20, 0)).toBe(true);
    expect(budget.take(1, 0)).toBe(false);
    expect(budget.take(5, 500)).toBe(true);
    expect(budget.take(1, 500)).toBe(false);
  });
});

describe("connection limits", () => {
  it("passes a game's steady traffic", () => {
    const limits = new ConnectionLimits(0);
    for (let tick = 0; tick < 35 * 60; tick += 1) {
      const now = (tick * 1000) / 35;
      for (let packet = 0; packet < 6; packet += 1) {
        expect(limits.check(new ArrayBuffer(200), now)).toBe("send");
      }
    }
  });

  it("passes the map sent at the start of a game", () => {
    const limits = new ConnectionLimits(0);
    expect(limits.check("x".repeat(maxTextBytes), 0)).toBe("send");
  });

  it("closes a connection that sends oversized messages", () => {
    const limits = new ConnectionLimits(0);
    expect(limits.check("x".repeat(maxTextBytes + 1), 0)).toBe("close");
    expect(limits.check(new ArrayBuffer(maxBinaryBytes + 1), 0)).toBe("close");
  });

  it("drops a short spike and closes a flood", () => {
    const limits = new ConnectionLimits(0);
    const verdicts = Array.from({ length: 900 }, () =>
      limits.check(new ArrayBuffer(10), 0),
    );
    expect(verdicts.slice(0, 600).every((verdict) => verdict === "send")).toBe(
      true,
    );
    expect(verdicts[650]).toBe("drop");
    expect(verdicts.at(-1)).toBe("close");
  });
});
