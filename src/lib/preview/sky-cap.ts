import type { Picture } from "@/lib/wad/assets";

export const skyCapRows = 64;

// The rows above a sky's top, as RGBA by row then column. Each row averages
// the top row over a wider span of columns than the one below, so the sky
// rises into the top row's average color without stretching it into streaks.
export function skyCapOf(heavens: Picture | null, shades: Uint32Array) {
  const width = Math.max(1, heavens?.width ?? 0);
  const sums = new Float64Array((2 * width + 1) * 3);
  for (let column = 0; column < 2 * width; column += 1) {
    const color = heavens
      ? shades[heavens.pixels[(column % width) * heavens.height]]
      : 0;
    for (let channel = 0; channel < 3; channel += 1) {
      sums[(column + 1) * 3 + channel] =
        sums[column * 3 + channel] + ((color >>> (channel * 8)) & 255);
    }
  }
  const cap = new Uint8Array(width * skyCapRows * 4);
  for (let row = 0; row < skyCapRows; row += 1) {
    const span = Math.min(
      width,
      Math.max(1, Math.round(width ** Math.sqrt((row + 1) / skyCapRows))),
    );
    for (let column = 0; column < width; column += 1) {
      const start = (column - Math.floor((span - 1) / 2) + width) % width;
      const target = (row * width + column) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const sum =
          sums[(start + span) * 3 + channel] - sums[start * 3 + channel];
        cap[target + channel] = Math.round(sum / span);
      }
      cap[target + 3] = 255;
    }
  }
  return { width, cap };
}
