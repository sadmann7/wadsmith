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
    for (let count = 1; count <= 40; count++) {
      expect(balancedColumns(count, 4)).toBeLessThanOrEqual(4);
    }
  });

  it("keeps the last row from holding a single item when it can", () => {
    const unavoidable = new Set([13, 25, 37]);
    for (let count = 2; count <= 40; count++) {
      if (!unavoidable.has(count)) {
        expect(lastRow(count), `${count} items`).toBeGreaterThan(1);
      }
    }
  });

  it("splits rows evenly", () => {
    expect(balancedColumns(5, 4)).toBe(3);
    expect(balancedColumns(6, 4)).toBe(3);
    expect(balancedColumns(7, 4)).toBe(4);
    expect(balancedColumns(8, 4)).toBe(4);
    expect(balancedColumns(9, 4)).toBe(3);
    expect(balancedColumns(17, 4)).toBe(3);
    expect(balancedColumns(21, 4)).toBe(3);
  });

  it("gives an empty list one column", () => {
    expect(balancedColumns(0, 4)).toBe(1);
  });
});
