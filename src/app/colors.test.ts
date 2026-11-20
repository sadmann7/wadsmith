import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
// These feed canvas pixels, image rendering or browser metadata, which can't read CSS tokens.
const allowed = new Set([
  "app/layout.tsx",
  "app/opengraph-image.tsx",
  "map/catalog.ts",
]);
const rawColor =
  /#[0-9a-f]{3,8}\b|\b(?:oklch|oklab|lch|lab|hwb|rgba?|hsla?)\(/i;
const namedCssColor =
  /:\s*(?:[^;{}]*\s)?(?:black|white|red|green|blue|yellow|orange|gray|grey)\s*(?:;|$)/im;
const colorUtility =
  /(?<![\w-])(bg|text|border|outline|from)-([a-z][\w-]*|\[[^\]]+\])(?:\/\d+)?(?![\w-])/g;
// Utilities with these prefixes that set something other than a color.
const otherUtilities: Record<string, RegExp> = {
  bg: /^(?:transparent|linear-to-[a-z]+)$/,
  text: /^(?:xs|sm|base|lg|xl|\dxl|left|center|right|inherit|input|\[\d+px\])$/,
  border:
    /^(?:[tblrxy](?:-\d+)?|\d+|\[[\d.]+px\]|solid|dashed|dotted|transparent|collapse|box)$/,
  outline: /^(?:none|transparent|offset-\d+)$/,
  from: /^$/,
};

const css = readFileSync(join(root, "app/globals.css"), "utf8");
const components = css.slice(css.indexOf("@layer components"));
const tokens = new Set(
  [...css.matchAll(/--color-([\w-]+):/g)].map((match) => match[1]),
);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")
      ? [path]
      : [];
  });
}

const sources = sourceFiles(root).map((file) => ({
  file: relative(root, file),
  text: readFileSync(file, "utf8"),
}));

describe("color tokens", () => {
  it("keeps raw CSS colors inside the theme", () => {
    expect(components.match(new RegExp(rawColor, "gi"))).toBeNull();
    expect(components.match(namedCssColor)).toBeNull();
  });

  it("keeps raw colors out of components", () => {
    const offenders = sources
      .filter(({ file, text }) => !allowed.has(file) && rawColor.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("uses only defined color variables", () => {
    const used = [...sources.map(({ text }) => text), css].flatMap((text) => [
      ...text.matchAll(/var\(--color-([\w-]+)/g),
    ]);
    expect(
      used.map((match) => match[1]).filter((name) => !tokens.has(name)),
    ).toEqual([]);
  });

  it("uses only theme colors in class names", () => {
    const unknown = sources.flatMap(({ file, text }) =>
      [...text.matchAll(colorUtility)]
        .filter(
          ([, prefix, name]) =>
            !tokens.has(name) && !otherUtilities[prefix].test(name),
        )
        .map(([value]) => `${file}: ${value}`),
    );
    expect(unknown).toEqual([]);
  });
});
