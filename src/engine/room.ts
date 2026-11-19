import type { GameMap } from "../map/types";
import type { NetworkMode } from "./runtime";

// The host numbers the players in a room, and the engine addresses them by
// these numbers. The host is always 1, which is also its engine's server.
const hostPeer = 1;
const helloEveryMs = 1000;

type CoopGame = {
  map: GameMap;
  mode: NetworkMode;
  wad: Uint8Array;
  title: string;
  slot: string;
  par: number | null;
};

// WebRTC's offer, answer and network candidates, passed through the room.
type PeerSignal = {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  relayOnly?: true;
};

type RoomMessage =
  | { type: "hello"; nonce: string }
  | { type: "welcome"; nonce: string; peer: number; title: string }
  | { type: "full"; nonce: string; reason: string }
  | { type: "roster"; peers: number[] }
  | { type: "start"; game: CoopGame }
  | { type: "packet"; from: number; to: number; data: Uint8Array }
  | { type: "signal"; from: number; to: number; signal: PeerSignal }
  | { type: "leave"; peer: number }
  | { type: "close" }
  | { type: "dropped" };

// A transport delivers "dropped" itself when it loses its connection.
type RoomTransport = {
  post: (message: RoomMessage) => void;
  listen: (handler: (message: RoomMessage) => void) => void;
  identify: (peer: number) => void;
  close: () => void;
};

// Reaches other tabs of this browser, until rooms move online.
function tabTransport(roomId: string): RoomTransport {
  const channel = new BroadcastChannel(`wadsmith-coop-${roomId}`);
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

function newRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 10);
}

type HostRoomEvents = {
  onRoster: (peers: number[]) => void;
  onLeft: (peer: number) => void;
  onPacket: (from: number, data: Uint8Array) => void;
  onSignal: (from: number, signal: PeerSignal) => void;
  onDropped: () => void;
};

function hostRoom(
  transport: RoomTransport,
  { title, maxPlayers }: { title: string; maxPlayers: number },
  events: HostRoomEvents,
) {
  let peers = [hostPeer];
  const byNonce = new Map<string, number>();
  let started = false;
  let closed = false;

  const sendRoster = () => {
    transport.post({ type: "roster", peers });
    events.onRoster(peers);
  };

  transport.identify(hostPeer);

  transport.listen((message) => {
    if (closed) return;
    if (message.type === "hello") {
      const known = byNonce.get(message.nonce);
      if (known !== undefined) {
        transport.post({
          type: "welcome",
          nonce: message.nonce,
          peer: known,
          title,
        });
        return;
      }
      const free = Array.from(
        { length: maxPlayers },
        (_, index) => index + 1,
      ).find((peer) => !peers.includes(peer));
      if (started || free === undefined) {
        transport.post({
          type: "full",
          nonce: message.nonce,
          reason: started
            ? "This game has already started."
            : "This game is full.",
        });
        return;
      }
      byNonce.set(message.nonce, free);
      peers = [...peers, free].toSorted((a, b) => a - b);
      transport.post({
        type: "welcome",
        nonce: message.nonce,
        peer: free,
        title,
      });
      sendRoster();
    } else if (message.type === "leave") {
      if (!peers.includes(message.peer) || message.peer === hostPeer) return;
      peers = peers.filter((peer) => peer !== message.peer);
      for (const [nonce, peer] of byNonce) {
        if (peer === message.peer) byNonce.delete(nonce);
      }
      sendRoster();
      events.onLeft(message.peer);
    } else if (message.type === "packet" && message.to === hostPeer) {
      events.onPacket(message.from, message.data);
    } else if (message.type === "signal" && message.to === hostPeer) {
      events.onSignal(message.from, message.signal);
    } else if (message.type === "dropped") {
      events.onDropped();
    }
  });

  return {
    peers: () => peers,
    signal: (to: number, signal: PeerSignal) =>
      transport.post({ type: "signal", from: hostPeer, to, signal }),
    start: (game: CoopGame) => {
      started = true;
      transport.post({ type: "start", game });
    },
    send: (to: number, data: Uint8Array) =>
      transport.post({ type: "packet", from: hostPeer, to, data }),
    close: () => {
      if (closed) return;
      closed = true;
      transport.post({ type: "close" });
      transport.close();
    },
  };
}

type GuestRoomEvents = {
  onJoined: (peer: number, title: string) => void;
  onRefused: (reason: string) => void;
  onRoster: (peers: number[]) => void;
  onStart: (game: CoopGame) => void;
  onPacket: (from: number, data: Uint8Array) => void;
  onSignal: (from: number, signal: PeerSignal) => void;
  onClosed: (reason: string) => void;
};

function joinRoom(transport: RoomTransport, events: GuestRoomEvents) {
  const nonce = crypto.randomUUID();
  let peer: number | null = null;
  let closed = false;

  // The host's tab may open after this one, so the hello repeats until answered.
  const hello = () => transport.post({ type: "hello", nonce });
  const timer = setInterval(hello, helloEveryMs);
  hello();

  transport.listen((message) => {
    if (closed) return;
    if (message.type === "welcome" && message.nonce === nonce) {
      clearInterval(timer);
      if (peer === null) {
        peer = message.peer;
        transport.identify(message.peer);
        events.onJoined(message.peer, message.title);
      }
    } else if (message.type === "dropped") {
      leave();
      events.onClosed("Lost the connection to the game.");
    } else if (message.type === "full" && message.nonce === nonce) {
      clearInterval(timer);
      events.onRefused(message.reason);
      leave();
    } else if (peer === null) {
      return;
    } else if (message.type === "roster") {
      events.onRoster(message.peers);
    } else if (message.type === "start") {
      events.onStart(message.game);
    } else if (message.type === "packet" && message.to === peer) {
      events.onPacket(message.from, message.data);
    } else if (message.type === "signal" && message.to === peer) {
      events.onSignal(message.from, message.signal);
    } else if (message.type === "close") {
      leave();
      events.onClosed("The host ended the game.");
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
    send: (to: number, data: Uint8Array) => {
      if (peer !== null)
        transport.post({ type: "packet", from: peer, to, data });
    },
    signal: (to: number, signal: PeerSignal) => {
      if (peer !== null) {
        transport.post({ type: "signal", from: peer, to, signal });
      }
    },
    leave,
  };
}

type HostRoom = ReturnType<typeof hostRoom>;
type GuestRoom = ReturnType<typeof joinRoom>;

export {
  hostPeer,
  hostRoom,
  joinRoom,
  newRoomId,
  tabTransport,
  type CoopGame,
  type GuestRoom,
  type HostRoom,
  type PeerSignal,
  type RoomMessage,
  type RoomTransport,
};
