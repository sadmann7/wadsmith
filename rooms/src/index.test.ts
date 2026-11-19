import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_dev, type Unstable_DevWorker } from "wrangler";

import { allowedOrigin } from "./origin";

const origin = "http://localhost:3000";
let worker: Unstable_DevWorker;
let base: string;

beforeAll(async () => {
  worker = await unstable_dev(resolve(import.meta.dirname, "index.ts"), {
    config: resolve(import.meta.dirname, "../wrangler.jsonc"),
    ip: "127.0.0.1",
    persist: false,
    vars: { ROOM_IDLE_SECONDS: "2", ROOM_LIFETIME_SECONDS: "4" },
    logLevel: "none",
    experimental: { disableExperimentalWarning: true },
  });
  base = `ws://${worker.address}:${worker.port}`;
}, 60_000);

afterAll(async () => {
  await worker?.stop();
});

type Client = {
  socket: WebSocket;
  received: (string | ArrayBuffer)[];
  next: () => Promise<string | ArrayBuffer>;
};

function connect(room: string, from = origin) {
  return new Promise<Client>((done, fail) => {
    const socket = new WebSocket(`${base}/rooms/${room}`, {
      headers: { Origin: from },
    } as unknown as string[]);
    socket.binaryType = "arraybuffer";
    const received: (string | ArrayBuffer)[] = [];
    const waiting: ((message: string | ArrayBuffer) => void)[] = [];
    socket.addEventListener("message", (event) => {
      const take = waiting.shift();
      if (take) take(event.data);
      else received.push(event.data);
    });
    socket.addEventListener("open", () =>
      done({
        socket,
        received,
        next: () =>
          new Promise((take) => {
            const message = received.shift();
            if (message !== undefined) take(message);
            else waiting.push(take);
          }),
      }),
    );
    socket.addEventListener("error", () => fail(new Error("Refused.")));
  });
}

const settle = () => new Promise((done) => setTimeout(done, 200));

describe("room server", () => {
  it("relays messages to everyone else in the room", async () => {
    const [a, b, c] = await Promise.all([
      connect("relay01"),
      connect("relay01"),
      connect("relay01"),
    ]);
    a.socket.send('{"type":"hello"}');
    a.socket.send(new Uint8Array([2, 1, 9]));
    expect(await b.next()).toBe('{"type":"hello"}');
    expect(await c.next()).toBe('{"type":"hello"}');
    expect(new Uint8Array((await c.next()) as ArrayBuffer)).toEqual(
      new Uint8Array([2, 1, 9]),
    );
    await settle();
    expect(a.received).toEqual([]);
  });

  it("keeps rooms apart", async () => {
    const [a, other] = await Promise.all([
      connect("apart01"),
      connect("apart02"),
    ]);
    a.socket.send('{"type":"hello"}');
    await settle();
    expect(other.received).toEqual([]);
  });

  it("announces a player whose connection drops", async () => {
    const [host, guest, watcher] = await Promise.all([
      connect("drop01"),
      connect("drop01"),
      connect("drop01"),
    ]);
    host.socket.send('{"type":"identify","peer":1}');
    guest.socket.send('{"type":"identify","peer":2}');
    await settle();
    expect(watcher.received).toEqual([]);
    guest.socket.close();
    expect(await watcher.next()).toBe('{"type":"leave","peer":2}');
    host.socket.close();
    expect(await watcher.next()).toBe('{"type":"close"}');
  });

  it("turns away other sites and a full room", async () => {
    await expect(connect("guard01", "https://example.com")).rejects.toThrow();
    const full = await Promise.all(
      Array.from({ length: 8 }, () => connect("guard02")),
    );
    await expect(connect("guard02")).rejects.toThrow();
    for (const client of full) client.socket.close();
  });
});

describe("room limits", () => {
  const closed = (client: Client) =>
    new Promise<{ code: number; reason: string }>((done) =>
      client.socket.addEventListener("close", (event) =>
        done({ code: event.code, reason: event.reason }),
      ),
    );

  it("closes a connection that sends an oversized message", async () => {
    const [a, b] = await Promise.all([connect("limit01"), connect("limit01")]);
    const done = closed(a);
    a.socket.send(new Uint8Array(32 * 1024));
    expect((await done).code).toBe(1008);
    await settle();
    expect(b.received).toEqual([]);
  });

  it("closes a connection that floods the room", async () => {
    const [a, b] = await Promise.all([connect("limit02"), connect("limit02")]);
    const done = closed(a);
    for (let index = 0; index < 1200; index += 1) {
      a.socket.send(new Uint8Array([2, 1, index % 256]));
    }
    expect((await done).code).toBe(1008);
    await settle();
    expect(b.received.length).toBeLessThan(800);
  });

  it("closes a room that goes quiet", async () => {
    const a = await connect("limit03");
    a.socket.send('{"type":"hello"}');
    expect((await closed(a)).reason).toBe("This room was idle.");
  }, 10_000);

  it("closes a busy room once its lifetime is up", async () => {
    const a = await connect("limit04");
    const timer = setInterval(() => a.socket.send('{"type":"ping"}'), 300);
    const result = await closed(a);
    clearInterval(timer);
    expect(result.reason).toBe("This room has expired.");
  }, 15_000);
});

describe("allowed origins", () => {
  const allowed =
    "https://wadsmith.com http://localhost:* https://wadsmith-*-team.vercel.app";

  it("allows listed sites and any local port", () => {
    expect(allowedOrigin("https://wadsmith.com", allowed)).toBe(true);
    expect(allowedOrigin("http://localhost:3177", allowed)).toBe(true);
    expect(
      allowedOrigin("https://wadsmith-a1b2c3-team.vercel.app", allowed),
    ).toBe(true);
  });

  it("refuses look-alikes", () => {
    expect(allowedOrigin("https://wadsmith.com.evil.dev", allowed)).toBe(false);
    expect(allowedOrigin("http://localhost:3177.evil.dev", allowed)).toBe(
      false,
    );
    expect(allowedOrigin("http://localhost", allowed)).toBe(false);
    expect(
      allowedOrigin("https://wadsmith-evil.dev/x-team.vercel.app", allowed),
    ).toBe(false);
    expect(
      allowedOrigin("https://wadsmith-a.evil.dev-team.vercel.app", allowed),
    ).toBe(false);
    expect(allowedOrigin("https://wadsmithxcom", allowed)).toBe(false);
  });
});
