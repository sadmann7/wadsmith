import { describe, expect, it, vi } from "vitest";

import { testMap } from "../map/test-map";
import {
  hostRoom,
  joinRoom,
  type CoopGame,
  type RoomMessage,
  type RoomTransport,
} from "./room";

// Delivers each message to every other member, like a BroadcastChannel.
function createHub() {
  const members = new Set<{ handler: (message: RoomMessage) => void }>();
  const transport = (): RoomTransport => {
    const member = { handler: (_message: RoomMessage) => {} };
    members.add(member);
    return {
      post: (message) => {
        for (const other of members) {
          if (other !== member) queueMicrotask(() => other.handler(message));
        }
      },
      listen: (handler) => {
        member.handler = handler;
      },
      identify: () => {},
      close: () => {
        members.delete(member);
      },
    };
  };
  return { transport };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function guestEvents() {
  return {
    onJoined: vi.fn(),
    onRefused: vi.fn(),
    onRoster: vi.fn(),
    onStart: vi.fn(),
    onPacket: vi.fn(),
    onSignal: vi.fn(),
    onClosed: vi.fn(),
  };
}

const game: CoopGame = {
  map: testMap,
  mode: "coop",
  wad: new Uint8Array([1, 2, 3]),
  title: "Starter map",
  slot: "MAP01",
  par: null,
};

describe("co-op room", () => {
  it("numbers guests after the host and shares the roster", async () => {
    const hub = createHub();
    const onRoster = vi.fn();
    hostRoom(
      hub.transport(),
      { title: "Starter map", maxPlayers: 3 },
      {
        onRoster,
        onLeft: vi.fn(),
        onPacket: vi.fn(),
        onSignal: vi.fn(),
        onDropped: vi.fn(),
      },
    );
    const first = guestEvents();
    const second = guestEvents();
    joinRoom(hub.transport(), first);
    await settle();
    joinRoom(hub.transport(), second);
    await settle();
    expect(first.onJoined).toHaveBeenCalledWith(2, "Starter map");
    expect(second.onJoined).toHaveBeenCalledWith(3, "Starter map");
    expect(onRoster).toHaveBeenLastCalledWith([1, 2, 3]);
    expect(first.onRoster).toHaveBeenLastCalledWith([1, 2, 3]);
  });

  it("refuses players once the room is full or started", async () => {
    const hub = createHub();
    const host = hostRoom(
      hub.transport(),
      { title: "Map", maxPlayers: 2 },
      {
        onRoster: vi.fn(),
        onLeft: vi.fn(),
        onPacket: vi.fn(),
        onSignal: vi.fn(),
        onDropped: vi.fn(),
      },
    );
    joinRoom(hub.transport(), guestEvents());
    await settle();
    const late = guestEvents();
    joinRoom(hub.transport(), late);
    await settle();
    expect(late.onRefused).toHaveBeenCalledWith("This game is full.");
    expect(host.peers()).toEqual([1, 2]);
  });

  it("frees a slot when a guest leaves", async () => {
    const hub = createHub();
    const onRoster = vi.fn();
    const onLeft = vi.fn();
    hostRoom(
      hub.transport(),
      { title: "Map", maxPlayers: 2 },
      {
        onRoster,
        onLeft,
        onPacket: vi.fn(),
        onSignal: vi.fn(),
        onDropped: vi.fn(),
      },
    );
    const guest = joinRoom(hub.transport(), guestEvents());
    await settle();
    guest.leave();
    await settle();
    expect(onRoster).toHaveBeenLastCalledWith([1]);
    expect(onLeft).toHaveBeenCalledWith(2);
    const next = guestEvents();
    joinRoom(hub.transport(), next);
    await settle();
    expect(next.onJoined).toHaveBeenCalledWith(2, "Map");
  });

  it("delivers packets only to the player they're for", async () => {
    const hub = createHub();
    const onPacket = vi.fn();
    const host = hostRoom(
      hub.transport(),
      { title: "Map", maxPlayers: 3 },
      {
        onRoster: vi.fn(),
        onLeft: vi.fn(),
        onPacket,
        onSignal: vi.fn(),
        onDropped: vi.fn(),
      },
    );
    const first = guestEvents();
    const second = guestEvents();
    const guest = joinRoom(hub.transport(), first);
    await settle();
    joinRoom(hub.transport(), second);
    await settle();
    host.send(3, new Uint8Array([9]));
    guest.send(1, new Uint8Array([7]));
    await settle();
    expect(second.onPacket).toHaveBeenCalledWith(1, new Uint8Array([9]));
    expect(first.onPacket).not.toHaveBeenCalled();
    expect(onPacket).toHaveBeenCalledWith(2, new Uint8Array([7]));
  });

  it("starts every guest and tells them when the host leaves", async () => {
    const hub = createHub();
    const host = hostRoom(
      hub.transport(),
      { title: "Map", maxPlayers: 2 },
      {
        onRoster: vi.fn(),
        onLeft: vi.fn(),
        onPacket: vi.fn(),
        onSignal: vi.fn(),
        onDropped: vi.fn(),
      },
    );
    const guest = guestEvents();
    joinRoom(hub.transport(), guest);
    await settle();
    host.start(game);
    await settle();
    expect(guest.onStart).toHaveBeenCalledWith(game);
    const late = guestEvents();
    joinRoom(hub.transport(), late);
    await settle();
    expect(late.onRefused).toHaveBeenCalledWith(
      "This game has already started.",
    );
    host.close();
    await settle();
    expect(guest.onClosed).toHaveBeenCalledWith("The host ended the game.");
  });

  it("passes WebRTC setup between a guest and the host", async () => {
    const hub = createHub();
    const onSignal = vi.fn();
    const host = hostRoom(
      hub.transport(),
      { title: "Map", maxPlayers: 2 },
      {
        onRoster: vi.fn(),
        onLeft: vi.fn(),
        onPacket: vi.fn(),
        onSignal,
        onDropped: vi.fn(),
      },
    );
    const events = guestEvents();
    const guest = joinRoom(hub.transport(), events);
    await settle();
    guest.signal(1, { description: { type: "offer", sdp: "offer" } });
    host.signal(2, { description: { type: "answer", sdp: "answer" } });
    await settle();
    expect(onSignal).toHaveBeenCalledWith(2, {
      description: { type: "offer", sdp: "offer" },
    });
    expect(events.onSignal).toHaveBeenCalledWith(1, {
      description: { type: "answer", sdp: "answer" },
    });
  });

  it("tells a guest when its connection to the room drops", async () => {
    let deliver: (message: RoomMessage) => void = () => {};
    const events = guestEvents();
    joinRoom(
      {
        post: () => {},
        listen: (handler) => {
          deliver = handler;
        },
        identify: () => {},
        close: () => {},
      },
      events,
    );
    deliver({ type: "dropped" });
    expect(events.onClosed).toHaveBeenCalledWith(
      "Lost the connection to the game.",
    );
  });
});
