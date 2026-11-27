import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { unstable_dev, type Unstable_DevWorker } from "wrangler";

// Every test waits on the local Workers runtime, a separate process that
// slows down as much as the machine does.
vi.setConfig({ testTimeout: 30_000 });

let worker: Unstable_DevWorker;
let base: string;
const origin = "http://localhost:3000";

beforeAll(async () => {
  worker = await unstable_dev(resolve(import.meta.dirname, "index.ts"), {
    config: resolve(import.meta.dirname, "../wrangler.jsonc"),
    ip: "127.0.0.1",
    persist: false,
    vars: { MAP_HELLO_SECONDS: "1" },
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

interface Live {
  socket: WebSocket;
  next: () => Promise<Record<string, unknown>>;
  closed: Promise<number>;
}

describe("live editing", () => {
  it("hands every editor each edit in order, and keeps it", async () => {
    const { id, secret } = await create({
      ...map,
      things: [{ id: "imp-1", kind: "imp", x: 0, y: 0, angle: 0 }],
    });
    const a = await live(id);
    a.socket.send(
      JSON.stringify({
        type: "hello",
        secret,
        name: "Ana",
        client: "a".repeat(24),
      }),
    );
    const welcome = await a.next();
    expect(welcome).toEqual({
      type: "welcome",
      peer: 1,
      suffix: expect.stringMatching(/^[a-z]{3}$/),
      revision: 1,
      map: {
        ...map,
        things: [{ id: "imp-1", kind: "imp", x: 0, y: 0, angle: 0 }],
      },
      peers: [],
    });
    // Bo asks for the letters Ana's ids end with, and gets others.
    const b = await live(id);
    b.socket.send(
      JSON.stringify({
        type: "hello",
        secret,
        name: "Bo",
        suffix: welcome.suffix,
      }),
    );
    const bo = await b.next();
    expect(bo).toMatchObject({ peer: 2, peers: [{ peer: 1, name: "Ana" }] });
    expect(bo.suffix).toMatch(/^[a-z]{3}$/);
    expect(bo.suffix).not.toBe(welcome.suffix);
    expect(await a.next()).toEqual({ type: "join", peer: 2, name: "Bo" });

    const moved = { id: "imp-1", kind: "imp", x: 64, y: 0, angle: 0 };
    a.socket.send(
      JSON.stringify({
        type: "patch",
        id: 7,
        patch: { merge: { things: { "imp-1": { x: 64 } } } },
      }),
    );
    const echo = {
      type: "patch",
      revision: 2,
      peer: 1,
      id: 7,
      client: "a".repeat(24),
    };
    expect(await a.next()).toMatchObject(echo);
    expect(await b.next()).toMatchObject(echo);

    // The same edit sent again after a drop is taken once.
    a.socket.send(
      JSON.stringify({
        type: "patch",
        id: 7,
        patch: { merge: { things: { "imp-1": { x: 64 } } } },
      }),
    );
    expect(await a.next()).toEqual({ type: "ack", id: 7, revision: 2 });

    // An add under an id someone else just took is turned away.
    b.socket.send(
      JSON.stringify({
        type: "patch",
        id: 1,
        patch: { set: { things: { "imp-1": { ...moved, x: 9 } } } },
      }),
    );
    expect(await b.next()).toEqual({ type: "refused", id: 1, error: "taken" });
    expect(await (await send(`/maps/${id}`)).json()).toMatchObject({
      revision: 2,
      map: { things: [moved] },
    });

    b.socket.send(JSON.stringify({ type: "cursor", x: 10.4, y: -3 }));
    expect(await a.next()).toEqual({
      type: "cursor",
      peer: 2,
      at: { x: 10, y: -3 },
    });

    // A whole map saved over the web tells everyone to read it again.
    expect((await put(id, secret, 2, map)).status).toBe(200);
    expect(await a.next()).toEqual({ type: "map", revision: 3, map });

    b.socket.close();
    expect(await a.next()).toEqual({ type: "leave", peer: 2 });
    a.socket.close();
  });

  it("turns away a connection without the secret and a bad patch", async () => {
    const { id, secret } = await create();
    const stranger = await live(id);
    stranger.socket.send(JSON.stringify({ type: "hello", secret: "nope" }));
    expect(await stranger.closed).toBe(4003);

    const editor = await live(id);
    editor.socket.send(JSON.stringify({ type: "hello", secret }));
    await editor.next();
    editor.socket.send(
      JSON.stringify({ type: "patch", patch: { set: { secrets: {} } } }),
    );
    editor.socket.send(JSON.stringify({ type: "cursor", x: 1, y: 2 }));
    // A room on a corner the map doesn't have is turned away.
    editor.socket.send(
      JSON.stringify({
        type: "patch",
        id: 1,
        patch: {
          set: {
            sectors: { s: { id: "s", vertices: ["a", "b", "c"] } },
          },
        },
      }),
    );
    expect(await editor.next()).toEqual({
      type: "refused",
      id: 1,
      error: "missing-corners",
    });
    // The bad patch is dropped, and nothing came back for either message.
    expect(await (await send(`/maps/${id}`)).json()).toMatchObject({
      revision: 1,
    });
    editor.socket.close();
    await expect(live("0000000000000000")).rejects.toThrow();
  });

  it("keeps edits made in quick succession, and lets a silent link go", async () => {
    const { id, secret } = await create({ ...map, things: [] });
    const editor = await live(id);
    editor.socket.send(JSON.stringify({ type: "hello", secret }));
    await editor.next();
    for (let x = 1; x <= 5; x += 1) {
      editor.socket.send(
        JSON.stringify({
          type: "patch",
          id: x,
          patch:
            x === 1
              ? {
                  set: {
                    things: { t: { id: "t", kind: "imp", x, y: 0, angle: 0 } },
                  },
                }
              : { merge: { things: { t: { x } } } },
        }),
      );
    }
    for (let x = 1; x <= 5; x += 1) {
      expect(await editor.next()).toMatchObject({ type: "patch", id: x });
    }
    // A read straight after sees every edit, saved or still in memory.
    expect(await (await send(`/maps/${id}`)).json()).toMatchObject({
      revision: 6,
      map: { things: [{ x: 5 }] },
    });
    editor.socket.close();

    // A connection that never shows the secret is let go once a new one
    // comes after its time is up.
    const silent = await live(id);
    await new Promise((done) => setTimeout(done, 1200));
    const next = await live(id);
    expect(await silent.closed).toBe(4003);
    next.socket.close();
  });
});

function live(id: string) {
  return new Promise<Live>((done, fail) => {
    const socket = new WebSocket(
      `${base.replace("http", "ws")}/maps/${id}/live`,
      {
        headers: { Origin: origin },
      } as unknown as string[],
    );
    const received: Record<string, unknown>[] = [];
    const waiting: ((message: Record<string, unknown>) => void)[] = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      const take = waiting.shift();
      if (take) take(message);
      else received.push(message);
    });
    const closed = new Promise<number>((close) =>
      socket.addEventListener("close", (event) => close(event.code)),
    );
    socket.addEventListener("open", () =>
      done({
        socket,
        closed,
        next: () =>
          new Promise((take) => {
            const message = received.shift();
            if (message) take(message);
            else waiting.push(take);
          }),
      }),
    );
    socket.addEventListener("error", () => fail(new Error("Refused.")));
  });
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
