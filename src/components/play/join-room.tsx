import { LogOut, RefreshCw, Timer, Users, WifiOff } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIwad } from "@/hooks/use-iwad";
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
  stallRelay,
} from "@/lib/engine/coop";
import { defaultGame, type GameId, games } from "@/lib/engine/game";
import { peerLinks, type PeerLinks } from "@/lib/engine/peer-link";
import {
  type CoopGame,
  type Ending,
  formatRoomCode,
  type GuestRoom,
  hostPeer,
  joinRoom,
  type Refusal,
  type RoomInfo,
  type RoomPlayer,
} from "@/lib/engine/room";

import {
  CardHeading,
  CoopCard,
  FieldLabel,
  PlayerBadge,
  Progress,
  SectionLabel,
  StatusCard,
} from "./coop-ui";
import { type CoopSession, GameView } from "./play-panel";

const slowFindMs = 4000;

type JoinState =
  | { step: "finding"; slow: boolean }
  | { step: "invite" }
  | { step: "joining" }
  | { step: "getting"; peer: number; progress: number }
  | { step: "waiting"; peer: number; game: CoopGame }
  | { step: "playing"; peer: number; game: CoopGame }
  | { step: "ended"; reason: Refusal | Ending | "left" | "quit" | "game" };

interface CoopJoinProps {
  code: string;
}

export function CoopJoin({ code }: CoopJoinProps) {
  const [state, setState] = React.useState<JoinState>({
    step: "finding",
    slow: false,
  });
  const [info, setInfo] = React.useState<RoomInfo | null>(null);
  const [players, setPlayers] = React.useState<RoomPlayer[]>([]);
  const roomRef = React.useRef<GuestRoom | null>(null);
  const linksRef = React.useRef<PeerLinks | null>(null);
  const relayRef = React.useRef(packetRelay());
  const [session, setSession] = React.useState<CoopSession | null>(null);
  const [hostGame, setHostGame] = React.useState<GameId | null>(null);
  const iwad = useIwad();
  const currentGame = React.useEffectEvent(
    () => iwad?.game.id ?? defaultGame.id,
  );

  React.useEffect(() => {
    let peer = 0;
    let roster: RoomPlayer[] = [];
    const stalls = stallRelay();
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
      // A map plays on the host's IWAD, so another one here would desync.
      onGame: (received) => {
        const mine = currentGame();
        if (received.game && received.game !== mine) {
          setHostGame(received.game);
          setState({ step: "ended", reason: "game" });
          room.leave();
          return;
        }
        game = received;
        setState({ step: "waiting", peer, game: received });
      },
      onStall: stalls.deliver,
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
      announceStall: () => {},
      listenStall: stalls.listen,
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
  const playing = React.useMemo(
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
    setState({
      step: "ended",
      reason: state.step === "playing" ? "quit" : "left",
    });
  };

  if (state.step === "playing" && playing) {
    return (
      <GameView
        map={state.game.map}
        title={state.game.title}
        slot={state.game.slot}
        par={state.game.par}
        intertext={state.game.intertext}
        coop={playing}
        onExit={leave}
      />
    );
  }

  return (
    <GuestShell>
      {state.step === "finding" ? (
        <div className="grid justify-items-center gap-3 text-center">
          <h1 className="sr-only">Join a game</h1>
          <p className="m-0 text-base text-muted-foreground" role="status">
            {!state.slow
              ? "Finding the room…"
              : roomsUrl
                ? "Still looking for this room. Check the link, and that the host still has the room open."
                : "Still looking for this room. Without a room server, rooms only reach tabs in the host's browser profile."}
          </p>
          {state.slow ? <Button onClick={backHome}>Stop looking</Button> : null}
        </div>
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
      {state.step === "getting" && info ? (
        <CoopCard
          label={`Getting ${info.title}`}
          map={info.map}
          footer={
            <>
              <span />
              <Button onClick={leave}>Cancel</Button>
            </>
          }
        >
          <CardHeading
            eyebrow={`${modeNames[info.mode]} · ${skillNames[info.skill]} · ${info.title}`}
            title={<h1 className="m-0 text-2xl font-bold">Getting the map</h1>}
            detail={`Building the level on your computer so it matches ${info.host}'s.`}
          />
          <Progress label="Map file" value={state.progress} />
        </CoopCard>
      ) : null}
      {state.step === "waiting" && info ? (
        <Waiting
          info={info}
          players={players}
          peer={state.peer}
          onLeave={leave}
        />
      ) : null}
      {state.step === "ended" ? (
        <Ended reason={state.reason} info={info} hostGame={hostGame} />
      ) : null}
    </GuestShell>
  );
}

interface GuestShellProps {
  children: React.ReactNode;
}

function GuestShell({ children }: GuestShellProps) {
  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr_auto] bg-background text-foreground">
      <header className="flex h-[48px] items-center px-5">
        <Link
          href="/"
          className="text-[17px] font-bold tracking-[0.12em] text-primary no-underline"
        >
          WADSMITH
        </Link>
      </header>
      <main className="grid place-items-center p-4">
        <div className="grid w-[min(420px,100%)] gap-4">{children}</div>
      </main>
      <footer className="flex flex-wrap justify-center gap-x-4 gap-y-1 px-5 py-4 text-sm text-muted-foreground">
        <span>Doom maps, built and played in your browser.</span>
        <Link
          href="/source"
          className="text-muted-foreground underline underline-offset-4"
        >
          Source and licences
        </Link>
      </footer>
    </div>
  );
}

interface InviteProps {
  code: string;
  info: RoomInfo;
  joining: boolean;
  onJoin: (name: string) => void;
}

function Invite({ code, info, joining, onJoin }: InviteProps) {
  const [name, setName] = React.useState(loadName);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim()) onJoin(name.trim());
  };
  return (
    <CoopCard label={`Join ${info.title}`} map={info.map}>
      <CardHeading
        eyebrow={`Room ${formatRoomCode(code)} · ${modeNames[info.mode]} · ${skillNames[info.skill]}`}
        title={
          <h1 className="m-0 text-2xl font-bold">
            Join {info.host}&apos;s game
          </h1>
        }
        detail={`${info.title} · ${info.players.length} of ${info.maxPlayers} players here`}
      />
      <form className="grid gap-3.5" onSubmit={submit}>
        <label className="grid">
          <FieldLabel>Your name</FieldLabel>
          <Input
            maxLength={maxNameLength}
            autoFocus
            value={name}
            onValueChange={setName}
          />
        </label>
        <Button
          variant="primary"
          type="submit"
          className="h-9 justify-center"
          disabled={!name.trim() || joining}
        >
          {joining ? "Joining…" : "Join"}
        </Button>
      </form>
    </CoopCard>
  );
}

interface WaitingProps {
  info: RoomInfo;
  players: RoomPlayer[];
  peer: number;
  onLeave: () => void;
}

function Waiting({ info, players, peer, onLeave }: WaitingProps) {
  return (
    <CoopCard
      label="You're in"
      map={info.map}
      footer={
        <>
          <span className="text-sm text-muted-foreground" role="status">
            The game starts for everyone at once.
          </span>
          <Button onClick={onLeave}>Leave room</Button>
        </>
      }
    >
      <CardHeading
        eyebrow={`${modeNames[info.mode]} · ${skillNames[info.skill]} · ${info.title}`}
        title={<h1 className="m-0 text-2xl font-bold">You&apos;re in</h1>}
        detail={`Waiting for ${info.host} to start the game.`}
      />
      <section aria-label="Players">
        <SectionLabel
          aside={
            <span>
              {players.length} of {info.maxPlayers}
            </span>
          }
        >
          Players
        </SectionLabel>
        <ul className="m-0 list-none p-0">
          {players.map((player, slot) => (
            <li
              key={player.peer}
              className="flex h-[44px] items-center gap-3 border-b border-border"
            >
              <PlayerBadge slot={slot} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {player.name}
                {player.peer === peer || player.peer === hostPeer ? (
                  <span className="ml-2 font-mono text-xs font-normal tracking-[0.06em] text-muted-foreground">
                    {player.peer === peer ? "YOU" : "HOST"}
                  </span>
                ) : null}
              </span>
              {player.ready ? (
                <span className="flex items-center gap-1.5 text-sm text-foreground">
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-success"
                  />
                  Ready
                </span>
              ) : (
                <span className="font-mono text-xs text-muted-foreground">
                  {Math.round(player.progress * 100)}%
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </CoopCard>
  );
}

interface EndedProps {
  reason: Refusal | Ending | "left" | "quit" | "game";
  info: RoomInfo | null;
  hostGame: GameId | null;
}

function Ended({ reason, info, hostGame }: EndedProps) {
  const host = info?.host ?? "The host";
  const back = (
    <Button variant="primary" onClick={backHome}>
      Make your own map
    </Button>
  );
  if (reason === "game") {
    return (
      <StatusCard
        icon={LogOut}
        tone="info"
        title="A different game"
        actions={
          <>
            <Button onClick={() => location.reload()}>Join again</Button>
            {back}
          </>
        }
      >
        <p className="m-0">
          {host} plays on {hostGame ? games[hostGame].label : "another game"}.
          Everyone needs the same game, so bring its IWAD first.
        </p>
      </StatusCard>
    );
  }
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
          <Button
            variant="primary"

            onClick={() => location.reload()}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Reload
          </Button>
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
  if (reason === "quit") {
    return (
      <StatusCard
        icon={LogOut}
        tone="info"
        title="You left the game"
        actions={back}
      >
        <p className="m-0">
          A running game can&apos;t be rejoined. Ask {host} to open a new room.
        </p>
      </StatusCard>
    );
  }
  return (
    <StatusCard
      icon={LogOut}
      tone="info"
      title="You left the room"
      actions={
        <>
          <Button onClick={() => location.reload()}>Join again</Button>
          {back}
        </>
      }
    >
      <p className="m-0">You can join again while the room is open.</p>
    </StatusCard>
  );
}

function backHome() {
  location.assign("/");
}
