import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addRoomOnSide,
  setRoomDoor,
  updateLine,
  updateLineSide,
  updateSector,
  updateThing,
} from "./edit";
import { blankMap, starterMap } from "./starter-map";
import { loadSavedMap, parseMapFile, saveMap, serializeMap } from "./storage";
import type { GameMap } from "./types";
import { validateMap } from "./validate";

function stubStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
  });
  return items;
}

function fileWith(change: (map: any) => void) {
  const file = JSON.parse(serializeMap(starterMap));
  change(file.map);
  return JSON.stringify(file);
}

function fileWithAction(action: object) {
  return fileWith((map) => {
    map.lines = { "v3|v4": { action } };
  });
}

describe("map files", () => {
  it("round-trips a map", () => {
    expect(parseMapFile(serializeMap(starterMap))).toEqual(starterMap);
  });

  it("keeps painted walls and door settings", () => {
    const wall = "v1|v15";
    const map: GameMap = {
      ...setRoomDoor(starterMap, "sector-4", {
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

  it("keeps line settings and sector behaviour", () => {
    const wall = "v3|v4";
    const map = updateSector(
      updateLineSide(
        updateLine(starterMap, wall, {
          hidden: true,
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

  it("opens any Freedoom texture and rejects unknown names", () => {
    const map = updateSector(starterMap, "sector-1", {
      floorTexture: "NUKAGE1",
      wallTexture: "ASHWALL2",
    });
    expect(parseMapFile(serializeMap(map))).toEqual(map);
    expect(() =>
      parseMapFile(
        fileWith((file) => {
          file.sectors[0].floorTexture = "SLAG_PL2";
        }),
      ),
    ).toThrow("unknown texture");
  });

  it("keeps thing difficulty settings", () => {
    const map = updateThing(starterMap, "imp-1", {
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
        map.sectors[0].wallTexture = "NOTREAL";
      }),
      "unknown texture",
    ],
    [
      "an unknown thing",
      fileWith((map) => {
        map.things[0].kind = "cyberdemon";
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
    const text = serializeMap(starterMap).replace('"v1":', '"__proto__":');
    expect(() => parseMapFile(text)).toThrow();
  });
});

describe("browser storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores a saved map", () => {
    stubStorage();
    expect(saveMap(starterMap)).toBe(true);
    expect(loadSavedMap()).toEqual(starterMap);
  });

  it("keeps a copy of a save it can't read", () => {
    const items = stubStorage({ "wadsmith:map": "{broken" });
    expect(loadSavedMap()).toBeNull();
    expect(items.get("wadsmith:map:unreadable")).toBe("{broken");
  });

  it("fails quietly when storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadSavedMap()).toBeNull();
    expect(saveMap(starterMap)).toBe(false);
  });
});

describe("blankMap", () => {
  it("is ready to play and extend", () => {
    expect(validateMap(blankMap)).toEqual([]);
    expect(addRoomOnSide(blankMap, "sector-1", "east", 128)).not.toBeNull();
  });
});
