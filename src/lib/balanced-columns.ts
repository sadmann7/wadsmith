export function balancedColumns(count: number, max: number) {
  if (count <= max) return Math.max(1, count);
  if (max < 3) return Math.max(1, max);
  const fewer = max - 1;
  return lastRowFill(count, fewer) > lastRowFill(count, max) ? fewer : max;
}

function lastRowFill(count: number, columns: number) {
  return (((count - 1) % columns) + 1) / columns;
}
