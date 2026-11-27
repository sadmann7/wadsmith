export function balancedColumns(count: number, max: number) {
  const rows = Math.ceil(count / max);
  return Math.max(1, Math.ceil(count / Math.max(1, rows)));
}
