import { describe, expect, it } from "vitest";

import { maxPacket, NetInbox } from "./net-inbox";

const bytes = (length: number, fill: number) =>
  new Uint8Array(length).fill(fill);

describe("network inbox", () => {
  it("delivers packets in order with their peer", () => {
    const inbox = NetInbox.create(1024);
    inbox.push(2, bytes(3, 7));
    inbox.push(5, bytes(1, 9));
    expect(inbox.pop()).toEqual({ peer: 2, data: bytes(3, 7) });
    expect(inbox.pop()).toEqual({ peer: 5, data: bytes(1, 9) });
    expect(inbox.pop()).toBeNull();
  });

  it("wraps records around the end of the ring", () => {
    const inbox = NetInbox.create(64);
    for (let round = 0; round < 50; round += 1) {
      expect(inbox.push(round + 1, bytes(13, round))).toBe(true);
      expect(inbox.pop()).toEqual({ peer: round + 1, data: bytes(13, round) });
    }
  });

  it("drops packets that are empty, too large or don't fit", () => {
    const inbox = NetInbox.create(64);
    expect(inbox.push(1, new Uint8Array(0))).toBe(false);
    expect(inbox.push(1, bytes(maxPacket + 1, 1))).toBe(false);
    expect(inbox.push(1, bytes(40, 1))).toBe(true);
    expect(inbox.push(1, bytes(40, 2))).toBe(false);
    expect(inbox.pop()?.data).toEqual(bytes(40, 1));
  });

  it("returns from a wait once a packet is waiting", () => {
    const inbox = NetInbox.create(64);
    inbox.push(1, bytes(4, 1));
    const start = performance.now();
    inbox.wait(1000);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it("rejects a ring that isn't a power of two", () => {
    expect(() => NetInbox.create(100)).toThrow();
  });
});
