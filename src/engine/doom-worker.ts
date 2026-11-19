import {
  startDoom,
  screenHeight,
  screenWidth,
  type CreateDoom,
  type DoomGame,
  type GameStatus,
} from "./runtime";

type SoundLevel = { volume: number; muted: boolean };

type DoomWorkerRequest =
  | {
      type: "start";
      engineUrl: string;
      baseUrl: string;
      iwad: Uint8Array;
      map: Uint8Array;
      sound: SoundLevel;
      paused: boolean;
      sampleRate: number;
      audioPort: MessagePort | null;
    }
  | { type: "key"; pressed: boolean; key: number }
  | { type: "turn"; amount: number }
  | { type: "display" }
  | { type: "sound"; sound: SoundLevel }
  | { type: "pause"; paused: boolean }
  | { type: "recycle"; buffer: ArrayBuffer };

type DoomWorkerResponse =
  | { type: "frame"; buffer: ArrayBuffer; status: GameStatus | null }
  | { type: "exit" }
  | { type: "error"; stage: "load" | "start" | "run"; message: string };

const audioBlockFrames = 512;
const audioBlocksAhead = 4;
const audioPumpMs = 4;
const statusEveryMs = 100;

const scope = self as unknown as Worker;

let game: DoomGame | null = null;
let stage: "load" | "start" | "run" = "load";
let sound: SoundLevel = { volume: 8, muted: false };
let paused = false;
const heldKeys = new Set<number>();
let lastStatus = 0;
const errors: string[] = [];
const spareFrames: ArrayBuffer[] = [];

function post(message: DoomWorkerResponse, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

function fail(fallback: string) {
  const message = errors.findLast((line) => line.trim()) ?? fallback;
  post({ type: "error", stage, message });
}

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
        data.map((channel) => channel.buffer as ArrayBuffer),
      );
      sent += audioBlockFrames;
    }
  }, audioPumpMs);
}

function sendFrame() {
  if (!game) return;
  const buffer =
    spareFrames.pop() ?? new ArrayBuffer(screenWidth * screenHeight * 4);
  game.frame(new Uint8ClampedArray(buffer));
  const now = performance.now();
  const due = now - lastStatus >= statusEveryMs;
  if (due) lastStatus = now;
  post({ type: "frame", buffer, status: due ? game.status() : null }, [buffer]);
}

async function fetchBytes(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} is missing.`);
  return new Uint8Array(await response.arrayBuffer());
}

async function start(request: Extract<DoomWorkerRequest, { type: "start" }>) {
  sound = request.sound;
  paused ||= request.paused;
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
    map: request.map,
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
    paused = request.paused;
    game?.setPaused(paused);
  } else {
    spareFrames.push(request.buffer);
  }
});

scope.addEventListener("error", (event) => {
  event.preventDefault();
  fail("The engine stopped.");
});

export type { DoomWorkerRequest, DoomWorkerResponse, SoundLevel };
