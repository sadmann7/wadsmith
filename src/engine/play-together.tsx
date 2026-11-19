import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import {
  Check,
  CircleCheck,
  Copy,
  Lock,
  Plus,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
import { Choice, PlayerBadge, Progress } from "./coop-ui";
import { peerLinks, type LinkState, type PeerLinks } from "./peer-link";
import type { CoopSession } from "./play-panel";
import {
  formatRoomCode,
  hostPeer,
  hostRoom,
  newRoomCode,
  type CoopGame,
  type HostRoom,
  type RoomPlayer,
} from "./room";
import type { NetworkMode, Skill } from "./runtime";

const dialogClass =
  "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[600px] max-w-[calc(100vw-32px)] -translate-1/2 flex-col overflow-hidden rounded-[4px] border border-border-strong bg-surface outline-none";
const titleClass =
  "block font-sans text-xl font-bold tracking-normal text-fg normal-case";
const labelClass = "mb-2 block text-[13px] text-fg-soft";

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

function Checklist({ map, settings }: { map: GameMap; settings: Settings }) {
  const starts =
    settings.mode === "coop" ? coopPlayers(map) : deathmatchSpots(map);
  const rows = [
    { done: true, title: "Map check passed", detail: "No errors" },
    settings.mode === "coop"
      ? {
          done: starts >= settings.players,
          title: `${starts} player ${starts === 1 ? "start" : "starts"} placed`,
          detail: "One for each player",
        }
      : {
          done: starts >= deathmatchStarts,
          title: `${starts} deathmatch ${starts === 1 ? "start" : "starts"} placed`,
          detail: `${deathmatchStarts} or more for deathmatch`,
        },
  ];
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {rows.map((row) => (
        <li key={row.title} className="flex gap-2.5">
          {row.done ? (
            <CircleCheck
              size={16}
              aria-hidden="true"
              className="text-success"
            />
          ) : (
            <TriangleAlert
              size={16}
              aria-hidden="true"
              className="text-warning"
            />
          )}
          <span className="grid gap-0.5">
            <span className="text-sm">{row.title}</span>
            <span className="font-mono text-[11px] text-fg-muted">
              {row.detail}
            </span>
          </span>
        </li>
      ))}
      <li className="flex gap-2.5">
        <Lock size={16} aria-hidden="true" className="text-fg-muted" />
        <span className="grid gap-0.5">
          <span className="text-sm">Editing pauses while the room is open</span>
          <span className="font-mono text-[11px] text-fg-muted">
            Everyone plays the same version of the map
          </span>
        </span>
      </li>
    </ul>
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
  return (
    <div className="grid gap-5 overflow-y-auto p-5">
      <label className="field">
        <span className="label">Your name</span>
        <input
          className="text-input"
          maxLength={maxNameLength}
          placeholder="Player 1"
          value={settings.name}
          onChange={(event) =>
            onChange({ ...settings, name: event.target.value })
          }
        />
      </label>
      <div>
        <span className={labelClass}>Mode</span>
        <Choice
          label="Mode"
          value={settings.mode}
          options={(["coop", "deathmatch"] as const).map((mode) => ({
            value: mode,
            label: modeNames[mode],
          }))}
          onChange={(mode) => onChange({ ...settings, mode })}
        />
        <p className="m-0 mt-2 text-[13px] text-fg-muted">
          {modeHelp[settings.mode]}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-5 max-[520px]:grid-cols-1">
        <div>
          <span className={labelClass}>Players</span>
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
          <span className={labelClass}>Skill</span>
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
      {settings.mode === "coop" && missing.length > 0 ? (
        <section
          aria-label="Missing starts"
          className="grid gap-3 rounded-[3px] border border-border-strong p-4"
        >
          <h3 className="m-0 flex items-center gap-2 text-base font-semibold">
            <TriangleAlert
              size={16}
              aria-hidden="true"
              className="text-warning"
            />
            Starts for {missing.length === 1 ? "player" : "players"}{" "}
            {listPlayers(missing)} {missing.length === 1 ? "is" : "are"} missing
          </h3>
          <p className="m-0 text-sm text-fg-soft">
            Co-op needs a start for each player.{" "}
            {onAddStarts ? "Add them next to player 1's start, or" : "Choose"}{" "}
            {coop > 1 ? `${coop} players` : "a map with more starts"}.
          </p>
          {onAddStarts ? (
            <button
              type="button"
              className="button justify-self-start"
              onClick={() => onAddStarts(settings.players)}
            >
              <Plus size={14} aria-hidden="true" />
              Add starts
            </button>
          ) : null}
        </section>
      ) : null}
      {settings.mode === "deathmatch" && spots < deathmatchStarts ? (
        <section
          aria-label="Missing starts"
          className="grid gap-2 rounded-[3px] border border-border-strong p-4"
        >
          <h3 className="m-0 flex items-center gap-2 text-base font-semibold">
            <TriangleAlert
              size={16}
              aria-hidden="true"
              className="text-warning"
            />
            Deathmatch needs {deathmatchStarts} deathmatch starts
          </h3>
          <p className="m-0 text-sm text-fg-soft">
            This map has {spots}. Place them in Things mode, under Starts.
          </p>
        </section>
      ) : null}
      <div>
        <span className={labelClass}>Before the room opens</span>
        <Checklist map={map} settings={settings} />
      </div>
    </div>
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
  const [copied, setCopied] = useState(false);
  const link = inviteLink(code);
  const open = Array.from(
    { length: Math.max(0, max - players.length) },
    (_, index) => players.length + index + 1,
  );
  return (
    <div className="grid gap-4 overflow-y-auto p-5">
      <div>
        <span className={labelClass}>Invite link</span>
        <div className="flex gap-2">
          <input
            className="text-input min-w-0 flex-1 font-mono text-xs"
            aria-label="Invite link"
            readOnly
            value={link}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="button"
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
          </button>
        </div>
        <p className="m-0 mt-2 text-[13px] text-fg-muted">
          {roomsUrl
            ? "Stops working once the game starts."
            : "Opens in other tabs of this browser. Stops working once the game starts."}
        </p>
      </div>
      {lost ? (
        <p className="notice m-0" role="alert">
          Lost the connection to the game server. Close this and try again.
        </p>
      ) : null}
      <section aria-label="Players">
        <div className="flex justify-between border-b border-border pb-2 font-mono text-[11px] tracking-wide text-fg-muted uppercase">
          <span>Players</span>
          <span>
            {players.length} of {max}
          </span>
        </div>
        <ul className="m-0 list-none p-0">
          {players.map((player) => (
            <li
              key={player.peer}
              className="flex items-center gap-3 border-b border-border py-2.5"
            >
              <PlayerBadge peer={player.peer} />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-[15px] font-semibold">
                  {player.name}
                </span>
                <span className="font-mono text-[11px] text-fg-muted uppercase">
                  {player.peer === hostPeer
                    ? "You · Host"
                    : `Player ${player.peer}`}
                </span>
              </span>
              {player.peer !== hostPeer ? (
                <span className="font-mono text-[11px] text-fg-muted">
                  {[
                    links[player.peer] ? linkLabels[links[player.peer]] : null,
                    player.ping === null ? null : `${player.ping} ms`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
              {player.ready ? (
                <span className="flex items-center gap-1.5 text-[13px]">
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-success"
                  />
                  Ready
                </span>
              ) : (
                <span className="w-32">
                  <Progress label="Getting map" value={player.progress} />
                </span>
              )}
              {player.peer !== hostPeer ? (
                <button
                  type="button"
                  className="border-0 bg-transparent p-0 text-[13px] text-fg-muted hover:text-danger"
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
              className="flex items-center gap-3 border-b border-border py-2.5 text-fg-muted"
            >
              <PlayerBadge peer={peer} open />
              <span className="grid gap-0.5">
                <span className="text-[15px]">Open slot</span>
                <span className="font-mono text-[11px] uppercase">
                  Waiting for someone to join
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
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
  const [settings, setSettings] = useState<Settings>(() => {
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
  const [code, setCode] = useState<string | null>(null);
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [links, setLinks] = useState<Record<number, LinkState>>({});
  const [lost, setLost] = useState(false);
  const roomRef = useRef<HostRoom | null>(null);
  const linksRef = useRef<PeerLinks | null>(null);
  const relayRef = useRef(packetRelay());
  const handedOff = useRef(false);
  const gameRef = useRef<CoopGame | null>(null);
  const hostRef = useRef({ name: "Player 1", players: 2 });

  const ready =
    settings.mode === "coop"
      ? coopPlayers(map) >= settings.players
      : deathmatchSpots(map) >= deathmatchStarts;

  useEffect(() => {
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
        mode: game.mode,
        skill: game.skill,
        wad: game.wad,
        send: (to, data) => {
          if (!direct.send(to, data)) room.send(to, data);
        },
        listen: relayRef.current.listen,
        players: () => room.players().length,
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
      <DialogBackdrop className="fixed inset-0 z-40 bg-scrim" />
      <DialogContent className={dialogClass}>
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="grid gap-1">
            <DialogTitle className={titleClass}>
              {code ? "Waiting for players" : "Play together"}
            </DialogTitle>
            <span className="font-mono text-[11px] tracking-wide text-fg-muted uppercase">
              {code
                ? `${modeNames[settings.mode]} · ${skillNames[settings.skill]} · ${title}`
                : `${title} · ${slot}`}
            </span>
          </div>
          {code ? (
            <span
              aria-label="Room code"
              className="rounded-[3px] border border-border-strong px-2 py-1 font-mono text-sm tracking-widest"
            >
              {formatRoomCode(code)}
            </span>
          ) : (
            <DialogClose
              aria-label="Close"
              className="border-0 bg-transparent p-1 text-fg-muted hover:text-fg"
            >
              <X size={16} aria-hidden="true" />
            </DialogClose>
          )}
        </header>
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
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3">
          <span className="text-[13px] text-fg-muted" role="status">
            {code
              ? statusOf(players, settings.players)
              : "Anyone with the link can join until you start."}
          </span>
          <div className="flex gap-2">
            <button type="button" className="button" onClick={onClose}>
              {code ? "Leave room" : "Cancel"}
            </button>
            {code ? (
              <button
                type="button"
                className="button primary"
                disabled={!everyoneReady || lost}
                onClick={start}
              >
                Start game
              </button>
            ) : (
              <button
                type="button"
                className="button primary"
                disabled={!ready}
                onClick={createRoom}
              >
                <Users size={14} aria-hidden="true" />
                Create room
              </button>
            )}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

export { PlayTogether, type HostedGame };
