import { describe, expect, it } from "vitest";

import { clearLabels } from "./map-labels";

describe("clearLabels", () => {
  it("keeps the bigger room's label where two side by side would overlap", () => {
    const west = room("Lava West North", 0, 96, 256);
    const east = room("Lava East", 96, 96);
    expect(clearLabels([east, west], 1)).toEqual([west]);
  });

  it("keeps both labels once the rooms are far enough apart on screen", () => {
    const west = room("Lava West North", 0, 96, 256);
    const east = room("Lava East", 96, 96);
    expect(clearLabels([west, east], 4)).toEqual([west, east]);
  });

  it("makes room for the detail line below a name", () => {
    const top = room("Hall", 0, 256, 32);
    const below = {
      ...room("Hall", 0, 256, 16),
      box: { left: 0, top: 30, right: 256, bottom: 46 },
    };
    expect(clearLabels([top, below], 1)).toHaveLength(2);
    expect(
      clearLabels(
        [top, below].map((item) => ({ ...item, detail: "S01 0/128" })),
        1,
      ),
    ).toHaveLength(1);
  });
});

function room(name: string, left: number, width: number, height = 128) {
  return { name, box: { left, top: 0, right: left + width, bottom: height } };
}
