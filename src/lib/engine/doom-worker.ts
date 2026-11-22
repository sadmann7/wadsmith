import { NetInbox } from "./net-inbox";
import {
  type CreateDoom,
  type DoomGame,
  type EngineIwad,
  type GameFiles,
  type GameStatus,
  type NetworkMode,
  type Screen,
  screenSize,
  type Skill,
  startDoom,
} from "./runtime";

interface SoundLevel {
  volume: number;
  muted: boolean;
}

interface WorkerNetwork {
  role: "host" | "guest";
  mode: NetworkMode;
  host: number;
  peer: number;
  inbox: SharedArrayBuffer;
}

type NetworkState = ReturnType<DoomGame["network"]>;

type DoomWorkerRequest =
  | {
      type: "start";
      engineUrl: string;
      baseUrl: string;
      iwad: EngineIwad;
      files: GameFiles;
      sound: SoundLevel;
      paused: boolean;
      sampleRate: number;
      audioPort: MessagePort | null;
      screen: Screen;
      skill: Skill;
      network: WorkerNetwork | null;
    }
  | { type: "launch" }
  | { type: "key"; pressed: boolean; key: number }
  | { type: "turn"; amount: number }
  | { type: "display" }
  | { type: "sound"; sound: SoundLevel }
  | { type: "pause"; paused: boolean }
  | { type: "recycle"; buffer: ArrayBuffer };

type DoomWorkerResponse =
  | {
      type: "frame";
      buffer: ArrayBuffer;
      status: GameStatus | null;
      network: NetworkState | null;
    }
  | { type: "net"; to: number; data: Uint8Array }
  | { type: "exit" }
  | { type: "error"; stage: "load" | "start" | "run"; message: string };

const scope = self as unknown as Worker;

let game: DoomGame | null = null;
let stage: "load" | "start" | "run" = "load";
let sound: SoundLevel = { volume: 8, muted: false };
let paused = false;
let networked = false;
const heldKeys = new Set<number>();

const errors: string[] = [];
const spareFrames: ArrayBuffer[] = [];

scope.addEventListener("message", (event) => {
  const request = event.data as DoomWorkerRequest;
  if (request.type === "start") {
    start(request).catch((error: Error) => fail(error.message));
  } else if (request.type === "key") {
    if (request.pressed) heldKeys.add(request.key);
    else heldKeys.delete(request.key);
    game?.key(request.pressed, request.key);
  } else if (request.type === "turn") {
    game?.turn(request.amount);
  } else if (request.type === "display") {
    game?.syncToDisplay();
  } else if (request.type === "sound") {
    sound = request.sound;
    game?.setSound(sound.volume, sound.muted);
  } else if (request.type === "pause") {
    paused = request.paused && !networked;
    game?.setPaused(paused);
  } else if (request.type === "launch") {
    game?.launchNetGame();
  } else {
    spareFrames.push(request.buffer);
  }
});

async function start(request: Extract<DoomWorkerRequest, { type: "start" }>) {
  sound = request.sound;
  networked = request.network !== null;
  // Pausing one player's engine would stall everyone in a network game.
  paused = !networked && (paused || request.paused);
  const [{ default: createDoom }, base] = await Promise.all([
    import(
      /* turbopackIgnore: true */ /* webpackIgnore: true */ request.engineUrl
    ) as Promise<{ default: CreateDoom }>,
    fetchBytes(request.baseUrl),
  ]);
  stage = "start";
  const running = await startDoom({
    createDoom,
    iwad: request.iwad,
    base,
    ...request.files,
    options: {
      print: () => {},
      printErr: (line) => errors.push(line),
    },
    events: {
      onFrame: sendFrame,
      onExit: () => post({ type: "exit" }),
      onFailure: () => fail("The engine stopped."),
    },
    sampleRate: request.audioPort ? request.sampleRate : null,
    screen: request.screen,
    skill: request.skill,
    network: request.network
      ? {
          role: request.network.role,
          mode: request.network.mode,
          host: request.network.host,
          peer: request.network.peer,
          inbox: new NetInbox(request.network.inbox),
          send: (to, data) => post({ type: "net", to, data }, [data.buffer]),
        }
      : undefined,
  });
  stage = "run";
  game = running;
  if (paused) running.setPaused(true);
  for (const key of heldKeys) running.key(true, key);
  if (request.audioPort) {
    running.setSound(sound.volume, sound.muted);
    pumpAudio(running, request.audioPort);
  }
}

async function fetchBytes(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} is missing.`);
  return new Uint8Array(await response.arrayBuffer());
}

const statusEveryMs = 100;

let lastStatus = 0;

function sendFrame() {
  if (!game) return;
  const { width, height } = screenSize(game.screen);
  const buffer = spareFrames.pop() ?? new ArrayBuffer(width * height * 4);
  game.frame(new Uint8ClampedArray(buffer));
  const now = performance.now();
  const due = now - lastStatus >= statusEveryMs;
  if (due) lastStatus = now;
  post(
    {
      type: "frame",
      buffer,
      status: due ? game.status() : null,
      network: due && networked ? game.network() : null,
    },
    [buffer],
  );
}

const audioBlockFrames = 512;
const audioBlocksAhead = 4;
const audioPumpMs = 4;

function pumpAudio(running: DoomGame, port: MessagePort) {
  let sent = 0;
  let played = 0;
  port.addEventListener("message", (event: MessageEvent<number>) => {
    played = event.data;
  });
  port.start();
  setInterval(() => {
    while (sent - played < audioBlockFrames * audioBlocksAhead) {
      const data = running.audio(audioBlockFrames);
      port.postMessage(
        data,
        data.map((channel) => channel.buffer),
      );
      sent += audioBlockFrames;
    }
  }, audioPumpMs);
}

scope.addEventListener("error", (event) => {
  event.preventDefault();
  fail("The engine stopped.");
});

function post(message: DoomWorkerResponse, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

function fail(fallback: string) {
  const message = errors.findLast((line) => line.trim()) ?? fallback;
  post({ type: "error", stage, message });
}

export type {
  DoomWorkerRequest,
  DoomWorkerResponse,
  NetworkState,
  SoundLevel,
  WorkerNetwork,
};
