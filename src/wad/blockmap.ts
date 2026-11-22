import type { Point } from "@/map/types";

const blockSize = 128;

interface BlockLine {
  start: Point;
  end: Point;
}

function lineTouchesBox(
  { start, end }: BlockLine,
  left: number,
  bottom: number,
  right: number,
  top: number,
) {
  if (
    Math.max(start.x, end.x) < left ||
    Math.min(start.x, end.x) > right ||
    Math.max(start.y, end.y) < bottom ||
    Math.min(start.y, end.y) > top
  ) {
    return false;
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const sides = [
    [left, bottom],
    [left, top],
    [right, bottom],
    [right, top],
  ].map(([x, y]) => Math.sign(dx * (y - start.y) - dy * (x - start.x)));
  return sides.some((side) => side >= 0) && sides.some((side) => side <= 0);
}

function buildBlockmap(lines: BlockLine[]): Int16Array {
  const points = lines.flatMap((line) => [line.start, line.end]);
  const originX = Math.min(...points.map((point) => point.x)) - 8;
  const originY = Math.min(...points.map((point) => point.y)) - 8;
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const columns = Math.floor((maxX - originX) / blockSize) + 1;
  const rows = Math.floor((maxY - originY) / blockSize) + 1;

  const blocks: number[][] = Array.from({ length: columns * rows }, () => []);
  lines.forEach((line, index) => {
    const firstColumn = Math.floor(
      (Math.min(line.start.x, line.end.x) - originX) / blockSize,
    );
    const lastColumn = Math.floor(
      (Math.max(line.start.x, line.end.x) - originX) / blockSize,
    );
    const firstRow = Math.floor(
      (Math.min(line.start.y, line.end.y) - originY) / blockSize,
    );
    const lastRow = Math.floor(
      (Math.max(line.start.y, line.end.y) - originY) / blockSize,
    );
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const left = originX + column * blockSize;
        const bottom = originY + row * blockSize;
        if (
          lineTouchesBox(
            line,
            left,
            bottom,
            left + blockSize,
            bottom + blockSize,
          )
        ) {
          blocks[row * columns + column].push(index);
        }
      }
    }
  });

  const headerSize = 4 + blocks.length;
  const words: number[] = [originX, originY, columns, rows];
  const body: number[] = [];
  for (const block of blocks) {
    words.push(headerSize + body.length);
    body.push(0, ...block, -1);
  }
  words.push(...body);
  if (words.length > 32767) {
    throw new Error("The map is too large for the engine's collision data.");
  }
  return Int16Array.from(words);
}

export { blockSize, buildBlockmap };
