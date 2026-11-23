import type { CheckedIssue } from "@/lib/map/checks";

import type { Lump } from "./compile";

// Vanilla Doom reads every index as a signed 16-bit number.
const indexLimit = 32767;
// The fixed tables in Doom 1.9 that a map can fill: scrolling walls, moving
// floors and moving ceilings.
const scrollLimit = 64;
const platLimit = 30;
const ceilingLimit = 30;
// SAVEGAMESIZE, past which saving quits with "Savegame buffer overrun".
const saveLimit = 0x2c000;

const scrollSpecial = 48;
const perpetualSpecials = new Set([53, 87]);
const platSpecials = new Set([
  10, 14, 15, 20, 21, 22, 47, 53, 62, 66, 67, 68, 87, 88, 95, 120, 121, 122,
  123,
]);
const ceilingSpecials = new Set([6, 25, 40, 41, 43, 44, 49, 72, 73, 77, 141]);
// Crushers stay in the table for the rest of the map, even once stopped.
const crusherSpecials = new Set([6, 25, 49, 73, 77, 141]);
// Sector specials that start a light thinker, which a save writes out.
const lightSpecials = new Set([1, 2, 3, 4, 8, 12, 13]);
// Starts that spawn nothing of their own in a single-player game.
const startTypes = new Set([1, 2, 3, 4, 11]);
const multiplayerOnly = 16;
// A thing spawns only on the skills its flags name.
const skillBits = [1, 2, 4];

const counted = [
  { lump: "VERTEXES", size: 4, what: "corners" },
  { lump: "LINEDEFS", size: 14, what: "lines" },
  { lump: "SIDEDEFS", size: 30, what: "wall sides" },
  { lump: "SECTORS", size: 26, what: "sectors" },
  { lump: "SEGS", size: 12, what: "segs" },
  { lump: "SSECTORS", size: 4, what: "subsectors" },
  { lump: "NODES", size: 28, what: "nodes" },
] as const;

// Rough sizes in a Doom 1.9 save: its header and one player, each sector,
// line and side's saved fields, a padded mobj_t and a light's thinker.
const saveHeader = 50 + 280;
const saveSector = 14;
const saveLine = 6;
const saveSide = 10;
const saveThing = 160;
const saveLight = 40;

// Where a map built for vanilla Doom would overflow one of the engine's fixed
// limits. Woof lifts them, so these are warnings for players of the original.
export function vanillaLimits(lumps: Lump[]): CheckedIssue[] {
  const data = (name: string) =>
    lumps.find((lump) => lump.name === name)?.data ?? new Uint8Array();
  const issues: CheckedIssue[] = [];
  const warn = (id: string, message: string, detail: string) =>
    issues.push({ id: `vanilla-${id}`, severity: "warning", message, detail });

  for (const { lump, size, what } of counted) {
    const count = Math.floor(data(lump).length / size);
    if (count > indexLimit) {
      warn(
        `count:${lump.toLowerCase()}`,
        `Too many ${what} for vanilla Doom`,
        `${count} of ${indexLimit}. Vanilla Doom misreads the rest.`,
      );
    }
  }

  const lines = records(data("LINEDEFS"), 14).map((view) => ({
    special: view.getInt16(6, true),
    tag: view.getInt16(8, true),
    back: view.getInt16(12, true),
  }));
  const sectors = records(data("SECTORS"), 26).map((view) => ({
    special: view.getInt16(22, true),
    tag: view.getInt16(24, true),
  }));
  const tagged = (tag: number) =>
    sectors.filter((sector) => sector.tag === tag).length;
  const tagsOf = (specials: Set<number>) => [
    ...new Set(
      lines
        .filter((line) => specials.has(line.special) && line.tag > 0)
        .map((line) => line.tag),
    ),
  ];
  const total = (tags: number[]) =>
    tags.reduce((sum, tag) => sum + tagged(tag), 0);
  const largest = (tags: number[]) =>
    tags.reduce<{ tag: number; count: number } | null>(
      (best, tag) =>
        tagged(tag) > (best?.count ?? 0) ? { tag, count: tagged(tag) } : best,
      null,
    );

  const scrolls = lines.filter((line) => line.special === scrollSpecial);
  if (scrolls.length > scrollLimit) {
    warn(
      "scroll",
      "Too many scrolling walls for vanilla Doom",
      `${scrolls.length} of ${scrollLimit}. Vanilla Doom writes past its table as the map loads and may crash.`,
    );
  }

  // Lifts that never stop keep their places, so the biggest other lift has
  // only what they leave.
  const perpetual = total(tagsOf(perpetualSpecials));
  const lift = largest(
    tagsOf(platSpecials).filter(
      (tag) => !tagsOf(perpetualSpecials).includes(tag),
    ),
  );
  if (lift && lift.count > platLimit) {
    warn(
      "plats",
      "A lift or floor action moves too many sectors for vanilla Doom",
      `Tag ${lift.tag} moves ${lift.count} of ${platLimit}. Vanilla Doom quits when it fires.`,
    );
  } else if (perpetual + (lift?.count ?? 0) > platLimit) {
    warn(
      "perpetual",
      "Too many lifts moving at once for vanilla Doom",
      lift
        ? `${perpetual} lifts never stop, and tag ${lift.tag} adds ${lift.count}, past ${platLimit}. Vanilla Doom quits when they all run.`
        : `${perpetual} lifts never stop, past ${platLimit}. Vanilla Doom quits when they all run.`,
    );
  }

  const crushers = total(tagsOf(crusherSpecials));
  const ceiling = largest(
    tagsOf(ceilingSpecials).filter(
      (tag) => !tagsOf(crusherSpecials).includes(tag),
    ),
  );
  if (crushers + (ceiling?.count ?? 0) > ceilingLimit) {
    warn(
      "ceilings",
      "Too many moving ceilings for vanilla Doom",
      `${[
        ...(crushers > 0 ? [`${crushers} crushers`] : []),
        ...(ceiling ? [`tag ${ceiling.tag}'s ${ceiling.count} ceilings`] : []),
      ].join(
        " and ",
      )}, past ${ceilingLimit}. Crushers past it can't be stopped, and other ceilings past it never move again.`,
    );
  }

  const spawned = records(data("THINGS"), 10).flatMap((view) => {
    const type = view.getInt16(6, true);
    const flags = view.getInt16(8, true);
    return startTypes.has(type) || flags & multiplayerOnly ? [] : [flags];
  });
  const things = Math.max(
    ...skillBits.map((bit) => spawned.filter((flags) => flags & bit).length),
  );
  const sides = lines.reduce((sum, line) => sum + (line.back >= 0 ? 2 : 1), 0);
  const lights = sectors.filter((sector) =>
    lightSpecials.has(sector.special),
  ).length;
  const save =
    saveHeader +
    sectors.length * saveSector +
    lines.length * saveLine +
    sides * saveSide +
    things * saveThing +
    lights * saveLight;
  if (save > saveLimit) {
    warn(
      "save",
      "Too big to save in vanilla Doom",
      `About ${Math.round(save / 1024)} KB of ${saveLimit / 1024} KB on the busiest skill. Saving quits the game.`,
    );
  }
  return issues;
}

function records(data: Uint8Array, size: number) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return Array.from(
    { length: Math.floor(data.length / size) },
    (_, index) =>
      new DataView(view.buffer, view.byteOffset + index * size, size),
  );
}
