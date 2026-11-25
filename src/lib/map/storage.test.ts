import { afterEach, describe, expect, it, vi } from "vitest";

import type { GameMap } from "./types";

import {
  addNote,
  addRoomOnSide,
  removeNote,
  setRoomDoor,
  updateLine,
  updateLineSide,
  updateSector,
  updateThing,
} from "./edit";
import { blankMap } from "./starter-map";
import { loadSavedMap, parseMapFile, saveMap, serializeMap } from "./storage";
import { testMap } from "./test-map";
import { validateMap } from "./validate";

describe("map files", () => {
  it("round-trips a map", () => {
    expect(parseMapFile(serializeMap(testMap))).toEqual(testMap);
  });

  it("keeps painted walls and door settings", () => {
    const wall = "v1|v15";
    const map: GameMap = {
      ...setRoomDoor(testMap, "sector-4", {
        opensBy: "use",
        closes: true,
        texture: "DOOR3",
      }),
    };
    map.sectors = map.sectors.map((sector, index) =>
      index === 0 ? { ...sector, wallOverrides: { [wall]: "BRICK1" } } : sector,
    );
    expect(parseMapFile(serializeMap(map))).toEqual(map);
  });

  it("keeps a door that wears a wall texture", () => {
    const map = setRoomDoor(testMap, "sector-4", {
      opensBy: "use",
      closes: true,
      texture: "METAL",
    });
    expect(parseMapFile(serializeMap(map))).toEqual(map);
  });

  it("keeps line settings and sector behaviour", () => {
    const wall = "v3|v4";
    const map = updateSector(
      updateLineSide(
        updateLine(testMap, wall, {
          hidden: true,
          blocksPlayers: true,
          blocksWalkers: true,
          action: {
            kind: "door-open",
            trigger: "switch",
            repeat: false,
            key: "red",
            tag: 7,
          },
        }),
        wall,
        "sector-2",
        { offsetX: -4, upper: "BRICK1" },
      ),
      "sector-1",
      { effect: "secret", tag: 7 },
    );
    expect(parseMapFile(serializeMap(map))).toEqual(map);
  });

  it("opens any texture name, since the game decides what exists", () => {
    const map = updateSector(testMap, "sector-1", {
      floorTexture: "NUKAGE1",
      wallTexture: "ASHWALL2",
    });
    expect(parseMapFile(serializeMap(map))).toEqual(map);
    expect(
      parseMapFile(
        fileWith((file) => {
          file.sectors[0].floorTexture = "SLAG_PL2";
        }),
      ).sectors[0].floorTexture,
    ).toBe("SLAG_PL2");
  });

  it("keeps playtest notes", () => {
    const map = addNote(testMap, { x: 96.4, y: 160 }, "Too dark here");
    expect(map.notes).toEqual([
      { id: "note-1", x: 96, y: 160, text: "Too dark here" },
    ]);
    expect(parseMapFile(serializeMap(map))).toEqual(map);
    expect(removeNote(map, "note-1").notes).toBeUndefined();
    // A note left in a playtest keeps its moment in that run.
    const timed = addNote(testMap, { x: 96, y: 160 }, "Ambush", {
      run: "run-abc",
      tic: 700,
    });
    expect(timed.notes).toEqual([
      { id: "note-1", x: 96, y: 160, text: "Ambush", run: "run-abc", tic: 700 },
    ]);
    expect(parseMapFile(serializeMap(timed))).toEqual(timed);
  });

  it("keeps thing difficulty settings", () => {
    const map = updateThing(testMap, "imp-1", {
      skills: ["easy", "hard"],
      ambush: true,
    });
    expect(parseMapFile(serializeMap(map))).toEqual(map);
    expect(() =>
      parseMapFile(
        fileWith((file) => {
          file.things[1].skills = ["nightmare"];
        }),
      ),
    ).toThrow("unknown difficulty");
  });

  it("rejects line actions the engine doesn't have", () => {
    const base = { kind: "exit", trigger: "walk", repeat: false, tag: 0 };
    expect(() => parseMapFile(fileWithAction(base))).not.toThrow();
    expect(() =>
      parseMapFile(fileWithAction({ ...base, trigger: "shoot" })),
    ).toThrow("unknown action");
    expect(() =>
      parseMapFile(fileWithAction({ ...base, kind: "constructor" })),
    ).toThrow("unknown action");
  });

  it("reopens a map whose corner is outside the engine's range", () => {
    const parsed = parseMapFile(
      fileWith((map) => {
        map.vertices.v1.x = 40000;
      }),
    );
    expect(parsed.vertices.v1.x).toBe(40000);
    expect(validateMap(parsed).map((issue) => issue.id)).toContain("range:v1");
  });

  it("shortens an overlong room name", () => {
    const parsed = parseMapFile(
      fileWith((map) => {
        map.sectors[0].name = "x".repeat(200);
      }),
    );
    expect(parsed.sectors[0].name).toHaveLength(80);
  });

  it("drops fields it doesn't know", () => {
    const parsed = parseMapFile(
      fileWith((map) => {
        map.sectors[0].extra = "ignored";
      }),
    );
    expect(parsed.sectors[0]).not.toHaveProperty("extra");
  });

  it.each([
    ["other JSON", '{"hello":true}', "isn't a Wadsmith map"],
    ["broken JSON", "{", "valid JSON"],
    [
      "a newer version",
      JSON.stringify({ format: "wadsmith-map", version: 99, map: {} }),
      "different version",
    ],
    [
      "a missing corner",
      fileWith((map) => {
        map.sectors[0].vertices[0] = "nope";
      }),
      "missing corner",
    ],
    [
      "an unknown texture",
      fileWith((map) => {
        map.sectors[0].wallTexture = "not real";
      }),
      "unknown texture",
    ],
    [
      "an unknown thing",
      fileWith((map) => {
        map.things[0].kind = "dragon";
      }),
      "unknown kind",
    ],
    [
      "a huge coordinate",
      fileWith((map) => {
        map.vertices.v1.x = 9_999_999;
      }),
      "out of range",
    ],
    [
      "a fractional height",
      fileWith((map) => {
        map.sectors[0].floor = 1.5;
      }),
      "out of range",
    ],
    [
      "a switch with no room",
      fileWith((map) => {
        map.switches[0].sector = "sector-99";
      }),
      "missing",
    ],
    [
      "duplicate rooms",
      fileWith((map) => {
        map.sectors[1].id = map.sectors[0].id;
      }),
      "unique",
    ],
  ])("rejects %s", (_name, text, message) => {
    expect(() => parseMapFile(text)).toThrow(message);
  });

  it("rejects a prototype key as a corner id", () => {
    const text = serializeMap(testMap).replace('"v1":', '"__proto__":');
    expect(() => parseMapFile(text)).toThrow();
  });
});

function fileWithAction(action: object) {
  return fileWith((map) => {
    map.lines = { "v3|v4": { action } };
  });
}

describe("browser storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores a saved map", () => {
    stubStorage();
    expect(saveMap(testMap)).toBe(true);
    expect(loadSavedMap()).toEqual(testMap);
  });

  it("keeps a copy of a save it can't read", () => {
    const items = stubStorage({ "wadsmith:map": "{broken" });
    expect(loadSavedMap()).toBeNull();
    expect(items.get("wadsmith:map:unreadable")).toBe("{broken");
  });

  it("fails quietly when storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadSavedMap()).toBeNull();
    expect(saveMap(testMap)).toBe(false);
  });
});

function stubStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
  });
  return items;
}

describe("blankMap", () => {
  it("is ready to play and extend", () => {
    expect(validateMap(blankMap)).toEqual([]);
    expect(addRoomOnSide(blankMap, "sector-1", "east", 128)).not.toBeNull();
  });
});

describe("texture names", () => {
  it("keeps any texture name the game might have", () => {
    const renamed: GameMap = {
      ...testMap,
      sectors: testMap.sectors.map((sector, index) =>
        index === 0
          ? { ...sector, wallTexture: "ZIMMER8", floorTexture: "FLAT23" }
          : sector,
      ),
    };
    expect(parseMapFile(serializeMap(renamed))).toEqual(renamed);
  });

  it("refuses names no lump can have", () => {
    for (const name of ["", "startan3", "TOOLONGNAME", "A B"]) {
      expect(() =>
        parseMapFile(
          fileWith((map) => {
            map.sectors[0].wallTexture = name;
          }),
        ),
      ).toThrow("unknown texture");
    }
  });
});

// oxlint-disable-next-line typescript/no-explicit-any -- Tests write values a saved map can't hold.
function fileWith(change: (map: any) => void) {
  const file = JSON.parse(serializeMap(testMap));
  change(file.map);
  return JSON.stringify(file);
}
