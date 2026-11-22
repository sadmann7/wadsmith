import { describe, expect, it } from "vitest";

import type { GameMap } from "@/lib/map/types";

import { testMap } from "@/lib/map/test-map";

import {
  cloudBase,
  createCloudApi,
  editLink,
  parseCloudLink,
  sharedTarget,
  syncMap,
  viewLink,
} from "./cloud";

const id = "abcdefghijklmnop";
const secret = "0123456789abcdef".repeat(3);

const renamed = (name: string): GameMap => ({ ...testMap, name });

describe("a map's online copy", () => {
  it("reaches the rooms server over http", () => {
    expect(cloudBase("wss://rooms.example.com")).toBe(
      "https://rooms.example.com",
    );
    expect(cloudBase("ws://localhost:8787")).toBe("http://localhost:8787");
    expect(cloudBase("")).toBeNull();
  });

  it("makes edit and view links and reads them back", () => {
    const link = { id, secret, revision: 3 };
    const edit = editLink("https://wadsmith.com", link);
    expect(edit).toBe(`https://wadsmith.com/shared/${id}#${secret}`);
    expect(viewLink("https://wadsmith.com", link)).toBe(
      `https://wadsmith.com/shared/${id}`,
    );
    const { pathname, hash } = new URL(edit);
    expect(sharedTarget(pathname, hash)).toEqual({ id, secret });
    expect(sharedTarget(pathname, "")).toEqual({ id });
    expect(sharedTarget(pathname, "#nope")).toEqual({ id });
    expect(sharedTarget("/shared/short", "")).toBeNull();
    expect(sharedTarget("/maps/x", "")).toBeNull();
  });

  it("stores a link only when it is well formed", () => {
    expect(parseCloudLink({ id, secret, revision: 2, pending: true })).toEqual({
      id,
      secret,
      revision: 2,
      pending: true,
    });
    expect(parseCloudLink({ id, secret: "x", revision: 2 })).toEqual({
      id,
      revision: 2,
    });
    expect(parseCloudLink({ id: "../x", revision: 2 })).toBeUndefined();
    expect(parseCloudLink({ id, revision: 0 })).toBeUndefined();
    expect(parseCloudLink(null)).toBeUndefined();
  });

  it("pushes edits, pulls a newer copy and reports when both changed", async () => {
    const { api } = fakeServer();
    const made = await api.create(renamed("First"));
    expect(made.revision).toBe(1);

    const pushed = await syncMap(
      api,
      { ...made, pending: true },
      renamed("Second"),
    );
    expect(pushed).toEqual({ kind: "pushed", link: { ...made, revision: 2 } });

    const pulled = await syncMap(api, made, renamed("Ignored"));
    expect(pulled).toMatchObject({
      kind: "pulled",
      link: { revision: 2 },
      map: { name: "Second" },
    });
    expect(await syncMap(api, { ...made, revision: 2 }, testMap)).toEqual({
      kind: "same",
    });

    const clash = await syncMap(
      api,
      { ...made, pending: true },
      renamed("Third"),
    );
    expect(clash).toMatchObject({
      kind: "conflict",
      revision: 2,
      map: { name: "Second" },
    });
  });

  it("refuses a copy the server can't vouch for", async () => {
    const { api, copies } = fakeServer();
    const made = await api.create(testMap);
    copies.set(made.id, { revision: 2, map: '{"sectors":"nope"}' });
    await expect(api.read(made.id)).rejects.toThrow();
    await expect(
      syncMap(api, { id: "missingmissingmi", revision: 1 }, testMap),
    ).rejects.toThrow(/no longer exists/);
    await expect(api.write({ id, revision: 1 }, testMap)).rejects.toThrow(
      /can only be read/,
    );
    const down = createCloudApi("https://rooms.test", () =>
      Promise.reject(new TypeError("offline")),
    );
    await expect(down.read(id)).rejects.toThrow(/can't be reached/);
  });
});

function fakeServer() {
  const copies = new Map<string, { revision: number; map: string }>();
  let next = 0;
  const send = async (url: string | URL | Request, init: RequestInit = {}) => {
    const { pathname, searchParams } = new URL(url as string);
    const body = init.body as string;
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status });
    if (pathname === "/maps" && init.method === "POST") {
      next += 1;
      const made = `copy${String(next).padStart(12, "0")}`;
      copies.set(made, { revision: 1, map: body });
      return json({ id: made, secret, revision: 1 }, 201);
    }
    const copy = copies.get(pathname.split("/")[2]);
    if (!copy) return json({ error: "No such map." }, 404);
    if (!init.method) {
      return json({ revision: copy.revision, map: JSON.parse(copy.map) });
    }
    if (Number(searchParams.get("base")) !== copy.revision) {
      return json({ revision: copy.revision, map: JSON.parse(copy.map) }, 409);
    }
    copy.revision += 1;
    copy.map = body;
    return json({ revision: copy.revision });
  };
  return { copies, api: createCloudApi("https://rooms.test", send) };
}
