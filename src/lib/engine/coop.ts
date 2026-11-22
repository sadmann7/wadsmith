import { createLocalStorage } from "@ui-sdk/core";

import { deathmatchStarts } from "@/lib/map/catalog";
import type { GameMap } from "@/lib/map/types";
import type { LinkState } from "./peer-link";
import { formatRoomCode, tabTransport } from "./room";
import { socketTransport } from "./room-socket";
import { fragLimit, type NetworkMode, type Skill } from "./runtime";

export const maxPlayers = 4;
// Woof's DISCONNECT packet. Handing it to the host's engine for a player who
// left drops them at once, instead of after the engine's 30-second timeout.
export const disconnectPacket = new Uint8Array([0, 8]);
// Without a room server, as in local development, rooms reach other tabs only.
export const roomsUrl = process.env.NEXT_PUBLIC_ROOMS_URL;
// Players must run the same build, since the map compiler and engine change
// between versions.
export const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
const savedName = createLocalStorage("wadsmith:name");
export const maxNameLength = 24;

export function openTransport(code: string) {
  return roomsUrl
    ? socketTransport(`${roomsUrl}/rooms/${code.toLowerCase()}`)
    : tabTransport(code);
}

export function inviteLink(code: string) {
  return `${location.origin}/join/${formatRoomCode(code)}`;
}

export function loadName() {
  return savedName.get() ?? "";
}

export function saveName(name: string) {
  savedName.set(name);
}

export const modeNames: Record<NetworkMode, string> = {
  coop: "Co-op",
  deathmatch: "Deathmatch",
};

export const modeHelp: Record<NetworkMode, string> = {
  coop: "Work through the map together. Enemies, keys and doors are shared.",
  deathmatch: `Every player for themselves. Items come back, and the first to ${fragLimit} frags wins.`,
};

export const skillNames: Record<Skill, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export const linkLabels: Record<LinkState, string> = {
  connecting: "Connecting",
  direct: "Direct",
  relayed: "Relayed",
};

// Player N appears at the Player N start, so the starts set how many can play.
export function coopPlayers(map: GameMap) {
  let players = 1;
  while (
    players < maxPlayers &&
    map.things.some((thing) => thing.kind === `player-${players + 1}`)
  ) {
    players += 1;
  }
  return players;
}

export function deathmatchSpots(map: GameMap) {
  return map.things.filter((thing) => thing.kind === "deathmatch-start").length;
}

// How many can join in each mode the map supports, best first.
export function playModes(map: GameMap) {
  const modes: { mode: NetworkMode; players: number }[] = [];
  if (coopPlayers(map) > 1) {
    modes.push({ mode: "coop", players: coopPlayers(map) });
  }
  if (deathmatchSpots(map) >= deathmatchStarts) {
    modes.push({ mode: "deathmatch", players: maxPlayers });
  }
  return modes;
}

// Packets can arrive before the game is listening, so they wait here.
export function packetRelay() {
  let receive: ((from: number, data: Uint8Array) => void) | null = null;
  const waiting: [number, Uint8Array][] = [];
  return {
    deliver: (from: number, data: Uint8Array) => {
      if (receive) receive(from, data);
      else waiting.push([from, data]);
    },
    listen: (next: (from: number, data: Uint8Array) => void) => {
      receive = next;
      for (const [from, data] of waiting.splice(0)) next(from, data);
    },
  };
}

// The game view may start listening after the host reported a stall.
export function stallRelay() {
  let receive: ((peers: number[]) => void) | null = null;
  let latest: number[] = [];
  return {
    deliver: (peers: number[]) => {
      latest = peers;
      receive?.(peers);
    },
    listen: (next: (peers: number[]) => void) => {
      receive = next;
      next(latest);
    },
  };
}
