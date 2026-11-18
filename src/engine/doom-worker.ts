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
      iwad: Uint8Array;
      map: Uint8Array;
      sound: SoundLevel;
      paused: boolean;
      sampleRate: number;
      audioPort: MessagePort | null;
    }
  | { type: "key"; pressed: boolean; key: number }
  | { type: "sound"; sound: SoundLevel }
  | { type: "pause"; paused: boolean }
  | { type: "recycle"; buffer: ArrayBuffer };

type DoomWorkerResponse =
  | { type: "frame"; buffer: ArrayBuffer; status: GameStatus | null }
  | { type: "exit" }
  | { type: "error"; stage: "load" | "start" | "run"; message: string };

type StandInProcessor = {
  bufferSize: number;
  channels: number;
  onaudioprocess: ((event: { outputBuffer: unknown }) => void) | null;
  connect: () => void;
  disconnect: () => void;
};

const audioBuffersAhead = 3;
const audioPumpMs = 5;
const framePumpMs = 4;
const statusEveryMs = 200;

const scope = self as unknown as Worker & Record<string, unknown>;

let game: DoomGame | null = null;
let processor: StandInProcessor | null = null;
let sampleRate = 48_000;
let stage: "load" | "start" | "run" = "load";
let sound: SoundLevel = { volume: 8, muted: false };
let paused = false;
const errors: string[] = [];
const spareFrames: ArrayBuffer[] = [];

function post(message: DoomWorkerResponse, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

function fail(fallback: string) {
  const message = errors.findLast((line) => line.trim()) ?? fallback;
  post({ type: "error", stage, message });
}

// SDL's audio driver only needs a context with a script processor. The samples
// it writes here go to the page's AudioWorklet instead of a speaker.
class WorkerAudioContext {
  sampleRate = sampleRate;
  state = "running";
  destination = {};
  currentTime = 0;

  createScriptProcessor(bufferSize: number, _inputs: number, channels: number) {
    processor = {
      bufferSize,
      channels,
      onaudioprocess: null,
      connect: () => {},
      disconnect: () => {},
    };
    return processor;
  }

  resume() {
    return Promise.resolve();
  }

  suspend() {
    return Promise.resolve();
  }

  close() {
    return Promise.resolve();
  }
}

function prepareBrowserApis() {
  scope.AudioContext = WorkerAudioContext;
  // Without this, SDL waits for a gesture on a document workers don't have.
  if (!("userActivation" in navigator)) {
    Object.defineProperty(navigator, "userActivation", {
      value: { hasBeenActive: true, isActive: true },
    });
  }
  // Timers keep the engine and its audio steady, unlike animation frames.
  Object.defineProperty(scope, "requestAnimationFrame", {
    value: undefined,
    configurable: true,
  });
}

function pumpAudio(port: MessagePort) {
  let sent = 0;
  let played = 0;
  port.addEventListener("message", (event: MessageEvent<number>) => {
    played = event.data;
  });
  port.start();
  setInterval(() => {
    if (!processor?.onaudioprocess) return;
    const { bufferSize, channels } = processor;
    while (sent - played < bufferSize * audioBuffersAhead) {
      const data = Array.from(
        { length: channels },
        () => new Float32Array(bufferSize),
      );
      processor.onaudioprocess({
        outputBuffer: {
          numberOfChannels: channels,
          length: bufferSize,
          sampleRate,
          getChannelData: (channel: number) => data[channel],
        },
      });
      port.postMessage(
        data,
        data.map((channel) => channel.buffer),
      );
      sent += bufferSize;
    }
  }, audioPumpMs);
}

function pumpFrames(running: DoomGame) {
  let lastStatus = 0;
  setInterval(() => {
    if (!running.hasNewFrame()) return;
    const buffer =
      spareFrames.pop() ?? new ArrayBuffer(screenWidth * screenHeight * 4);
    running.frame(new Uint8ClampedArray(buffer));
    const now = performance.now();
    const due = now - lastStatus >= statusEveryMs;
    if (due) lastStatus = now;
    post({ type: "frame", buffer, status: due ? running.status() : null }, [
      buffer,
    ]);
  }, framePumpMs);
}

async function start(request: Extract<DoomWorkerRequest, { type: "start" }>) {
  sampleRate = request.sampleRate;
  sound = request.sound;
  paused ||= request.paused;
  prepareBrowserApis();
  const { default: createDoom } = (await import(
    /* turbopackIgnore: true */ /* webpackIgnore: true */ request.engineUrl
  )) as { default: CreateDoom };
  stage = "start";
  const running = await startDoom({
    createDoom,
    iwad: request.iwad,
    map: request.map,
    options: {
      print: () => {},
      printErr: (line) => errors.push(line),
      onExit: () => post({ type: "exit" }),
    },
    sound: request.audioPort !== null,
  });
  stage = "run";
  game = running;
  if (paused) running.setPaused(true);
  if (request.audioPort) {
    running.setSound(sound.volume, sound.muted);
    pumpAudio(request.audioPort);
  }
  pumpFrames(running);
}

scope.addEventListener("message", (event) => {
  const request = event.data as DoomWorkerRequest;
  if (request.type === "start") {
    start(request).catch((error: Error) => fail(error.message));
  } else if (request.type === "key") {
    game?.key(request.pressed, request.key);
  } else if (request.type === "sound") {
    sound = request.sound;
    if (processor) game?.setSound(sound.volume, sound.muted);
  } else if (request.type === "pause") {
    paused = request.paused;
    game?.setPaused(paused);
  } else {
    spareFrames.push(request.buffer);
  }
});

// The engine traps on a fatal error inside its own main loop.
scope.addEventListener("error", (event) => {
  event.preventDefault();
  fail("The engine stopped.");
});

export type { DoomWorkerRequest, DoomWorkerResponse, SoundLevel };
