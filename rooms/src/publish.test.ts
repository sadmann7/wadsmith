import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_dev, type Unstable_DevWorker } from "wrangler";

let worker: Unstable_DevWorker;
let base: string;
const origin = "http://localhost:3000";

beforeAll(async () => {
  worker = await unstable_dev(resolve(import.meta.dirname, "index.ts"), {
    config: resolve(import.meta.dirname, "../wrangler.jsonc"),
    ip: "127.0.0.1",
    persist: false,
    logLevel: "none",
    experimental: { disableExperimentalWarning: true },
  });
  base = `http://${worker.address}:${worker.port}`;
}, 60_000);

afterAll(async () => {
  await worker?.stop();
});

const wad = Uint8Array.from([0x50, 0x57, 0x41, 0x44, 0, 0, 0, 0, 12, 0, 0, 0]);

describe("published maps", () => {
  it("keeps a published map for good behind one link", async () => {
    const made = await publish();
    expect(made.status).toBe(201);
    const { id } = (await made.json()) as { id: string };
    expect(id).toMatch(/^[0-9a-f]{20}$/);

    const manifest = await fetch(`${base}/published/${id}`, {
      headers: { Origin: origin },
    });
    expect(manifest.headers.get("Cache-Control")).toContain("immutable");
    expect(await manifest.json()).toMatchObject({
      id,
      kind: "map",
      title: "Hangar",
      author: "Ana",
      warp: 1,
      listed: true,
    });
    const file = await fetch(`${base}/published/${id}/wad`);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(wad);
    const source = await fetch(`${base}/published/${id}/source`);
    expect(await source.json()).toEqual({ format: "wadsmith-map" });

    // The same map published again keeps its link.
    const again = await publish();
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ id, existed: true });
  });

  it("lists only the maps their authors chose to show", async () => {
    await publish({ title: "Shown" });
    await publish({ title: "Hidden", listed: false });
    const { maps } = (await (await fetch(`${base}/gallery`)).json()) as {
      maps: { title: string; maps: number }[];
    };
    const titles = maps.map((entry) => entry.title);
    expect(titles).toContain("Shown");
    expect(titles).not.toContain("Hidden");
    expect(maps[0].maps).toBe(1);
  });

  it("turns away what isn't a map to publish", async () => {
    expect((await publish({ wad: btoa("JUNKJUNK") })).status).toBe(400);
    expect((await publish({ kind: "song" })).status).toBe(400);
    expect((await publish({ maps: [{ slot: "LEVEL9" }] })).status).toBe(400);
    expect((await publish({ source: "{" })).status).toBe(400);
    expect((await publish({}, "https://example.com")).status).toBe(403);
    expect((await fetch(`${base}/published/00000000000000000000`)).status).toBe(
      404,
    );
  });
});

function publish(details: Record<string, unknown> = {}, from = origin) {
  return fetch(`${base}/published`, {
    method: "POST",
    headers: { Origin: from },
    body: JSON.stringify({
      kind: "map",
      title: "Hangar",
      author: "Ana",
      game: "freedoom2",
      complevel: "vanilla",
      warp: 1,
      maps: [{ slot: "MAP01", name: "Hangar" }],
      listed: true,
      wad: btoa(String.fromCharCode(...wad)),
      source: JSON.stringify({ format: "wadsmith-map" }),
      ...details,
    }),
  });
}
