import type { GameMap } from "@/lib/map/types";

import { defined } from "@/lib/defined";

import type { GameId } from "./game";
import type { NetworkMode, Skill } from "./runtime";

// The host numbers the players in a room, and the engine addresses them by
// these numbers. The host is always 1, which is also its engine's server.
export const hostPeer = 1;
const repeatEveryMs = 1000;
const pingEveryMs = 2000;
const chunkBytes = 16 * 1024;
// The room server passes on 2 MiB from a connection at once and 256 KiB a
// second after that, and drops the rest. The map goes out at half the burst
// and three quarters of the rate, so the rest of the room's traffic still fits.
const burstBytes = 1024 * 1024;
const bytesPerSecond = 192 * 1024;
const paceEveryMs = 100;

export interface CoopGame {
  map: GameMap;
  mode: NetworkMode;
  skill: Skill;
  wad: Uint8Array;
  title: string;
  slot: string;
  par: number | null;
  // Each page decides from this text whether its game ends at the tally or
  // after the text, so guests need it as well as the host.
  intertext?: string;
  // Every player's engine needs the same IWAD under the map.
  game?: GameId;
}

export interface RoomPlayer {
  peer: number;
  name: string;
  ready: boolean;
  progress: number;
  ping: number | null;
}

export interface RoomInfo {
  title: string;
  host: string;
  mode: NetworkMode;
  skill: Skill;
  map: GameMap;
  players: RoomPlayer[];
  maxPlayers: number;
  started: boolean;
}

export type Refusal = "full" | "started" | "version";
export type Ending = "host-left" | "lost" | "removed";

// WebRTC's offer, answer and network candidates, passed through the room.
export interface PeerSignal {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  relayOnly?: true;
}

export type RoomMessage =
  | { type: "peek"; nonce: string }
  | { type: "info"; nonce: string; info: RoomInfo }
  | { type: "hello"; nonce: string; name: string; version: string }
  | { type: "welcome"; nonce: string; peer: number }
  | { type: "refused"; nonce: string; reason: Refusal }
  | { type: "roster"; players: RoomPlayer[] }
  | {
      type: "chunk";
      to: number;
      index: number;
      count: number;
      data: Uint8Array;
    }
  | { type: "progress"; peer: number; progress: number }
  | { type: "ready"; peer: number }
  | { type: "ping"; to: number; sent: number }
  | { type: "pong"; peer: number; sent: number }
  | { type: "kick"; peer: number }
  | { type: "start" }
  | { type: "stall"; peers: number[] }
  | { type: "packet"; from: number; to: number; data: Uint8Array }
  | { type: "signal"; from: number; to: number; signal: PeerSignal }
  | { type: "leave"; peer: number }
  | { type: "close" }
  | { type: "dropped" };

// A transport delivers "dropped" itself when it loses its connection.
export interface RoomTransport {
  post: (message: RoomMessage) => void;
  listen: (handler: (message: RoomMessage) => void) => void;
  identify: (peer: number) => void;
  close: () => void;
}

// Reaches other tabs of this browser, when no room server is set.
export function tabTransport(code: string): RoomTransport {
  const channel = new BroadcastChannel(`wadsmith-coop-${code}`);
  return {
    post: (message) => channel.postMessage(message),
    listen: (handler) => {
      channel.addEventListener("message", (event: MessageEvent<RoomMessage>) =>
        handler(event.data),
      );
    },
    identify: () => {},
    close: () => channel.close(),
  };
}

// Six letters and digits that can't be mistaken for each other when read out.
const codeAlphabet = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newRoomCode() {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (byte) => codeAlphabet[byte % codeAlphabet.length],
  ).join("");
}

export function formatRoomCode(code: string) {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

export function parseRoomCode(text: string) {
  const code = text.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return code.length === 6 &&
    code.split("").every((char) => codeAlphabet.includes(char))
    ? code
    : null;
}

// The map travels as [JSON length][JSON][WAD], split into chunks so a guest can
// show its progress and no single message gets too big.
export function packGame({ wad, ...rest }: CoopGame) {
  const json = new TextEncoder().encode(JSON.stringify(rest));
  const packed = new Uint8Array(4 + json.length + wad.length);
  new DataView(packed.buffer).setUint32(0, json.length);
  packed.set(json, 4);
  packed.set(wad, 4 + json.length);
  return packed;
}

export function unpackGame(packed: Uint8Array): CoopGame {
  const length = new DataView(packed.buffer, packed.byteOffset).getUint32(0);
  const rest = JSON.parse(
    new TextDecoder().decode(packed.subarray(4, 4 + length)),
  ) as Omit<CoopGame, "wad">;
  return { ...rest, wad: packed.slice(4 + length) };
}

interface HostSettings {
  game: CoopGame;
  name: string;
  version: string;
  maxPlayers: number;
}

interface HostRoomEvents {
  onRoster: (players: RoomPlayer[]) => void;
  onLeft: (peer: number) => void;
  onPacket: (from: number, data: Uint8Array) => void;
  onSignal: (from: number, signal: PeerSignal) => void;
  onDropped: () => void;
}

export function hostRoom(
  transport: RoomTransport,
  { game, name, version, maxPlayers }: HostSettings,
  events: HostRoomEvents,
) {
  let players: RoomPlayer[] = [
    { peer: hostPeer, name, ready: true, progress: 1, ping: null },
  ];
  const byNonce = new Map<string, number>();
  const packed = packGame(game);
  const count = Math.max(1, Math.ceil(packed.length / chunkBytes));
  let started = false;
  let closed = false;
  const waiting: { to: number; index: number }[] = [];
  let allowance = burstBytes;
  let paidAt = Date.now();
  let pacing: ReturnType<typeof setTimeout> | null = null;

  const sendRoster = () => {
    transport.post({ type: "roster", players });
    events.onRoster(players);
  };

  const update = (peer: number, change: Partial<RoomPlayer>) => {
    players = players.map((player) =>
      player.peer === peer ? { ...player, ...change } : player,
    );
    sendRoster();
  };

  const remove = (peer: number) => {
    if (!players.some((player) => player.peer === peer) || peer === hostPeer) {
      return;
    }
    players = players.filter((player) => player.peer !== peer);
    for (let at = waiting.length - 1; at >= 0; at -= 1) {
      if (waiting[at].to === peer) waiting.splice(at, 1);
    }
    for (const [nonce, known] of byNonce) {
      if (known === peer) byNonce.delete(nonce);
    }
    sendRoster();
    events.onLeft(peer);
  };

  const info = (): RoomInfo => ({
    title: game.title,
    host: name,
    mode: game.mode,
    skill: game.skill,
    map: game.map,
    players,
    maxPlayers,
    started,
  });

  const sendChunks = () => {
    pacing = null;
    const now = Date.now();
    allowance = Math.min(
      burstBytes,
      allowance + ((now - paidAt) / 1000) * bytesPerSecond,
    );
    paidAt = now;
    while (waiting.length > 0) {
      const { to, index } = waiting[0];
      const data = packed.slice(index * chunkBytes, (index + 1) * chunkBytes);
      const cost = wireBytes(data.length);
      if (cost > allowance) break;
      allowance -= cost;
      waiting.shift();
      transport.post({ type: "chunk", to, index, count, data });
    }
    if (waiting.length > 0) pacing = setTimeout(sendChunks, paceEveryMs);
  };

  const sendMap = (to: number) => {
    for (let index = 0; index < count; index += 1) waiting.push({ to, index });
    if (!pacing) sendChunks();
  };

  const pings = setInterval(() => {
    for (const player of players) {
      if (player.peer === hostPeer) continue;
      transport.post({ type: "ping", to: player.peer, sent: Date.now() });
    }
  }, pingEveryMs);

  transport.identify(hostPeer);

  transport.listen((message) => {
    if (closed) return;
    if (message.type === "peek") {
      transport.post({ type: "info", nonce: message.nonce, info: info() });
    } else if (message.type === "hello") {
      const known = byNonce.get(message.nonce);
      if (known !== undefined) {
        transport.post({ type: "welcome", nonce: message.nonce, peer: known });
        return;
      }
      const free = Array.from(
        { length: maxPlayers },
        (_, index) => index + 1,
      ).find((peer) => !players.some((player) => player.peer === peer));
      const reason: Refusal | null =
        message.version !== version
          ? "version"
          : started
            ? "started"
            : free === undefined
              ? "full"
              : null;
      if (reason || free === undefined) {
        transport.post({
          type: "refused",
          nonce: message.nonce,
          reason: reason ?? "full",
        });
        return;
      }
      byNonce.set(message.nonce, free);
      players = [
        ...players,
        {
          peer: free,
          name: message.name.trim().slice(0, 24) || `Player ${free}`,
          ready: false,
          progress: 0,
          ping: null,
        },
      ].toSorted((a, b) => a.peer - b.peer);
      transport.post({ type: "welcome", nonce: message.nonce, peer: free });
      sendRoster();
      sendMap(free);
    } else if (message.type === "progress") {
      update(message.peer, { progress: message.progress });
    } else if (message.type === "ready") {
      update(message.peer, { ready: true, progress: 1 });
    } else if (message.type === "pong") {
      update(message.peer, { ping: Math.max(0, Date.now() - message.sent) });
    } else if (message.type === "leave") {
      remove(message.peer);
    } else if (message.type === "packet" && message.to === hostPeer) {
      events.onPacket(message.from, message.data);
    } else if (message.type === "signal" && message.to === hostPeer) {
      events.onSignal(message.from, message.signal);
    } else if (message.type === "dropped") {
      events.onDropped();
    }
  });

  return {
    players: () => players,
    signal: (to: number, signal: PeerSignal) =>
      transport.post({ type: "signal", from: hostPeer, to, signal }),
    kick: (peer: number) => {
      transport.post({ type: "kick", peer });
      remove(peer);
    },
    start: () => {
      started = true;
      transport.post({ type: "start" });
    },
    stall: (peers: number[]) => transport.post({ type: "stall", peers }),
    send: (to: number, data: Uint8Array) =>
      transport.post({ type: "packet", from: hostPeer, to, data }),
    close: () => {
      if (closed) return;
      closed = true;
      clearInterval(pings);
      if (pacing) clearTimeout(pacing);
      transport.post({ type: "close" });
      transport.close();
    },
  };
}

interface GuestRoomEvents {
  onInfo: (info: RoomInfo) => void;
  onJoined: (peer: number) => void;
  onRefused: (reason: Refusal) => void;
  onRoster: (players: RoomPlayer[]) => void;
  onProgress: (progress: number) => void;
  onGame: (game: CoopGame) => void;
  onStart: () => void;
  onStall: (peers: number[]) => void;
  onPacket: (from: number, data: Uint8Array) => void;
  onSignal: (from: number, signal: PeerSignal) => void;
  onClosed: (ending: Ending) => void;
}

// A guest first asks the room what it holds, then joins under a name. Both
// repeat until answered, since the host's page may still be opening.
export function joinRoom(
  transport: RoomTransport,
  version: string,
  events: GuestRoomEvents,
) {
  const nonce = crypto.randomUUID();
  let peer: number | null = null;
  let name: string | null = null;
  let closed = false;
  let gotInfo = false;
  const chunks = new Map<number, Uint8Array>();
  let reported = 0;

  const ask = () => {
    if (name !== null) transport.post({ type: "hello", nonce, name, version });
    else if (!gotInfo) transport.post({ type: "peek", nonce });
  };
  const timer = setInterval(ask, repeatEveryMs);
  ask();

  const receive = (index: number, count: number, data: Uint8Array) => {
    if (peer === null) return;
    chunks.set(index, data);
    const progress = chunks.size / count;
    events.onProgress(progress);
    if (chunks.size < count) {
      if (progress - reported >= 0.1) {
        reported = progress;
        transport.post({ type: "progress", peer, progress });
      }
      return;
    }
    const packed = new Uint8Array(
      [...chunks.values()].reduce((total, chunk) => total + chunk.length, 0),
    );
    let offset = 0;
    for (let at = 0; at < count; at += 1) {
      const chunk = defined(chunks.get(at));
      packed.set(chunk, offset);
      offset += chunk.length;
    }
    events.onGame(unpackGame(packed));
    transport.post({ type: "ready", peer });
  };

  transport.listen((message) => {
    if (closed) return;
    if (message.type === "info" && message.nonce === nonce) {
      gotInfo = true;
      events.onInfo(message.info);
    } else if (message.type === "welcome" && message.nonce === nonce) {
      clearInterval(timer);
      if (peer === null) {
        peer = message.peer;
        transport.identify(message.peer);
        events.onJoined(message.peer);
      }
    } else if (message.type === "refused" && message.nonce === nonce) {
      clearInterval(timer);
      events.onRefused(message.reason);
      leave();
    } else if (message.type === "dropped") {
      leave();
      events.onClosed("lost");
    } else if (message.type === "roster") {
      events.onRoster(message.players);
    } else if (peer === null) {
      return;
    } else if (message.type === "chunk" && message.to === peer) {
      receive(message.index, message.count, message.data);
    } else if (message.type === "ping" && message.to === peer) {
      transport.post({ type: "pong", peer, sent: message.sent });
    } else if (message.type === "kick" && message.peer === peer) {
      leave();
      events.onClosed("removed");
    } else if (message.type === "start") {
      events.onStart();
    } else if (message.type === "stall") {
      events.onStall(message.peers);
    } else if (message.type === "packet" && message.to === peer) {
      events.onPacket(message.from, message.data);
    } else if (message.type === "signal" && message.to === peer) {
      events.onSignal(message.from, message.signal);
    } else if (message.type === "close") {
      leave();
      events.onClosed("host-left");
    }
  });

  const leave = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    if (peer !== null) transport.post({ type: "leave", peer });
    transport.close();
  };

  return {
    join: (chosen: string) => {
      name = chosen;
      ask();
    },
    send: (to: number, data: Uint8Array) => {
      if (peer !== null) {
        transport.post({ type: "packet", from: peer, to, data });
      }
    },
    signal: (to: number, signal: PeerSignal) => {
      if (peer !== null) {
        transport.post({ type: "signal", from: peer, to, signal });
      }
    },
    leave,
  };
}

export type HostRoom = ReturnType<typeof hostRoom>;
export type GuestRoom = ReturnType<typeof joinRoom>;

// A chunk travels as base64 inside a short JSON message.
function wireBytes(length: number) {
  return Math.ceil(length / 3) * 4 + 128;
}

export type { Skill };
