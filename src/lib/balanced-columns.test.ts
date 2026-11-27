import { describe, expect, it } from "vitest";

import { balancedColumns } from "./balanced-columns";

describe("balancedColumns", () => {
  const lastRow = (count: number) => {
    const columns = balancedColumns(count, 4);
    return count - columns * (Math.ceil(count / columns) - 1);
  };

  it("fills one row when the items fit", () => {
    expect(balancedColumns(3, 4)).toBe(3);
    expect(balancedColumns(4, 4)).toBe(4);
  });

  it("never uses more columns than the limit", () => {
    for (let count = 1; count <= 24; count++) {
      expect(balancedColumns(count, 4)).toBeLessThanOrEqual(4);
    }
  });

  it("keeps the last row from holding a single item", () => {
    for (let count = 2; count <= 12; count++) {
      expect(lastRow(count)).toBeGreaterThan(1);
    }
  });

  it("splits rows evenly", () => {
    expect(balancedColumns(5, 4)).toBe(3);
    expect(balancedColumns(7, 4)).toBe(4);
    expect(balancedColumns(9, 4)).toBe(3);
  });

  it("gives an empty list one column", () => {
    expect(balancedColumns(0, 4)).toBe(1);
  });
});
