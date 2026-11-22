import { describe, expect, it } from "vitest";

import {
  decodeSectorSpecial,
  encodeSectorSpecial,
  fieldValue,
  generalizedFields,
  generalizedKind,
  generalizedKinds,
  generalizedTrigger,
  isGeneralized,
  sectorSpecialOf,
  sectorSpecialPatch,
  withField,
  type SectorBits,
} from "./boom";
import { lineLevel, sectorLevel } from "./complevel";

const plainBits: SectorBits = {
  base: 0,
  damage: 0,
  secret: false,
  friction: false,
  wind: false,
  altDamage: false,
  killGrounded: false,
};

describe("Boom generalized line specials", () => {
  it("finds each class across its whole range and reads the trigger", () => {
    for (const kind of generalizedKinds) {
      for (const special of [kind.base, kind.start, kind.end - 1]) {
        expect(generalizedKind(special)?.class, String(special)).toBe(
          kind.class,
        );
        expect(lineLevel(special)).toBe("boom");
      }
    }
    expect(generalizedKind(0x2f7f)).toBeNull();
    expect(generalizedKind(0x8000)).toBeNull();
    expect(isGeneralized(141)).toBe(false);
    expect(isGeneralized(0x3c00)).toBe(true);
    expect(generalizedTrigger(0x6000 | 3)).toEqual({
      trigger: "switch",
      repeat: true,
    });
    expect(generalizedTrigger(0x3c00 | 7)).toEqual({
      trigger: "door",
      repeat: true,
    });
    expect(generalizedTrigger(0x2f80 | 4)).toEqual({
      trigger: "shoot",
      repeat: false,
    });
  });

  it("reads the fields of a floor the way Boom lays them out", () => {
    // W1, fast, numeric model, up, to the lowest nearby ceiling, changing the
    // texture, crushing.
    const special =
      0x6000 |
      (2 << 3) |
      (1 << 5) |
      (1 << 6) |
      (3 << 7) |
      (2 << 10) |
      (1 << 12);
    const fields = generalizedFields(special);
    expect(
      Object.fromEntries(
        fields.map((field) => [field.id, fieldValue(special, field)]),
      ),
    ).toEqual({
      trigger: 0,
      speed: 2,
      direction: 1,
      target: 3,
      change: 2,
      model: 1,
      crush: 1,
    });
    // With nothing to copy, the model bit lets monsters trigger the line.
    const change = fields.find((field) => field.id === "change")!;
    const plain = withField(special, change, 0);
    const ids = generalizedFields(plain).map((field) => field.id);
    expect(ids).toContain("monsters");
    expect(ids).not.toContain("model");
    expect(fieldValue(plain, change)).toBe(0);
    expect(plain & ~(3 << 10)).toBe(special & ~(3 << 10));
  });

  it("writes every value of every field without touching the rest", () => {
    for (const kind of generalizedKinds) {
      for (const field of kind.fields) {
        for (let value = 0; value < field.options.length; value += 1) {
          const next = withField(kind.start, field, value);
          expect(fieldValue(next, field)).toBe(value);
          expect(generalizedKind(next)?.class).toBe(kind.class);
          const mask = ((1 << field.width) - 1) << field.shift;
          expect(next & ~mask).toBe(kind.start & ~mask);
        }
      }
    }
  });
});

describe("Boom sector bits", () => {
  it("writes the vanilla number when one says the same", () => {
    for (const special of [0, 1, 4, 5, 7, 9, 11, 16, 17]) {
      expect(encodeSectorSpecial(decodeSectorSpecial(special))).toBe(special);
    }
    expect(decodeSectorSpecial(7)).toMatchObject({ base: 0, damage: 1 });
    expect(decodeSectorSpecial(5)).toMatchObject({ base: 0, damage: 2 });
    expect(decodeSectorSpecial(16)).toMatchObject({ base: 0, damage: 3 });
    expect(decodeSectorSpecial(4)).toMatchObject({ base: 2, damage: 3 });
    expect(decodeSectorSpecial(9)).toMatchObject({ base: 0, secret: true });
    expect(decodeSectorSpecial(11)).toMatchObject({ base: 11, damage: 0 });
  });

  it("packs lighting, damage, secret and the Boom and MBF21 bits together", () => {
    expect(encodeSectorSpecial({ ...plainBits, base: 1, damage: 2 })).toBe(
      1 | (2 << 5),
    );
    expect(encodeSectorSpecial({ ...plainBits, damage: 1, secret: true })).toBe(
      (1 << 5) | 0x80,
    );
    const everything = 8 | 0x100 | 0x200 | 0x1000 | 0x2000;
    expect(decodeSectorSpecial(everything)).toEqual({
      base: 8,
      damage: 0,
      secret: false,
      friction: true,
      wind: true,
      altDamage: true,
      killGrounded: true,
    });
    expect(encodeSectorSpecial(decodeSectorSpecial(everything))).toBe(
      everything,
    );
    expect(
      sectorLevel(encodeSectorSpecial({ ...plainBits, base: 1, damage: 2 })),
    ).toBe("boom");
    expect(
      sectorLevel(encodeSectorSpecial({ ...plainBits, altDamage: true })),
    ).toBe("mbf21");
  });

  it("turns a number into a named effect or a raw special", () => {
    expect(sectorSpecialPatch(9)).toEqual({
      effect: "secret",
      rawEffect: undefined,
    });
    expect(sectorSpecialPatch(33)).toEqual({
      effect: undefined,
      rawEffect: 33,
    });
    expect(sectorSpecialPatch(0)).toEqual({
      effect: undefined,
      rawEffect: undefined,
    });
    expect(sectorSpecialOf({ effect: "glow" })).toBe(8);
    expect(sectorSpecialOf({ rawEffect: 65 })).toBe(65);
    expect(sectorSpecialOf({})).toBe(0);
  });
});
