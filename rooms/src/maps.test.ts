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

const map = { vertices: {}, sectors: [], things: [], switches: [] };

const put = (id: string, secret: string, from: number, body: unknown) =>
  send(`/maps/${id}?base=${from}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });

describe("online map copies", () => {
  it("keeps a map that anyone with its id can read", async () => {
    const made = await create();
    expect(made.id).toMatch(/^[a-z0-9]{16}$/);
    expect(made.secret).toMatch(/^[0-9a-f]{48}$/);
    expect(made.revision).toBe(1);
    const read = await send(`/maps/${made.id}`);
    expect(read.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(await read.json()).toEqual({ revision: 1, map });
    expect((await send("/maps/0000000000000000")).status).toBe(404);
  });

  it("writes only with the secret and on top of the latest revision", async () => {
    const { id, secret } = await create();
    const named = { ...map, name: "Hangar" };
    const written = await put(id, secret, 1, named);
    expect(await written.json()).toEqual({ revision: 2 });
    expect(await (await send(`/maps/${id}`)).json()).toEqual({
      revision: 2,
      map: named,
    });

    const stale = await put(id, secret, 1, { ...map, name: "Old" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ revision: 2, map: named });

    const wrong = await put(id, "0".repeat(48), 2, map);
    expect(wrong.status).toBe(403);
    expect((await put(id, secret, 0, map)).status).toBe(400);
    expect(
      (await send(`/maps/${id}?base=2`, { method: "PUT", body: "{}" })).status,
    ).toBe(400);
  });

  it("keeps a big map in parts and reads it back whole", async () => {
    const note = { id: "n", x: 0, y: 0, text: "é".repeat(1_500_000) };
    const big = { ...map, notes: [note] };
    const { id, secret } = await create(big);
    expect(await (await send(`/maps/${id}`)).json()).toEqual({
      revision: 1,
      map: big,
    });
    expect((await put(id, secret, 1, map)).status).toBe(200);
    expect(await (await send(`/maps/${id}`)).json()).toEqual({
      revision: 2,
      map,
    });
  });

  it("refuses what isn't a map and what is too big", async () => {
    const bad = await send("/maps", { method: "POST", body: "not json" });
    expect(bad.status).toBe(400);
    const big = await send("/maps", {
      method: "POST",
      body: JSON.stringify({ text: "x".repeat(5 * 1024 * 1024) }),
    });
    expect(big.status).toBe(413);
  });

  it("answers a browser's preflight only for allowed sites", async () => {
    const allowed = await send("/maps/abcdefghijklmnop", {
      method: "OPTIONS",
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Methods")).toContain(
      "PUT",
    );
    const other = await fetch(`${base}/maps`, {
      method: "OPTIONS",
      headers: { Origin: "https://example.com" },
    });
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

async function create(body: unknown = map) {
  const response = await send("/maps", {
    method: "POST",
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as {
    id: string;
    secret: string;
    revision: number;
  };
}

function send(
  path: string,
  init: Omit<RequestInit, "headers"> & {
    headers?: Record<string, string>;
  } = {},
) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { Origin: origin, ...init.headers },
  });
}
