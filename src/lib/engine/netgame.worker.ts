// Runs one engine in a Node worker thread for netgame.test.ts, so it can block
// while it waits for packets the way the game worker does in a browser.
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".")) throw error;
      return next(`${specifier}.ts`, context);
    }
  },
});

const { startDoom } = await import("./runtime");
const { NetInbox } = await import("./net-inbox");
const { defaultGame } = await import("./game");

interface Setup {
  role: "host" | "guest";
  mode: "coop" | "deathmatch";
  host: number;
  peer: number;
  inbox: SharedArrayBuffer;
  map: Uint8Array;
  engineDirectory: string;
}

type Command =
  | { type: "query"; id: number }
  | { type: "launch"; id: number }
  | { type: "key"; pressed: boolean; key: number };

const setup = workerData as Setup;
if (!parentPort) throw new Error("The network game runs in a worker thread.");
const port = parentPort;
const { default: createDoom } = await import(
  pathToFileURL(resolve(setup.engineDirectory, "woof.js")).href
);
const game = await startDoom({
  createDoom,
  iwad: {
    game: defaultGame,
    data: readFileSync(resolve(setup.engineDirectory, "freedoom2.wad")),
  },
  base: readFileSync(resolve(setup.engineDirectory, "woof.pk3")),
  wads: [setup.map],
  options: { print: () => {}, printErr: () => {} },
  network: {
    role: setup.role,
    mode: setup.mode,
    host: setup.host,
    peer: setup.peer,
    inbox: new NetInbox(setup.inbox),
    send: (to, data) => port.postMessage({ type: "send", to, data }),
  },
});

port.on("message", (command: Command) => {
  if (command.type === "key") {
    game.key(command.pressed, command.key);
  } else if (command.type === "launch") {
    port.postMessage({
      type: "reply",
      id: command.id,
      value: game.launchNetGame(),
    });
  } else {
    port.postMessage({
      type: "reply",
      id: command.id,
      value: {
        ...game.network(),
        inLevel: game.status().inLevel,
        frags: game.status().frags,
        kills: game.status().kills,
        players: [0, 1].map((player) => game.playerPosition(player)),
        trail: [...(game.takeTrail() ?? [])],
      },
    });
  }
});
port.postMessage({ type: "started" });
