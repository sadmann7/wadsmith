import { afterEach, describe, expect, it, vi } from "vitest";

import { testMap } from "@/lib/map/test-map";

import {
  type CoopGame,
  formatRoomCode,
  hostRoom,
  joinRoom,
  newRoomCode,
  packGame,
  parseRoomCode,
  type RoomMessage,
  type RoomTransport,
  unpackGame,
} from "./room";
import { encodeMessage } from "./room-socket";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const game: CoopGame = {
  map: testMap,
  mode: "coop",
  skill: "hard",
  wad: new Uint8Array(40_000).map((_, index) => index % 251),
  title: "Test map",
  slot: "MAP01",
  par: 90,
  intertext: "The base is quiet now.",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("co-op room", () => {
  it("tells a visitor about the room before they join", async () => {
    const { host, guest } = openRoom();
    const visitor = guest();
    await settle();
    expect(visitor.events.onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Test map",
        host: "Sadman",
        mode: "coop",
        skill: "hard",
        maxPlayers: 3,
        started: false,
        players: [expect.objectContaining({ peer: 1, name: "Sadman" })],
      }),
    );
    host.close();
  });

  it("numbers guests by name and sends each one the map", async () => {
    const { host, events, guest } = openRoom();
    const ana = guest();
    ana.room.join("Ana");
    await settle();
    const jules = guest();
    jules.room.join("jules");
    await settle();
    await settle();
    expect(ana.events.onJoined).toHaveBeenCalledWith(2);
    expect(jules.events.onJoined).toHaveBeenCalledWith(3);
    expect(ana.events.onGame).toHaveBeenCalledWith(game);
    expect(ana.events.onProgress).toHaveBeenLastCalledWith(1);
    expect(host.players()).toEqual([
      expect.objectContaining({ peer: 1, name: "Sadman", ready: true }),
      expect.objectContaining({ peer: 2, name: "Ana", ready: true }),
      expect.objectContaining({ peer: 3, name: "jules", ready: true }),
    ]);
    expect(events.onRoster).toHaveBeenCalled();
    host.close();
  });

  it("gives guests the map's ending text, so their game ends where the host's does", async () => {
    const { host, guest } = openRoom();
    const ana = guest();
    ana.room.join("Ana");
    await settle();
    await settle();
    const received = ana.events.onGame.mock.calls[0][0] as CoopGame;
    expect(received.intertext).toBe("The base is quiet now.");
    host.close();
  });

  it("sends a big map no faster than the room server passes it on", async () => {
    vi.useFakeTimers();
    const hub = createHub();
    const link = hub.transport();
    // The room server's limits: 2 MiB at once, then 256 KiB a second.
    const depth = 2 * 1024 * 1024;
    let tokens = depth;
    let last = Date.now();
    let dropped = 0;
    const big: CoopGame = {
      ...game,
      wad: new Uint8Array(2_500_000).map((_, index) => index % 251),
    };
    const host = hostRoom(
      {
        ...link,
        post: (message) => {
          const now = Date.now();
          tokens = Math.min(depth, tokens + ((now - last) / 1000) * 262_144);
          last = now;
          const size = encodeMessage(message).length;
          if (size > tokens) dropped += 1;
          else tokens -= size;
          link.post(message);
        },
      },
      { game: big, name: "Sadman", version: "v1", maxPlayers: 3 },
      hostEvents(),
    );
    const ana = guestEvents();
    joinRoom(hub.transport(), "v1", ana).join("Ana");
    const jules = guestEvents();
    joinRoom(hub.transport(), "v1", jules).join("Jules");
    await vi.advanceTimersByTimeAsync(2000);
    expect(ana.onGame).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dropped).toBe(0);
    expect(ana.onGame).toHaveBeenCalledTimes(1);
    expect(jules.onGame).toHaveBeenCalledTimes(1);
    const received = ana.onGame.mock.calls[0][0] as CoopGame;
    expect(received.wad.length).toBe(big.wad.length);
    expect(received.wad.every((byte, index) => byte === index % 251)).toBe(
      true,
    );
    host.close();
  });

  it("stops sending the map to a guest who leaves", async () => {
    vi.useFakeTimers();
    const hub = createHub();
    const link = hub.transport();
    const chunks: number[] = [];
    const host = hostRoom(
      {
        ...link,
        post: (message) => {
          if (message.type === "chunk") chunks.push(message.to);
          link.post(message);
        },
      },
      {
        game: { ...game, wad: new Uint8Array(2_500_000) },
        name: "Sadman",
        version: "v1",
        maxPlayers: 3,
      },
      hostEvents(),
    );
    const ana = joinRoom(hub.transport(), "v1", guestEvents());
    ana.join("Ana");
    await vi.advanceTimersByTimeAsync(1000);
    const sent = chunks.length;
    expect(sent).toBeGreaterThan(0);
    ana.leave();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(chunks.length).toBe(sent);
    host.close();
  });

  it("refuses a full room, a started game and another version", async () => {
    const { host, guest } = openRoom(2);
    guest().room.join("Ana");
    await settle();
    const late = guest();
    late.room.join("Late");
    await settle();
    expect(late.events.onRefused).toHaveBeenCalledWith("full");
    const older = guest("v0");
    older.room.join("Old");
    await settle();
    expect(older.events.onRefused).toHaveBeenCalledWith("version");
    host.start();
    const after = guest();
    after.room.join("After");
    await settle();
    expect(after.events.onRefused).toHaveBeenCalledWith("started");
    host.close();
  });

  it("frees a slot when a guest leaves or is removed", async () => {
    const { host, events, guest } = openRoom(2);
    const ana = guest();
    ana.room.join("Ana");
    await settle();
    ana.room.leave();
    await settle();
    expect(events.onLeft).toHaveBeenCalledWith(2);
    const jules = guest();
    jules.room.join("jules");
    await settle();
    expect(jules.events.onJoined).toHaveBeenCalledWith(2);
    host.kick(2);
    await settle();
    expect(jules.events.onClosed).toHaveBeenCalledWith("removed");
    expect(host.players()).toHaveLength(1);
    host.close();
  });

  it("measures each guest's ping, also once the game starts", async () => {
    vi.useFakeTimers();
    const { host, guest } = openRoom();
    guest().room.join("Ana");
    await vi.advanceTimersByTimeAsync(100);
    host.start();
    await vi.advanceTimersByTimeAsync(2100);
    expect(host.players()[1].ping).toEqual(expect.any(Number));
    host.close();
  });

  it("starts guests, routes packets and stalls, and tells them when the host leaves", async () => {
    const { host, events, guest } = openRoom();
    const ana = guest();
    ana.room.join("Ana");
    await settle();
    host.start();
    host.send(2, new Uint8Array([9]));
    ana.room.send(1, new Uint8Array([7]));
    ana.room.signal(1, { relayOnly: true });
    host.stall([2]);
    await settle();
    expect(ana.events.onStart).toHaveBeenCalled();
    expect(ana.events.onPacket).toHaveBeenCalledWith(1, new Uint8Array([9]));
    expect(events.onPacket).toHaveBeenCalledWith(2, new Uint8Array([7]));
    expect(events.onSignal).toHaveBeenCalledWith(2, { relayOnly: true });
    expect(ana.events.onStall).toHaveBeenCalledWith([2]);
    host.close();
    await settle();
    expect(ana.events.onClosed).toHaveBeenCalledWith("host-left");
  });

  it("tells a guest when its connection to the room drops", () => {
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
      "v1",
      events,
    );
    deliver({ type: "dropped" });
    expect(events.onClosed).toHaveBeenCalledWith("lost");
  });
});

function openRoom(maxPlayers = 3, version = "v1") {
  const hub = createHub();
  const events = hostEvents();
  const host = hostRoom(
    hub.transport(),
    { game, name: "Sadman", version, maxPlayers },
    events,
  );
  const guest = (version = "v1") => {
    const guestEvents_ = guestEvents();
    const room = joinRoom(hub.transport(), version, guestEvents_);
    return { room, events: guestEvents_ };
  };
  return { host, events, guest };
}

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

function hostEvents() {
  return {
    onRoster: vi.fn(),
    onLeft: vi.fn(),
    onPacket: vi.fn(),
    onSignal: vi.fn(),
    onDropped: vi.fn(),
  };
}

function guestEvents() {
  return {
    onInfo: vi.fn(),
    onJoined: vi.fn(),
    onRefused: vi.fn(),
    onRoster: vi.fn(),
    onProgress: vi.fn(),
    onGame: vi.fn(),
    onStart: vi.fn(),
    onStall: vi.fn(),
    onPacket: vi.fn(),
    onSignal: vi.fn(),
    onClosed: vi.fn(),
  };
}

describe("room codes and map packing", () => {
  it("makes short codes that survive being typed back", () => {
    const code = newRoomCode();
    expect(code).toMatch(/^[2-9A-HJKMNP-TV-Z]{6}$/);
    expect(parseRoomCode(formatRoomCode(code).toLowerCase())).toBe(code);
    expect(parseRoomCode("7KQ-4P")).toBeNull();
    expect(parseRoomCode("7KQ-4PO")).toBeNull();
  });

  it("packs a game and unpacks the same game", () => {
    expect(unpackGame(packGame(game))).toEqual(game);
  });
});
