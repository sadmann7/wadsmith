import { afterEach, describe, expect, it, vi } from "vitest";

import { games } from "@/lib/engine/game";
import { checkMap } from "@/lib/map/checks";
import { starterMap } from "@/lib/map/starter-map";
import { serializeMap } from "@/lib/map/storage";
import { validateMap } from "@/lib/map/validate";
import { compileEpisode } from "@/lib/wad/compile";

import {
  buildProblem,
  createEpisode,
  createMapEntry,
  createMapSaver,
  episodeMaps,
  freeSlots,
  getIsSlotConflict,
  lastMapKey,
  mapFromTemplate,
  mapStatus,
  parseEpisodeBackup,
  parsePar,
  prepareEpisodes,
  serializeEpisode,
  slotMoves,
} from "./episode-data";
import { createMemoryStore } from "./episode-store";

afterEach(() => vi.unstubAllGlobals());

describe("episode storage", () => {
  it("starts a new browser with the starter map open", async () => {
    stubLegacy(null);
    const store = createMemoryStore();
    const ready = await prepareEpisodes(store);
    expect(ready.episodes).toHaveLength(1);
    expect(ready.entry).toMatchObject({ slot: "MAP01", map: starterMap });
    expect(await store.getSetting(lastMapKey)).toBe(ready.entry?.id);
  });

  it("creates one first episode when tabs start together", async () => {
    stubLegacy(null);
    const store = createMemoryStore();
    await Promise.all([prepareEpisodes(store), prepareEpisodes(store)]);
    const episodes = await store.listEpisodes();
    expect(episodes).toHaveLength(1);
    expect(await store.listMaps(episodes[0].id)).toHaveLength(1);
  });

  it("moves the old saved map into the first episode", async () => {
    stubLegacy(serializeMap({ ...starterMap, name: "My old map" }));
    const ready = await prepareEpisodes(createMemoryStore());
    expect(ready.entry?.map.name).toBe("My old map");
  });

  it("returns to Episode Home when no map was left open", async () => {
    stubLegacy(null);
    const store = createMemoryStore();
    const first = await prepareEpisodes(store);
    await store.setSetting(lastMapKey, null);
    const again = await prepareEpisodes(store);
    expect(again.entry).toBeNull();
    expect(again.episodeId).toBe(first.episodeId);
    expect(again.episodes).toHaveLength(1);
  });

  it("keeps the newest edit and the stored details", async () => {
    const store = createMemoryStore();
    const entry = createMapEntry("p", "MAP01", {
      ...starterMap,
      name: "Named",
    });
    await store.putMap(entry);
    const statuses: string[] = [];
    const saver = createMapSaver(store, entry, {
      onStatus: (status) => statuses.push(status),
    });
    await store.updateMap(entry.id, (current) => ({
      ...current,
      slot: "MAP05",
      par: 90,
    }));
    saver.saveMap({ ...starterMap, things: [] });
    saver.saveMap({ ...starterMap, switches: [] });
    expect(await saver.flush()).toBe(true);
    const saved = await store.getMap(entry.id);
    expect(saved).toMatchObject({ slot: "MAP05", par: 90, mapRevision: 2 });
    expect(saved?.map.name).toBe("Named");
    expect(saved?.map.switches).toEqual([]);
    expect(saved?.map.things).toHaveLength(starterMap.things.length);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("retries a failed save before leaving", async () => {
    const store = createMemoryStore();
    const entry = createMapEntry("p", "MAP01", starterMap);
    await store.putMap(entry);
    const update = store.updateMap;
    let failures = 1;
    store.updateMap = (id, change) =>
      failures-- > 0 ? Promise.reject(new Error("full")) : update(id, change);
    const statuses: string[] = [];
    const saver = createMapSaver(store, entry, {
      onStatus: (status) => statuses.push(status),
    });
    saver.saveMap({ ...starterMap, things: [] });
    await Promise.resolve();
    expect(await saver.flush()).toBe(true);
    expect((await store.getMap(entry.id))?.map.things).toEqual([]);
  });

  it("does not bring a deleted map back", async () => {
    const store = createMemoryStore();
    const entry = createMapEntry("p", "MAP01", starterMap);
    await store.putMap(entry);
    await store.deleteMap(entry.id);
    let missing = false;
    const saver = createMapSaver(store, entry, {
      onStatus: () => {},
      onMissing: () => {
        missing = true;
      },
    });
    saver.saveMap(starterMap);
    await saver.flush();
    expect(missing).toBe(true);
    expect(await store.getMap(entry.id)).toBeNull();
  });

  it("refuses two maps in one slot", async () => {
    const store = createMemoryStore();
    await store.putMap(createMapEntry("p", "MAP01", starterMap));
    await expect(
      store.putMap(createMapEntry("p", "MAP01", starterMap)),
    ).rejects.toSatisfy(getIsSlotConflict);
  });

  it("creates the first episode and map together", async () => {
    stubLegacy(null);
    const store = createMemoryStore();
    store.addEpisode = () => Promise.reject(new Error("full"));
    await expect(prepareEpisodes(store)).rejects.toThrow("full");
    expect(await store.listEpisodes()).toEqual([]);
  });

  it("marks an unreadable stored map instead of failing the episode", async () => {
    const store = createMemoryStore();
    const entry = createMapEntry("p", "MAP01", starterMap);
    await store.putMap({
      ...entry,
      map: { ...starterMap, vertices: null as never },
    });
    const [listed] = await store.listMaps("p");
    expect(listed.broken).toBe(true);
    expect(mapStatus(listed).label).toBe("Can't open");
  });

  it("deletes an episode with its maps", async () => {
    const store = createMemoryStore();
    const episode = createEpisode("Ashfall");
    await store.putEpisode(episode);
    await store.putMap(createMapEntry(episode.id, "MAP01", starterMap));
    await store.deleteEpisode(episode.id);
    expect(await store.listMaps(episode.id)).toEqual([]);
  });
});

describe("first episode", () => {
  it("is called Episode 1, and keeps a name the player chose", async () => {
    stubLegacy(null);
    const store = createMemoryStore();
    const ready = await prepareEpisodes(store);
    expect(ready.episodes[0].name).toBe("Episode 1");
    await store.putEpisode({ ...ready.episodes[0], name: "My project" });
    expect((await prepareEpisodes(store)).episodes[0].name).toBe("Episode 1");
    await store.putEpisode({ ...ready.episodes[0], name: "Ashfall" });
    await store.putEpisode({
      id: "older",
      name: "My project",
      createdAt: ready.episodes[0].createdAt - 1,
    });
    const renamed = await prepareEpisodes(store);
    expect(renamed.episodes.map((episode) => episode.name)).toEqual([
      "Episode 1",
      "Ashfall",
    ]);
    await store.deleteEpisode("older");
    expect((await prepareEpisodes(store)).episodes[0].name).toBe("Ashfall");
  });
});

function stubLegacy(saved: string | null) {
  vi.stubGlobal("localStorage", {
    getItem: () => saved,
    setItem: () => {},
  });
}

describe("episode order", () => {
  it("moves maps into the slots the episode already uses", () => {
    const [a, b, c] = ["MAP01", "MAP02", "MAP05"].map((slot) =>
      createMapEntry("p", slot, starterMap),
    );
    expect(slotMoves([a, b, c], [c.id, a.id, b.id])).toEqual([
      { id: c.id, slot: "MAP01" },
      { id: a.id, slot: "MAP02" },
      { id: b.id, slot: "MAP05" },
    ]);
    expect(slotMoves([a, b, c], [a.id, b.id, c.id])).toEqual([]);
  });

  it("swaps two maps in one step", async () => {
    const store = createMemoryStore();
    const episode = createEpisode("Ashfall");
    const a = createMapEntry(episode.id, "MAP01", starterMap);
    const b = createMapEntry(episode.id, "MAP02", starterMap);
    await store.addEpisode(episode, [a, b]);
    await store.moveMaps(slotMoves([a, b], [b.id, a.id]));
    expect((await store.getMap(a.id))?.slot).toBe("MAP02");
    expect((await store.getMap(b.id))?.slot).toBe("MAP01");
    expect(await store.countMaps(episode.id)).toBe(2);
  });

  it("starts a new episode empty, with one map or with the featured maps", () => {
    expect(episodeMaps("p", "empty")).toEqual([]);
    expect(episodeMaps("p", "one").map((entry) => entry.slot)).toEqual([
      "MAP01",
    ]);
    const featured = episodeMaps("p", "featured");
    expect(featured.map((entry) => entry.slot)).toEqual([
      "MAP01",
      "MAP02",
      "MAP03",
      "MAP04",
      "MAP05",
      "MAP06",
    ]);
    expect(
      featured.every(
        (entry) => mapStatus(entry, buildProblem(entry.map)).kind !== "error",
      ),
    ).toBe(true);
  });

  it("counts the warnings only vanilla Doom would show", () => {
    const entry = episodeMaps("p", "one")[0];
    const warning = {
      id: "vanilla-save",
      severity: "warning" as const,
      message: "Too big to save in vanilla Doom",
    };
    expect(mapStatus(entry, null, undefined, [warning]).label).toBe(
      "2 warnings",
    );
  });

  it("names a map with no exit", () => {
    expect(mapStatus(episodeMaps("p", "one")[0], null).label).toBe(
      "No exit yet",
    );
  });

  it("checks a map again when the game's textures change", () => {
    const [entry] = episodeMaps("p", "one");
    const used = [
      ...new Set(
        entry.map.sectors.flatMap((sector) => [
          sector.wallTexture,
          sector.floorTexture,
          sector.ceilingTexture,
        ]),
      ),
    ];
    const names = (textures: string[]) => ({
      walls: textures,
      flats: textures,
      middles: textures,
      textures,
      custom: [],
    });
    expect(mapStatus(entry, null, { names: names([]) }).kind).toBe("error");
    // Adding a resource brings new names without an edit to the map.
    expect(mapStatus(entry, null, { names: names(used) }).label).toBe(
      "No exit yet",
    );
  });

  it("holds a map whose build hasn't been checked", () => {
    expect(mapStatus(episodeMaps("p", "one")[0]).kind).toBe("checking");
  });

  it("names a map that passes its checks but won't build", () => {
    const [entry] = episodeMaps("p", "one");
    const status = mapStatus(entry, "Room 1 overlaps another room's wall.");
    expect(status.kind).toBe("error");
    expect(status.label).toBe("Won't build");
  });

  it("catches a room drawn twice before the build", () => {
    const [entry] = episodeMaps("p", "one");
    const [room] = entry.map.sectors;
    const doubled = {
      ...entry,
      map: {
        ...entry.map,
        sectors: [...entry.map.sectors, { ...room, id: `${room.id}-copy` }],
      },
    };
    expect(mapStatus(doubled, buildProblem(doubled.map)).kind).toBe("error");
    expect(
      checkMap(doubled.map).some((issue) => issue.id.startsWith("same-side:")),
    ).toBe(true);
  });
});

describe("episode maps", () => {
  it("offers only free slots", () => {
    const maps = [createMapEntry("p", "MAP01", starterMap)];
    expect(freeSlots(maps)[0]).toBe("MAP02");
    expect(freeSlots(maps, "MAP01")[0]).toBe("MAP01");
    expect(freeSlots(maps)).toHaveLength(31);
    expect(freeSlots(maps, undefined, games.doom)).toHaveLength(35);
    expect(
      freeSlots(maps, undefined, { ...games.doom, episodes: 3 }),
    ).toHaveLength(26);
  });

  it("creates valid templates without sharing data", () => {
    const room = mapFromTemplate("room", "Room");
    expect(validateMap(room)).toEqual([]);
    const hub = mapFromTemplate("hub", "Hub");
    expect(hub.sectors).toHaveLength(5);
    expect(validateMap(hub)).toEqual([]);
    expect(mapFromTemplate("blank", "Empty").sectors).toEqual([]);
    const level = mapFromTemplate("level", "Level");
    expect(level).toMatchObject({ ...starterMap, name: "Level" });
    expect(level.things).not.toBe(starterMap.things);
    room.things.pop();
    expect(mapFromTemplate("room", "Again").things).toHaveLength(1);
  });

  it("reads par times", () => {
    expect(parsePar("2:15")).toBe(135);
    expect(parsePar("90")).toBe(90);
    expect(parsePar("")).toBeNull();
    expect(parsePar("1:99")).toBeUndefined();
    expect(parsePar("soon")).toBeUndefined();
  });

  it("round-trips an episode backup with new ids", () => {
    const episode = createEpisode("Ashfall");
    const entry = createMapEntry(episode.id, "MAP03", starterMap, {
      description: "Hub",
      par: 135,
      music: "D_RUNNIN",
      sky: "SKY3",
      intertext: "Onward.",
    });
    expect(createMapEntry(episode.id, "MAP04", starterMap)).not.toHaveProperty(
      "music",
    );
    const backup = parseEpisodeBackup(serializeEpisode(episode, [entry]));
    expect(backup.episode.name).toBe("Ashfall");
    expect(backup.episode.id).not.toBe(episode.id);
    expect(backup.maps[0]).toMatchObject({
      slot: "MAP03",
      description: "Hub",
      par: 135,
      music: "D_RUNNIN",
      sky: "SKY3",
      intertext: "Onward.",
      map: starterMap,
      episodeId: backup.episode.id,
    });
    expect(backup.maps[0].id).not.toBe(entry.id);
    const file = JSON.parse(serializeEpisode(episode, [entry]));
    file.maps[0].music = "not a lump";
    expect(() => parseEpisodeBackup(JSON.stringify(file))).toThrow("lump");
  });

  it("rejects a backup with repeated slots", () => {
    const episode = createEpisode("Ashfall");
    const entry = createMapEntry(episode.id, "MAP01", starterMap);
    const file = JSON.parse(serializeEpisode(episode, [entry]));
    file.maps.push(file.maps[0]);
    expect(() => parseEpisodeBackup(JSON.stringify(file))).toThrow("map slot");
  });

  it("writes each episode map into its slot", () => {
    const wad = compileEpisode([
      { slot: "MAP01", map: starterMap },
      { slot: "MAP03", map: starterMap },
    ]);
    // Two maps of eleven lumps, their UMAPINFO and the COMPLVL lump.
    const text = String.fromCharCode(...wad.slice(-24 * 16));
    expect(text).toContain("MAP01");
    expect(text).toContain("MAP03");
    expect(text).toContain("UMAPINFO");
    expect(text).toContain("COMPLVL");
    expect(new DataView(wad.buffer).getInt32(4, true)).toBe(24);
  });
});
