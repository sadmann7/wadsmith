import { Check, Copy, Lock, Play, Plus, TriangleAlert } from "lucide-react";
import * as React from "react";

import { deathmatchStarts } from "../map/catalog";
import type { GameMap } from "../map/types";
import { compileMap } from "../wad/compile";
import {
  appVersion,
  coopPlayers,
  deathmatchSpots,
  disconnectPacket,
  inviteLink,
  linkLabels,
  loadName,
  maxNameLength,
  modeHelp,
  modeNames,
  openTransport,
  packetRelay,
  roomsUrl,
  saveName,
  skillNames,
} from "./coop";
import {
  CardHeading,
  CardPreview,
  Choice,
  FieldLabel,
  PlayerBadge,
  Progress,
  SectionLabel,
} from "./coop-ui";
import { peerLinks, type LinkState, type PeerLinks } from "./peer-link";
import type { CoopSession } from "./play-panel";
import {
  hostPeer,
  hostRoom,
  newRoomCode,
  type CoopGame,
  type HostRoom,
  type RoomPlayer,
} from "./room";
import type { NetworkMode, Skill } from "./runtime";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
} from "../components/ui/dialog";
import { Alert } from "../components/ui/alert";

type HostedGame = { session: CoopSession; close: () => void };

type Settings = {
  mode: NetworkMode;
  players: number;
  skill: Skill;
  name: string;
};

function listPlayers(players: number[]) {
  return players.length > 1
    ? `${players.slice(0, -1).join(", ")} and ${players.at(-1)}`
    : `${players[0]}`;
}

function CheckRow({
  icon,
  title,
  detail,
  action,
}: {
  icon: "done" | "todo" | "lock";
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  const Icon = { done: Check, todo: TriangleAlert, lock: Lock }[icon];
  const color = {
    done: "text-success",
    todo: "text-warning",
    lock: "text-muted-foreground",
  }[icon];
  return (
    <li className="flex min-h-[44px] items-center gap-3 border-b border-border py-2">
      <span className="grid w-[22px] shrink-0 place-items-center">
        <Icon size={16} aria-hidden="true" className={color} />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className={`text-sm ${icon === "lock" ? "text-foreground" : ""}`}>
          {title}
        </span>
        {detail ? (
          <span className="text-sm text-muted-foreground">{detail}</span>
        ) : null}
      </span>
      {action}
    </li>
  );
}

function Setup({
  map,
  settings,
  onChange,
  onAddStarts,
}: {
  map: GameMap;
  settings: Settings;
  onChange: (settings: Settings) => void;
  onAddStarts?: (players: number) => void;
}) {
  const coop = coopPlayers(map);
  const missing = Array.from(
    { length: Math.max(0, settings.players - coop) },
    (_, index) => coop + index + 1,
  );
  const spots = deathmatchSpots(map);
  const short =
    settings.mode === "coop" ? missing.length > 0 : spots < deathmatchStarts;
  return (
    <>
      <label className="grid">
        <FieldLabel>Your name</FieldLabel>
        <Input
          maxLength={maxNameLength}
          placeholder="Player 1"
          value={settings.name}
          onValueChange={(name) => onChange({ ...settings, name })}
        />
      </label>
      <div>
        <FieldLabel>Mode</FieldLabel>
        <Choice
          label="Mode"
          value={settings.mode}
          options={(["coop", "deathmatch"] as const).map((mode) => ({
            value: mode,
            label: modeNames[mode],
          }))}
          onChange={(mode) => onChange({ ...settings, mode })}
        />
        <p className="m-0 mt-1.5 text-sm text-muted-foreground">
          {modeHelp[settings.mode]}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 max-[520px]:grid-cols-1">
        <div>
          <FieldLabel>Players</FieldLabel>
          <Choice
            label="Players"
            value={settings.players}
            options={[2, 3, 4].map((players) => ({
              value: players,
              label: String(players),
            }))}
            onChange={(players) => onChange({ ...settings, players })}
          />
        </div>
        <div>
          <FieldLabel>Skill</FieldLabel>
          <Choice
            label="Skill"
            value={settings.skill}
            options={(["easy", "medium", "hard"] as const).map((skill) => ({
              value: skill,
              label: skillNames[skill],
            }))}
            onChange={(skill) => onChange({ ...settings, skill })}
          />
        </div>
      </div>
      <section aria-label="Before the room opens">
        <SectionLabel
          aside={short ? <span className="text-warning">1 to fix</span> : null}
        >
          Before the room opens
        </SectionLabel>
        <ul className="m-0 list-none p-0">
          <CheckRow icon="done" title="Map check passed" />
          {settings.mode === "coop" ? (
            missing.length > 0 ? (
              <CheckRow
                icon="todo"
                title={`${missing.length === 1 ? "Player" : "Players"} ${listPlayers(missing)} ${missing.length === 1 ? "has no start" : "have no starts"}`}
                detail={
                  onAddStarts
                    ? "Co-op needs a start for each player."
                    : `Co-op needs a start for each player. Choose ${coop > 1 ? `${coop} players` : "a map with more starts"}.`
                }
                action={
                  onAddStarts ? (
                    <Button
                      className="shrink-0"
                      onClick={() => onAddStarts(settings.players)}
                    >
                      <Plus size={14} aria-hidden="true" />
                      {missing.length === 1 ? "Add start" : "Add starts"}
                    </Button>
                  ) : null
                }
              />
            ) : (
              <CheckRow
                icon="done"
                title={`${coop} player ${coop === 1 ? "start" : "starts"} placed`}
              />
            )
          ) : spots < deathmatchStarts ? (
            <CheckRow
              icon="todo"
              title={`Deathmatch needs ${deathmatchStarts} deathmatch starts`}
              detail={`This map has ${spots}. Place them in Things mode, under Starts.`}
            />
          ) : (
            <CheckRow icon="done" title={`${spots} deathmatch starts placed`} />
          )}
          <CheckRow icon="lock" title="Editing pauses while the room is open" />
        </ul>
      </section>
    </>
  );
}

function statusOf(players: RoomPlayer[], max: number) {
  const fetching = players.find((player) => !player.ready);
  if (players.length < 2) return "Waiting for someone to join.";
  if (fetching) return `Waiting for ${fetching.name} to get the map.`;
  if (players.length > max) return `This mode has room for ${max} players.`;
  return players.length === max
    ? "Everyone's here."
    : `${players.length} of ${max} players are ready.`;
}

function Lobby({
  code,
  players,
  max,
  links,
  lost,
  onRemove,
}: {
  code: string;
  players: RoomPlayer[];
  max: number;
  links: Record<number, LinkState>;
  lost: boolean;
  onRemove: (peer: number) => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const link = inviteLink(code);
  const open = Array.from(
    { length: Math.max(0, max - players.length) },
    (_, index) => players.length + index + 1,
  );
  return (
    <>
      <div className="grid gap-1.5">
        <div className="flex gap-2">
          <Input
            className="min-w-0 flex-1 font-mono text-xs"
            aria-label="Invite link"
            readOnly
            value={link}
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            onClick={() =>
              void navigator.clipboard
                ?.writeText(link)
                .then(() => setCopied(true))
            }
          >
            {copied ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <Copy size={14} aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
        <p className="m-0 text-sm text-muted-foreground">
          {roomsUrl
            ? "Anyone with the link can join until you start."
            : "Opens in other tabs of this browser until you start."}
        </p>
      </div>
      {lost ? (
        <Alert variant="destructive" role="alert">
          Lost the connection to the game server. Close this and try again.
        </Alert>
      ) : null}
      <section aria-label="Players">
        <SectionLabel
          aside={
            <span>
              {players.length} of {max}
            </span>
          }
        >
          Players
        </SectionLabel>
        <ul className="m-0 list-none p-0">
          {players.map((player) => (
            <li
              key={player.peer}
              className="flex h-[44px] items-center gap-3 border-b border-border"
            >
              <PlayerBadge peer={player.peer} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {player.name}
                {player.peer === hostPeer ? (
                  <span className="ml-2 font-mono text-xs font-normal tracking-[0.06em] text-muted-foreground">
                    YOU · HOST
                  </span>
                ) : null}
              </span>
              {player.peer !== hostPeer ? (
                <span className="font-mono text-xs text-muted-foreground">
                  {[
                    links[player.peer] ? linkLabels[links[player.peer]] : null,
                    player.ping === null ? null : `${player.ping} ms`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
              {player.ready ? (
                <span className="flex items-center gap-1.5 text-sm text-foreground">
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-success"
                  />
                  Ready
                </span>
              ) : (
                <span className="w-28">
                  <Progress label="Getting map" value={player.progress} />
                </span>
              )}
              {player.peer !== hostPeer ? (
                <button
                  type="button"
                  className="border-0 bg-transparent p-0 text-sm text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${player.name}`}
                  onClick={() => onRemove(player.peer)}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
          {open.map((peer) => (
            <li
              key={peer}
              className="flex h-[44px] items-center gap-3 border-b border-border text-sm text-muted-foreground"
            >
              <PlayerBadge peer={peer} open />
              Open slot
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function PlayTogether({
  map,
  title,
  slot,
  par,
  initialMode,
  onAddStarts,
  onStart,
  onClose,
}: {
  map: GameMap;
  title: string;
  slot: string;
  par: number | null;
  initialMode?: NetworkMode;
  onAddStarts?: (players: number) => void;
  onStart: (game: HostedGame) => void;
  onClose: () => void;
}) {
  const [settings, setSettings] = React.useState<Settings>(() => {
    const mode =
      initialMode ??
      (coopPlayers(map) > 1 || deathmatchSpots(map) < deathmatchStarts
        ? "coop"
        : "deathmatch");
    return {
      mode,
      players: mode === "coop" ? Math.max(2, coopPlayers(map)) : 4,
      skill: "medium",
      name: loadName(),
    };
  });
  const [code, setCode] = React.useState<string | null>(null);
  const [players, setPlayers] = React.useState<RoomPlayer[]>([]);
  const [links, setLinks] = React.useState<Record<number, LinkState>>({});
  const [lost, setLost] = React.useState(false);
  const roomRef = React.useRef<HostRoom | null>(null);
  const linksRef = React.useRef<PeerLinks | null>(null);
  const relayRef = React.useRef(packetRelay());
  const handedOff = React.useRef(false);
  const gameRef = React.useRef<CoopGame | null>(null);
  const hostRef = React.useRef({ name: "Player 1", players: 2 });

  const ready =
    settings.mode === "coop"
      ? coopPlayers(map) >= settings.players
      : deathmatchSpots(map) >= deathmatchStarts;

  React.useEffect(() => {
    const game = gameRef.current;
    if (!code || !game) return;
    const direct = peerLinks({
      signal: (to, signal) => room.signal(to, signal),
      onPacket: relayRef.current.deliver,
      onState: (peer, state) =>
        setLinks((current) => ({ ...current, [peer]: state })),
    });
    const room = hostRoom(
      openTransport(code),
      {
        game,
        name: hostRef.current.name,
        version: appVersion,
        maxPlayers: hostRef.current.players,
      },
      {
        onRoster: setPlayers,
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
  }, [code]);

  const createRoom = () => {
    const name = settings.name.trim();
    if (name) saveName(name);
    hostRef.current = { name: name || "Player 1", players: settings.players };
    gameRef.current = {
      map,
      mode: settings.mode,
      skill: settings.skill,
      wad: compileMap(map),
      title,
      slot,
      par,
    };
    setPlayers([
      {
        peer: hostPeer,
        name: hostRef.current.name,
        ready: true,
        progress: 1,
        ping: null,
      },
    ]);
    setCode(newRoomCode());
  };

  const start = () => {
    const room = roomRef.current;
    const direct = linksRef.current;
    const game = gameRef.current;
    if (!room || !direct || !game) return;
    handedOff.current = true;
    let announced = false;
    onStart({
      session: {
        role: "host",
        peer: hostPeer,
        mode: game.mode,
        skill: game.skill,
        wad: game.wad,
        send: (to, data) => {
          if (!direct.send(to, data)) room.send(to, data);
        },
        listen: relayRef.current.listen,
        players: () => room.players().length,
        roster: () => room.players(),
        announceStall: room.stall,
        listenStall: () => {},
        // Guests connect to the host's engine, so they start once it runs.
        onServerReady: () => {
          if (announced) return;
          announced = true;
          room.start();
        },
      },
      close: () => {
        direct.closeAll();
        room.close();
      },
    });
  };

  const everyoneReady =
    players.length >= 2 &&
    players.length <= settings.players &&
    players.every((player) => player.ready);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent className="w-[480px] overflow-hidden">
        <CardPreview map={map} code={code ?? undefined} />
        <div className="grid min-h-0 gap-[18px] overflow-y-auto px-6 pt-5">
          <CardHeading
            eyebrow={
              code
                ? `${modeNames[settings.mode]} · ${skillNames[settings.skill]} · ${slot} ${title}`
                : `${slot} · ${title}`
            }
            title={
              <DialogTitle className="m-0 text-2xl font-bold">
                {code ? "Waiting for players" : "Play together"}
              </DialogTitle>
            }
          />
          {code ? (
            <Lobby
              code={code}
              players={players}
              max={settings.players}
              links={links}
              lost={lost}
              onRemove={(peer) => roomRef.current?.kick(peer)}
            />
          ) : (
            <Setup
              map={map}
              settings={settings}
              onChange={setSettings}
              onAddStarts={onAddStarts}
            />
          )}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-6 pt-[18px] pb-5">
          <span className="text-sm text-muted-foreground" role="status">
            {code
              ? statusOf(players, settings.players)
              : "You get a link to share next."}
          </span>
          <div className="flex gap-2">
            <Button onClick={onClose}>{code ? "Leave room" : "Cancel"}</Button>
            {code ? (
              <Button
                variant="primary"

                disabled={!everyoneReady || lost}
                onClick={start}
              >
                <Play size={14} aria-hidden="true" />
                Start game
              </Button>
            ) : (
              <Button
                variant="primary"

                disabled={!ready}
                onClick={createRoom}
              >
                Create room
              </Button>
            )}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

export { PlayTogether, type HostedGame };
