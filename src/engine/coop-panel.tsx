import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { Check, Copy, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { GameMap } from "../map/types";
import { compileMap } from "../wad/compile";
import { peerLinks, type LinkState, type PeerLinks } from "./peer-link";
import { GameView, type CoopSession } from "./play-panel";
import {
  hostPeer,
  hostRoom,
  joinRoom,
  newRoomId,
  tabTransport,
  type CoopGame,
  type GuestRoom,
  type HostRoom,
} from "./room";
import { socketTransport } from "./room-socket";

const dialogClass =
  "fixed top-1/2 left-1/2 z-50 flex w-[440px] max-w-[calc(100vw-32px)] -translate-1/2 flex-col rounded-[4px] border border-border-strong bg-surface outline-none";
const titleClass =
  "block font-sans text-xl font-bold tracking-normal text-fg normal-case";
const maxPlayers = 4;
// Woof's DISCONNECT packet. Handing it to the host's engine for a player who
// left drops them at once, instead of after the engine's 30-second timeout.
const disconnectPacket = new Uint8Array([0, 8]);
// Without a room server, as in local development, rooms reach other tabs only.
const roomsUrl = process.env.NEXT_PUBLIC_ROOMS_URL;

function openTransport(roomId: string) {
  return roomsUrl
    ? socketTransport(`${roomsUrl}/rooms/${roomId}`)
    : tabTransport(roomId);
}

const guestLinkLabels: Record<LinkState, string> = {
  connecting: "Connecting to the host…",
  direct: "Connected directly to the host",
  relayed: "Connected through the game server",
};

const linkLabels: Record<LinkState, string> = {
  connecting: "Connecting…",
  direct: "Direct",
  relayed: "Relayed",
};

// Player N appears at the Player N start, so the starts set how many can play.
function coopPlayers(map: GameMap) {
  let players = 1;
  while (
    players < maxPlayers &&
    map.things.some((thing) => thing.kind === `player-${players + 1}`)
  ) {
    players += 1;
  }
  return players;
}

// Packets can arrive before the game is listening, so they wait here.
function packetRelay() {
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

function playerName(peer: number, self: number) {
  return `Player ${peer}${peer === self ? " (you)" : ""}`;
}

function PlayerList({
  peers,
  self,
  links = {},
}: {
  peers: number[];
  self: number;
  links?: Record<number, LinkState>;
}) {
  return (
    <ul className="m-0 grid list-none gap-1 p-0" aria-label="Players">
      {peers.map((peer) => (
        <li
          key={peer}
          className="flex items-center justify-between rounded-[3px] border border-border px-3 py-2 text-sm"
        >
          {playerName(peer, self)}
          <span className="font-mono text-[11px] text-fg-muted">
            {peer === hostPeer
              ? "Host"
              : links[peer]
                ? linkLabels[links[peer]]
                : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

type HostedGame = { session: CoopSession; close: () => void };

function CoopLobby({
  map,
  title,
  slot,
  par,
  onStart,
  onClose,
}: {
  map: GameMap;
  title: string;
  slot: string;
  par: number | null;
  onStart: (game: HostedGame) => void;
  onClose: () => void;
}) {
  const [roomId] = useState(newRoomId);
  const [peers, setPeers] = useState([hostPeer]);
  const [copied, setCopied] = useState(false);
  const [links, setLinks] = useState<Record<number, LinkState>>({});
  const [lost, setLost] = useState(false);
  const roomRef = useRef<HostRoom | null>(null);
  const linksRef = useRef<PeerLinks | null>(null);
  const relayRef = useRef(packetRelay());
  const handedOff = useRef(false);
  const link = `${location.origin}/?join=${roomId}`;

  useEffect(() => {
    const direct = peerLinks({
      signal: (to, signal) => room.signal(to, signal),
      onPacket: relayRef.current.deliver,
      onState: (peer, state) =>
        setLinks((current) => ({ ...current, [peer]: state })),
    });
    const room = hostRoom(
      openTransport(roomId),
      { title, maxPlayers: coopPlayers(map) },
      {
        onRoster: setPeers,
        onLeft: (peer) => {
          direct.close(peer);
          relayRef.current.deliver(peer, disconnectPacket);
        },
        onPacket: relayRef.current.deliver,
        onSignal: (from, signal) => void direct.handle(from, signal),
        onDropped: () => {
          if (!handedOff.current) setLost(true);
        },
      },
    );
    roomRef.current = room;
    linksRef.current = direct;
    return () => {
      if (handedOff.current) return;
      direct.closeAll();
      room.close();
    };
  }, [roomId, title, map]);

  const copy = () => {
    void navigator.clipboard?.writeText(link).then(() => setCopied(true));
  };

  const start = () => {
    const room = roomRef.current;
    const direct = linksRef.current;
    if (!room || !direct) return;
    const wad = compileMap(map);
    const game: CoopGame = { map, wad, title, slot, par };
    handedOff.current = true;
    let announced = false;
    onStart({
      session: {
        role: "host",
        wad,
        send: (to, data) => {
          if (!direct.send(to, data)) room.send(to, data);
        },
        listen: relayRef.current.listen,
        players: () => room.peers().length,
        // Guests connect to the host's engine, so they start once it runs.
        onServerReady: () => {
          if (announced) return;
          announced = true;
          room.start(game);
        },
      },
      close: () => {
        direct.closeAll();
        room.close();
      },
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop className="fixed inset-0 z-40 bg-scrim" />
      <DialogContent className={dialogClass}>
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
          <DialogTitle className={titleClass}>Play co-op</DialogTitle>
          <DialogClose
            aria-label="Close"
            className="border-0 bg-transparent p-1 text-fg-muted hover:text-fg"
          >
            <X size={16} aria-hidden="true" />
          </DialogClose>
        </header>
        <div className="grid gap-4 p-5">
          <DialogDescription className="m-0 text-sm text-fg-muted">
            {roomsUrl
              ? "Send this link to the other players."
              : "Open this link in another tab of this browser to join."}{" "}
            Up to {coopPlayers(map)} players can play, one for each player
            start.
          </DialogDescription>
          <div className="flex gap-2">
            <input
              className="text-input min-w-0 flex-1 font-mono text-xs"
              aria-label="Invite link"
              readOnly
              value={link}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button type="button" className="button" onClick={copy}>
              {copied ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Copy size={14} aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <PlayerList peers={peers} self={hostPeer} links={links} />
          {lost ? (
            <p className="notice m-0" role="alert">
              Lost the connection to the game server. Close this and try again.
            </p>
          ) : null}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <span className="text-xs text-fg-muted" role="status">
            {peers.length < 2
              ? "Waiting for someone to join…"
              : `${peers.length} players ready`}
          </span>
          <button
            type="button"
            className="button primary"
            disabled={peers.length < 2 || lost}
            onClick={start}
          >
            Start
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

type JoinState =
  | { step: "joining"; slow: boolean }
  | {
      step: "waiting";
      peer: number;
      title: string;
      peers: number[];
      link: LinkState | null;
    }
  | { step: "playing"; peer: number; game: CoopGame }
  | { step: "ended"; message: string };

const slowJoinMs = 4000;

function CoopJoin({ roomId }: { roomId: string }) {
  const [state, setState] = useState<JoinState>({
    step: "joining",
    slow: false,
  });
  const roomRef = useRef<GuestRoom | null>(null);
  const linksRef = useRef<PeerLinks | null>(null);
  const relayRef = useRef(packetRelay());
  const [session, setSession] = useState<CoopSession | null>(null);

  useEffect(() => {
    let peer = 0;
    const slow = setTimeout(
      () =>
        setState((current) =>
          current.step === "joining"
            ? { step: "joining", slow: true }
            : current,
        ),
      slowJoinMs,
    );
    const direct = peerLinks({
      signal: (to, signal) => room.signal(to, signal),
      onPacket: relayRef.current.deliver,
      onState: (_peer, link) =>
        setState((current) =>
          current.step === "waiting" ? { ...current, link } : current,
        ),
    });
    const room = joinRoom(openTransport(roomId), {
      onJoined: (joined, title) => {
        peer = joined;
        setState({
          step: "waiting",
          peer: joined,
          title,
          peers: [],
          link: null,
        });
        void direct.connect(hostPeer);
      },
      onRefused: (reason) => setState({ step: "ended", message: reason }),
      onRoster: (peers) =>
        setState((current) =>
          current.step === "waiting" ? { ...current, peers } : current,
        ),
      onStart: (game) => setState({ step: "playing", peer, game }),
      onPacket: relayRef.current.deliver,
      onSignal: (from, signal) => void direct.handle(from, signal),
      onClosed: (message) => {
        direct.closeAll();
        setState({ step: "ended", message });
      },
    });
    roomRef.current = room;
    linksRef.current = direct;
    setSession({
      role: "guest",
      wad: new Uint8Array(0),
      send: (to, data) => {
        if (!direct.send(to, data)) room.send(to, data);
      },
      listen: relayRef.current.listen,
      players: () => 0,
      onServerReady: () => {},
    });
    const leave = () => {
      direct.closeAll();
      room.leave();
    };
    window.addEventListener("pagehide", leave);
    return () => {
      clearTimeout(slow);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [roomId]);

  const game = state.step === "playing" ? state.game : null;
  // A new session object would restart the game, so it only changes with it.
  const playing = useMemo(
    () => (session && game ? { ...session, wad: game.wad } : null),
    [session, game],
  );

  if (state.step === "playing" && playing) {
    return (
      <GameView
        map={state.game.map}
        title={state.game.title}
        slot={state.game.slot}
        par={state.game.par}
        coop={playing}
        onExit={() => {
          roomRef.current?.leave();
          linksRef.current?.closeAll();
          setState({ step: "ended", message: "You left the game." });
        }}
      />
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-4 text-fg">
      <section className="grid w-[min(400px,100%)] gap-4 rounded-[4px] border border-border-strong bg-surface p-5">
        <h1 className="m-0 text-xl font-bold">
          {state.step === "waiting" ? state.title : "Co-op"}
        </h1>
        {state.step === "joining" ? (
          <p className="m-0 text-sm text-fg-muted" role="status">
            {!state.slow
              ? "Joining the game…"
              : roomsUrl
                ? "Still looking for the host. The host has to keep the co-op lobby open."
                : "Still looking for the host. The host's tab has to stay open in this browser."}
          </p>
        ) : null}
        {state.step === "waiting" ? (
          <>
            <p className="m-0 text-sm text-fg-muted" role="status">
              You're Player {state.peer}. Waiting for the host to start.
            </p>
            <PlayerList peers={state.peers} self={state.peer} />
            {state.link ? (
              <p className="m-0 font-mono text-[11px] text-fg-muted">
                {guestLinkLabels[state.link]}
              </p>
            ) : null}
          </>
        ) : null}
        {state.step === "ended" ? (
          <p className="m-0 text-sm text-fg-muted" role="status">
            {state.message}
          </p>
        ) : null}
        <button
          type="button"
          className="button justify-self-start"
          onClick={() => location.assign("/")}
        >
          Open the editor
        </button>
      </section>
    </main>
  );
}

export { CoopJoin, CoopLobby, coopPlayers, type HostedGame };
