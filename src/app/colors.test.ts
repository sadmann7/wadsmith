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
  text: /^(?:xs|sm|base|lg|xl|\dxl|left|center|right|inherit|transparent|input|\[\d+px\])$/,
  border:
    /^(?:[tblrxy](?:-\d+)?|\d+|\[[\d.]+px\]|solid|dashed|dotted|transparent|collapse|separate|spacing-\d+|box)$/,
  outline: /^(?:none|transparent|offset-\d+|solid|dashed|dotted|double)$/,
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

const values = new Map(
  [...css.matchAll(/--color-([\w-]+):\s*([^;]+);/g)].map((match) => [
    match[1],
    match[2].trim(),
  ]),
);

function oklchOf(name: string): [number, number, number] {
  const value = values.get(name) ?? "";
  const reference = /^var\(--color-([\w-]+)\)$/.exec(value);
  if (reference) return oklchOf(reference[1]);
  const parts = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value);
  if (!parts) throw new Error(`--color-${name} isn't a plain oklch() color.`);
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
}

// OKLCH to linear sRGB, as in the CSS Color 4 spec.
function luminance(name: string) {
  const [l, c, h] = oklchOf(name);
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lms = [
    l + 0.3963377774 * a + 0.2158037573 * b,
    l - 0.1055613458 * a - 0.0638541728 * b,
    l - 0.0894841775 * a - 1.291485548 * b,
  ].map((value) => value ** 3);
  const rgb = [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ].map((value) => Math.min(1, Math.max(0, value)));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrast(front: string, back: string) {
  const [light, dark] = [luminance(front), luminance(back)].sort(
    (a, b) => b - a,
  );
  return (light + 0.05) / (dark + 0.05);
}

const surfaces = ["background", "card", "muted", "accent"];

describe("color contrast", () => {
  it.each(
    ["foreground", "muted-foreground"].flatMap((text) =>
      surfaces.map((surface) => [text, surface]),
    ),
  )("reads %s on %s at 4.5:1", (text, surface) => {
    expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["primary", "background"],
    ["primary", "card"],
    ["primary", "muted"],
    ["primary-foreground", "primary"],
    ["destructive", "card"],
    ["destructive", "muted"],
    ["warning", "card"],
    ["success", "card"],
    ["info", "card"],
  ])("reads %s on %s at 4.5:1", (text, surface) => {
    expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["background", "card", "muted"])(
    "draws focus rings on %s at 3:1",
    (surface) => {
      expect(contrast("ring", surface)).toBeGreaterThanOrEqual(3);
    },
  );
});
