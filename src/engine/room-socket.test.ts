import { describe, expect, it } from "vitest";

import { testMap } from "../map/test-map";
import type { RoomMessage } from "./room";
import { decodeMessage, encodeMessage } from "./room-socket";

function roundTrip(message: RoomMessage) {
  const encoded = encodeMessage(message);
  return decodeMessage(
    typeof encoded === "string" ? encoded : encoded.slice().buffer,
  );
}

describe("room messages on the wire", () => {
  it("sends game packets as small binary frames", () => {
    const packet: RoomMessage = {
      type: "packet",
      from: 2,
      to: 1,
      data: new Uint8Array([0, 6, 200]),
    };
    expect(encodeMessage(packet)).toEqual(new Uint8Array([2, 1, 0, 6, 200]));
    expect(roundTrip(packet)).toEqual(packet);
  });

  it("keeps the bytes inside other messages", () => {
    const start: RoomMessage = {
      type: "start",
      game: {
        map: testMap,
        wad: new Uint8Array(70_000).map((_, index) => index % 251),
        title: "Starter map",
        slot: "MAP01",
        par: 30,
      },
    };
    expect(roundTrip(start)).toEqual(start);
  });

  it("ignores frames it can't read", () => {
    expect(decodeMessage("not json")).toBeNull();
    expect(decodeMessage(new Uint8Array([1, 2]).buffer)).toBeNull();
  });
});
