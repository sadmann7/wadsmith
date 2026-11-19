import {
  Download,
  LogIn,
  LogOut,
  RefreshCw,
  Timer,
  Users,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { MapPlan } from "../editor/map-plan";
import {
  appVersion,
  loadName,
  maxNameLength,
  modeNames,
  openTransport,
  packetRelay,
  roomsUrl,
  saveName,
  skillNames,
} from "./coop";
import { PlayerBadge, Progress, StatusCard } from "./coop-ui";
import { peerLinks, type PeerLinks } from "./peer-link";
import { GameView, type CoopSession } from "./play-panel";
import {
  formatRoomCode,
  hostPeer,
  joinRoom,
  type CoopGame,
  type Ending,
  type GuestRoom,
  type Refusal,
  type RoomInfo,
  type RoomPlayer,
} from "./room";

const slowFindMs = 4000;

type JoinState =
  | { step: "finding"; slow: boolean }
  | { step: "invite" }
  | { step: "joining" }
  | { step: "getting"; peer: number; progress: number }
  | { step: "waiting"; peer: number; game: CoopGame }
  | { step: "playing"; peer: number; game: CoopGame }
  | { step: "ended"; reason: Refusal | Ending | "left" };

function backHome() {
  location.assign("/");
}

function Ended({
  reason,
  info,
}: {
  reason: Refusal | Ending | "left";
  info: RoomInfo | null;
}) {
  const host = info?.host ?? "The host";
  const back = (
    <button type="button" className="button" onClick={backHome}>
      Back to Wadsmith
    </button>
  );
  if (reason === "full") {
    return (
      <StatusCard
        icon={Users}
        tone="warning"
        title="This room is full"
        actions={back}
      >
        <p className="m-0">
          All {info?.maxPlayers ?? ""} spots are taken. Ask {host} to open a new
          room.
        </p>
      </StatusCard>
    );
  }
  if (reason === "started") {
    return (
      <StatusCard
        icon={Timer}
        tone="warning"
        title="This game has started"
        actions={back}
      >
        <p className="m-0">
          Players can&apos;t join once a game is running. Ask {host} to open a
          new room when it ends.
        </p>
      </StatusCard>
    );
  }
  if (reason === "version") {
    return (
      <StatusCard
        icon={RefreshCw}
        tone="warning"
        title="Update to join"
        actions={
          <button
            type="button"
            className="button primary"
            onClick={() => location.reload()}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Reload
          </button>
        }
      >
        <p className="m-0">
          {host} is on a different version of Wadsmith. Reload to get the same
          version, then join again.
        </p>
      </StatusCard>
    );
  }
  if (reason === "host-left") {
    return (
      <StatusCard
        icon={LogOut}
        tone="warning"
        title={`${host} left the game`}
        actions={back}
      >
        <p className="m-0">
          The host&apos;s computer runs the game, so it ended when they left.
        </p>
      </StatusCard>
    );
  }
  if (reason === "lost") {
    return (
      <StatusCard
        icon={WifiOff}
        tone="danger"
        title="Connection lost"
        actions={back}
      >
        <p className="m-0">
          A running game can&apos;t be rejoined. Ask {host} to open a new room.
        </p>
      </StatusCard>
    );
  }
  if (reason === "removed") {
    return (
      <StatusCard
        icon={LogOut}
        tone="warning"
        title="You were removed"
        actions={back}
      >
        <p className="m-0">{host} removed you from the room.</p>
      </StatusCard>
    );
  }
  return (
    <StatusCard
      icon={LogOut}
      tone="info"
      title="You left the game"
      actions={back}
    >
      <p className="m-0">
        Open the invite link again to rejoin while the room is open.
      </p>
    </StatusCard>
  );
}

function Invite({
  code,
  info,
  joining,
  onJoin,
}: {
  code: string;
  info: RoomInfo;
  joining: boolean;
  onJoin: (name: string) => void;
}) {
  const [name, setName] = useState(loadName);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) onJoin(name.trim());
  };
  return (
    <section
      aria-label={`Join ${info.title}`}
      className="overflow-hidden rounded-[4px] border border-border-strong bg-surface"
    >
      <div className="relative bg-canvas">
        <span
          aria-label="Room code"
          className="absolute top-3 left-3 rounded-[3px] border border-border-strong bg-surface px-2 py-0.5 font-mono text-xs tracking-widest"
        >
          {formatRoomCode(code)}
        </span>
        <MapPlan
          map={info.map}
          label={`Plan of ${info.title}`}
          className="aspect-[16/8] w-full p-6"
        />
      </div>
      <form className="grid gap-4 p-6" onSubmit={submit}>
        <div className="grid gap-1.5">
          <span className="font-mono text-[11px] tracking-widest text-fg-muted uppercase">
            {info.host} invited you to play
          </span>
          <h1 className="m-0 text-3xl font-bold">{info.title}</h1>
          <span className="text-sm text-fg-muted">
            {modeNames[info.mode]} · {skillNames[info.skill]} ·{" "}
            {info.players.length} of {info.maxPlayers} players in the room
          </span>
        </div>
        <ul
          aria-label="Players"
          className="m-0 flex list-none flex-wrap gap-2 p-0"
        >
          {info.players.map((player) => (
            <li
              key={player.peer}
              className="flex items-center gap-2 rounded-full bg-surface-raised py-0.5 pr-3 pl-0.5 text-sm"
            >
              <PlayerBadge peer={player.peer} />
              {player.name}
            </li>
          ))}
        </ul>
        <label className="field">
          <span className="label">Your name</span>
          <input
            className="text-input"
            maxLength={maxNameLength}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="button primary justify-center"
          disabled={!name.trim() || joining}
        >
          <LogIn size={14} aria-hidden="true" />
          {joining ? "Joining…" : "Join game"}
        </button>
        <p className="m-0 text-[13px] text-fg-muted">
          No account needed. The game runs in your browser, and {info.host}
          &apos;s map loads when you join.
        </p>
      </form>
    </section>
  );
}

function Waiting({
  info,
  players,
  peer,
  onLeave,
}: {
  info: RoomInfo | null;
  players: RoomPlayer[];
  peer: number;
  onLeave: () => void;
}) {
  return (
    <StatusCard
      icon={Users}
      tone="info"
      title="You're in"
      actions={
        <button type="button" className="button" onClick={onLeave}>
          Leave
        </button>
      }
    >
      <p className="m-0">
        Waiting for {info?.host ?? "the host"} to start the game.
      </p>
      <ul aria-label="Players" className="m-0 grid list-none gap-2 p-0">
        {players.map((player) => (
          <li key={player.peer} className="flex items-center gap-3">
            <PlayerBadge peer={player.peer} />
            <span className="flex-1 text-fg">
              {player.name}
              {player.peer === peer ? " (you)" : ""}
            </span>
            <span className="font-mono text-[11px] text-fg-muted uppercase">
              {player.peer === hostPeer
                ? "Host"
                : player.ready
                  ? "Ready"
                  : `${Math.round(player.progress * 100)}%`}
            </span>
          </li>
        ))}
      </ul>
    </StatusCard>
  );
}

function CoopJoin({ code }: { code: string }) {
  const [state, setState] = useState<JoinState>({
    step: "finding",
    slow: false,
  });
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const roomRef = useRef<GuestRoom | null>(null);
  const linksRef = useRef<PeerLinks | null>(null);
  const relayRef = useRef(packetRelay());
  const [session, setSession] = useState<CoopSession | null>(null);

  useEffect(() => {
    let peer = 0;
    let roster: RoomPlayer[] = [];
    let game: CoopGame | null = null;
    const slow = setTimeout(
      () =>
        setState((current) =>
          current.step === "finding"
            ? { step: "finding", slow: true }
            : current,
        ),
      slowFindMs,
    );
    const direct = peerLinks({
      signal: (to, signal) => room.signal(to, signal),
      onPacket: relayRef.current.deliver,
      onState: () => {},
    });
    const room = joinRoom(openTransport(code), appVersion, {
      onInfo: (next) => {
        setInfo(next);
        roster = next.players;
        setPlayers(next.players);
        setState((current) => {
          if (current.step !== "finding") return current;
          if (next.started) return { step: "ended", reason: "started" };
          if (next.players.length >= next.maxPlayers) {
            return { step: "ended", reason: "full" };
          }
          return { step: "invite" };
        });
      },
      onJoined: (joined) => {
        peer = joined;
        setState({ step: "getting", peer: joined, progress: 0 });
        void direct.connect(hostPeer);
      },
      onRefused: (reason) => setState({ step: "ended", reason }),
      onRoster: (next) => {
        roster = next;
        setPlayers(next);
      },
      onProgress: (progress) =>
        setState((current) =>
          current.step === "getting" ? { ...current, progress } : current,
        ),
      onGame: (received) => {
        game = received;
        setState({ step: "waiting", peer, game: received });
      },
      onStart: () => {
        if (game) setState({ step: "playing", peer, game });
      },
      onPacket: relayRef.current.deliver,
      onSignal: (from, signal) => void direct.handle(from, signal),
      onClosed: (reason) => {
        direct.closeAll();
        setState({ step: "ended", reason });
      },
    });
    roomRef.current = room;
    linksRef.current = direct;
    setSession({
      role: "guest",
      peer: 0,
      mode: "coop",
      skill: "medium",
      wad: new Uint8Array(0),
      send: (to, data) => {
        if (!direct.send(to, data)) room.send(to, data);
      },
      listen: relayRef.current.listen,
      players: () => 0,
      roster: () => roster,
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
  }, [code]);

  const game = state.step === "playing" ? state.game : null;
  const peer = state.step === "playing" ? state.peer : 0;
  // A new session object would restart the game, so it only changes with it.
  const playing = useMemo(
    () =>
      session && game
        ? {
            ...session,
            peer,
            wad: game.wad,
            mode: game.mode,
            skill: game.skill,
          }
        : null,
    [session, game, peer],
  );

  const leave = () => {
    roomRef.current?.leave();
    linksRef.current?.closeAll();
    setState({ step: "ended", reason: "left" });
  };

  if (state.step === "playing" && playing) {
    return (
      <GameView
        map={state.game.map}
        title={state.game.title}
        slot={state.game.slot}
        par={state.game.par}
        coop={playing}
        onExit={leave}
      />
    );
  }

  return (
    <div className="grid min-h-dvh grid-rows-[48px_minmax(0,1fr)] bg-canvas text-fg">
      <header className="flex items-center border-b border-border bg-surface pl-4">
        <button
          type="button"
          className="border-0 bg-transparent p-0 text-[17px] font-bold tracking-[0.02em] text-accent"
          onClick={backHome}
        >
          WADSMITH
        </button>
      </header>
      <main className="grid place-items-center p-4">
        <div className="w-[min(460px,100%)]">
          {state.step === "finding" ? (
            <p className="m-0 text-center text-sm text-fg-muted" role="status">
              {!state.slow
                ? "Finding the room…"
                : roomsUrl
                  ? "Still looking for this room. Check the link, and that the host still has the room open."
                  : "Still looking for this room. The host's tab has to stay open in this browser."}
            </p>
          ) : null}
          {(state.step === "invite" || state.step === "joining") && info ? (
            <Invite
              code={code}
              info={{ ...info, players }}
              joining={state.step === "joining"}
              onJoin={(name) => {
                saveName(name);
                setState({ step: "joining" });
                roomRef.current?.join(name);
              }}
            />
          ) : null}
          {state.step === "getting" ? (
            <StatusCard
              icon={Download}
              tone="info"
              title={`Getting ${info?.title ?? "the map"}`}
              actions={
                <button type="button" className="button" onClick={leave}>
                  Cancel
                </button>
              }
            >
              <p className="m-0">
                Building the level on your computer so it matches{" "}
                {info?.host ?? "the host"}&apos;s.
              </p>
              <Progress label="Map file" value={state.progress} />
            </StatusCard>
          ) : null}
          {state.step === "waiting" ? (
            <Waiting
              info={info}
              players={players}
              peer={state.peer}
              onLeave={leave}
            />
          ) : null}
          {state.step === "ended" ? (
            <Ended reason={state.reason} info={info} />
          ) : null}
        </div>
      </main>
    </div>
  );
}

export { CoopJoin };
