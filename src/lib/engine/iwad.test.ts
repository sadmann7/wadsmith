import { describe, expect, it } from "vitest";

import { packTestWad } from "@/lib/wad/test-wad";

import { games } from "./game";
import { identifyIwad } from "./iwad";

const empty = new Uint8Array(0);
const base = ["PLAYPAL", "COLORMAP", "TEXTURE1", "PNAMES"];

describe("identifyIwad", () => {
  it("tells the games apart by their maps, lumps and names", () => {
    expect(identifyIwad("doom2.wad", iwad([...base, "MAP01"]))).toBe(
      games.doom2,
    );
    expect(identifyIwad("DOOM2.WAD", iwad([...base, "MAP01"]))).toBe(
      games.doom2,
    );
    expect(identifyIwad("PLUTONIA.WAD", iwad([...base, "MAP01"]))).toBe(
      games.plutonia,
    );
    expect(identifyIwad("tnt.wad", iwad([...base, "MAP01"]))).toBe(games.tnt);
    expect(
      identifyIwad("doom2.wad", iwad([...base, "FREEDOOM", "MAP01"])),
    ).toBe(games.freedoom2);
    expect(
      identifyIwad("doom.wad", iwad([...base, "E1M1", "E2M1", "E3M1", "E4M1"])),
    ).toEqual(games.doom);
    expect(
      identifyIwad("doom.wad", iwad([...base, "E1M1", "E2M1", "E3M1"])),
    ).toMatchObject({ id: "doom", episodes: 3, label: "Doom" });
    expect(
      identifyIwad(
        "freedoom1.wad",
        iwad([...base, "E1M1", "E2M1", "E3M1", "E4M1"]),
      ),
    ).toMatchObject({ id: "freedoom1", episodes: 4 });
  });

  it("refuses WADs that aren't a whole game", () => {
    // A megawad can carry a palette and textures, but calls itself a PWAD.
    expect(() =>
      identifyIwad(
        "eviternity.wad",
        packTestWad(
          [...base, "MAP01"].map((name) => ({ name, data: empty })),
          "PWAD",
        ),
      ),
    ).toThrow("isn't a game IWAD");
    expect(() => identifyIwad("doom1.wad", iwad([...base, "E1M1"]))).toThrow(
      "shareware",
    );
    expect(() => identifyIwad("maps.wad", iwad(["MAP01"]))).toThrow(
      "isn't a game IWAD",
    );
    expect(() => identifyIwad("tex.wad", iwad(base))).toThrow("no maps");
  });
});

function iwad(lumps: string[]) {
  return packTestWad(
    lumps.map((name) => ({ name, data: empty })),
    "IWAD",
  );
}
