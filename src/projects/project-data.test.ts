import { afterEach, describe, expect, it, vi } from "vitest";

import { starterMap } from "../map/starter-map";
import { serializeMap } from "../map/storage";
import { validateMap } from "../map/validate";
import { compileEpisode } from "../wad/compile";
import {
  createMapEntry,
  createMapSaver,
  createProject,
  episodeMaps,
  freeSlots,
  isSlotConflict,
  lastMapKey,
  mapFromTemplate,
  mapStatus,
  parsePar,
  parseProjectBackup,
  prepareProjects,
  serializeProject,
  slotMoves,
} from "./project-data";
import { createMemoryStore } from "./project-store";

function stubLegacy(saved: string | null) {
  vi.stubGlobal("localStorage", {
    getItem: () => saved,
    setItem: () => {},
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("project storage", () => {
  it("starts a new browser with the starter map open", async () => {
    stubLegacy(null);
    const store = createMemoryStore();
    const ready = await prepareProjects(store);
    expect(ready.projects).toHaveLength(1);
    expect(ready.entry).toMatchObject({ slot: "MAP01", map: starterMap });
    expect(await store.getSetting(lastMapKey)).toBe(ready.entry?.id);
  });

  it("creates one first project when tabs start together", async () => {
    stubLegacy(null);
    const store = createMemoryStore();
    await Promise.all([prepareProjects(store), prepareProjects(store)]);
    const projects = await store.listProjects();
    expect(projects).toHaveLength(1);
    expect(await store.listMaps(projects[0].id)).toHaveLength(1);
  });

  it("moves the old saved map into the first project", async () => {
    stubLegacy(serializeMap({ ...starterMap, name: "My old map" }));
    const ready = await prepareProjects(createMemoryStore());
    expect(ready.entry?.map.name).toBe("My old map");
  });

  it("returns to Project Home when no map was left open", async () => {
    stubLegacy(null);
    const store = createMemoryStore();
    const first = await prepareProjects(store);
    await store.setSetting(lastMapKey, null);
    const again = await prepareProjects(store);
    expect(again.entry).toBeNull();
    expect(again.projectId).toBe(first.projectId);
    expect(again.projects).toHaveLength(1);
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
    ).rejects.toSatisfy(isSlotConflict);
  });

  it("creates the first project and map together", async () => {
    stubLegacy(null);
    const store = createMemoryStore();
    store.addProject = () => Promise.reject(new Error("full"));
    await expect(prepareProjects(store)).rejects.toThrow("full");
    expect(await store.listProjects()).toEqual([]);
  });

  it("marks an unreadable stored map instead of failing the project", async () => {
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

  it("deletes a project with its maps", async () => {
    const store = createMemoryStore();
    const project = createProject("Ashfall");
    await store.putProject(project);
    await store.putMap(createMapEntry(project.id, "MAP01", starterMap));
    await store.deleteProject(project.id);
    expect(await store.listMaps(project.id)).toEqual([]);
  });
});

describe("first episode", () => {
  it("is called Episode 1, and keeps a name the player chose", async () => {
    stubLegacy(null);
    const store = createMemoryStore();
    const ready = await prepareProjects(store);
    expect(ready.projects[0].name).toBe("Episode 1");
    await store.putProject({ ...ready.projects[0], name: "My project" });
    expect((await prepareProjects(store)).projects[0].name).toBe("Episode 1");
    await store.putProject({ ...ready.projects[0], name: "Ashfall" });
    await store.putProject({
      id: "older",
      name: "My project",
      createdAt: ready.projects[0].createdAt - 1,
    });
    const renamed = await prepareProjects(store);
    expect(renamed.projects.map((project) => project.name)).toEqual([
      "Episode 1",
      "Ashfall",
    ]);
    await store.deleteProject("older");
    expect((await prepareProjects(store)).projects[0].name).toBe("Ashfall");
  });
});

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
    const project = createProject("Ashfall");
    const a = createMapEntry(project.id, "MAP01", starterMap);
    const b = createMapEntry(project.id, "MAP02", starterMap);
    await store.addProject(project, [a, b]);
    await store.moveMaps(slotMoves([a, b], [b.id, a.id]));
    expect((await store.getMap(a.id))?.slot).toBe("MAP02");
    expect((await store.getMap(b.id))?.slot).toBe("MAP01");
    expect(await store.countMaps(project.id)).toBe(2);
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
    expect(featured.every((entry) => mapStatus(entry).kind !== "error")).toBe(
      true,
    );
  });

  it("names a map with no exit", () => {
    expect(mapStatus(episodeMaps("p", "one")[0]).label).toBe("No exit yet");
  });

  it("names a map that passes its checks but won't build", () => {
    const [entry] = episodeMaps("p", "one");
    const [room] = entry.map.sectors;
    const overlapping = {
      ...entry,
      map: {
        ...entry.map,
        sectors: [...entry.map.sectors, { ...room, id: `${room.id}-copy` }],
      },
    };
    const status = mapStatus(overlapping);
    expect(status.kind).toBe("error");
    expect(status.label).toBe("Won't build");
  });
});

describe("project maps", () => {
  it("offers only free slots", () => {
    const maps = [createMapEntry("p", "MAP01", starterMap)];
    expect(freeSlots(maps)[0]).toBe("MAP02");
    expect(freeSlots(maps, "MAP01")[0]).toBe("MAP01");
    expect(freeSlots(maps)).toHaveLength(31);
  });

  it("creates valid templates without sharing data", () => {
    const room = mapFromTemplate("room", "Room");
    expect(validateMap(room)).toEqual([]);
    const hub = mapFromTemplate("hub", "Hub");
    expect(hub.sectors).toHaveLength(5);
    expect(validateMap(hub)).toEqual([]);
    expect(mapFromTemplate("blank", "Empty").sectors).toEqual([]);
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

  it("round-trips a project backup with new ids", () => {
    const project = createProject("Ashfall");
    const entry = createMapEntry(project.id, "MAP03", starterMap, {
      description: "Hub",
      par: 135,
    });
    const backup = parseProjectBackup(serializeProject(project, [entry]));
    expect(backup.project.name).toBe("Ashfall");
    expect(backup.project.id).not.toBe(project.id);
    expect(backup.maps[0]).toMatchObject({
      slot: "MAP03",
      description: "Hub",
      par: 135,
      map: starterMap,
      projectId: backup.project.id,
    });
    expect(backup.maps[0].id).not.toBe(entry.id);
  });

  it("rejects a backup with repeated slots", () => {
    const project = createProject("Ashfall");
    const entry = createMapEntry(project.id, "MAP01", starterMap);
    const file = JSON.parse(serializeProject(project, [entry]));
    file.maps.push(file.maps[0]);
    expect(() => parseProjectBackup(JSON.stringify(file))).toThrow("map slot");
  });

  it("writes each episode map into its slot", () => {
    const wad = compileEpisode([
      { slot: "MAP01", map: starterMap },
      { slot: "MAP03", map: starterMap },
    ]);
    const text = String.fromCharCode(...wad.slice(-22 * 16));
    expect(text).toContain("MAP01");
    expect(text).toContain("MAP03");
    expect(new DataView(wad.buffer).getInt32(4, true)).toBe(22);
  });
});
