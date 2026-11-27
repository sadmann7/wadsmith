import { expect, it } from "vitest";

import { playerColor } from "./player-colors";

it("gives each game slot one color token everywhere a player shows", () => {
  const tokens = [0, 1, 2, 3].map((slot) => {
    const { fill, badge, dot } = playerColor(slot);
    const token = /--color-(\w+)/.exec(fill)?.[1];
    expect(badge).toBe(`border-${token} text-${token}`);
    expect(dot).toBe(`bg-${token}`);
    return token;
  });
  expect(tokens).toEqual(["success", "info", "warning", "destructive"]);
  expect(playerColor(5)).toEqual(playerColor(1));
});
