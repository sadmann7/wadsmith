import { describe, expect, it } from "vitest";

import { playLink, playTarget, publish } from "./published";

const id = "0123456789abcdef0123";

describe("published maps", () => {
  it("makes and reads play links", () => {
    const link = playLink("https://wadsmith.com", id);
    expect(link).toBe(`https://wadsmith.com/play/${id}`);
    expect(playTarget(new URL(link).pathname)).toBe(id);
    expect(playTarget("/play/short")).toBeNull();
    expect(playTarget("/maps")).toBeNull();
  });

  it("sends the WAD as base64 and returns the link's id", async () => {
    let sent: Record<string, unknown> = {};
    const wad = Uint8Array.from({ length: 70_000 }, (_, index) => index % 256);
    const found = await publish(
      {
        kind: "map",
        title: "Hangar",
        author: "",
        game: "freedoom2",
        complevel: "vanilla",
        warp: 1,
        maps: [{ slot: "MAP01", name: "Hangar" }],
        listed: true,
        wad,
        source: "{}",
      },
      "https://rooms.test",
      async (_url, init) => {
        sent = JSON.parse(init?.body as string) as Record<string, unknown>;
        return new Response(JSON.stringify({ id }), { status: 201 });
      },
    );
    expect(found).toBe(id);
    expect(
      Uint8Array.from(atob(String(sent.wad)), (char) => char.charCodeAt(0)),
    ).toEqual(wad);
    expect(sent).toMatchObject({ title: "Hangar", source: "{}" });
  });

  it("says why a publish failed", async () => {
    const request = {
      kind: "map" as const,
      title: "x",
      author: "",
      game: "freedoom2",
      complevel: "vanilla",
      warp: 1,
      maps: [{ slot: "MAP01", name: "x" }],
      listed: false,
      wad: new Uint8Array(4),
      source: "{}",
    };
    await expect(
      publish(request, "https://rooms.test", async () =>
        Response.json({ error: "That's too big to publish." }, { status: 413 }),
      ),
    ).rejects.toThrow("That's too big to publish.");
    await expect(publish(request, null)).rejects.toThrow(/can't publish/);
  });
});
