import type {
  DoomWorkerRequest,
  DoomWorkerResponse,
  NetworkState,
  SoundLevel,
} from "./doom-worker";
import { engineBase } from "./iwad";
import { NetInbox } from "./net-inbox";
import type {
  EngineIwad,
  GameFiles,
  GameStatus,
  NetworkMode,
  Screen,
  Skill,
} from "./runtime";

interface GameClientOptions {
  iwad: EngineIwad;
  files: GameFiles;
  sound: SoundLevel;
  screen: Screen;
  skill: Skill;
  onFrame: (pixels: Uint8ClampedArray<ArrayBuffer>) => void;
  onStatus: (status: GameStatus) => void;
  onDropouts: (count: number) => void;
  onAudioUnavailable: () => void;
  onError: (message: string) => void;
  onExit: () => void;
  network?: {
    role: "host" | "guest";
    mode: NetworkMode;
    host: number;
    peer: number;
    send: (to: number, data: Uint8Array) => void;
    onState: (state: NetworkState) => void;
  };
}

const audioWorklet = `
class DoomAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.played = 0;
    this.calls = 0;
    this.dropouts = 0;
    this.link = null;
    this.port.onmessage = (event) => {
      this.link = event.data;
      this.link.onmessage = (message) => this.queue.push(message.data);
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    const length = out[0].length;
    let written = 0;
    while (written < length && this.queue.length > 0) {
      const chunk = this.queue[0];
      const size = chunk[0].length;
      const take = Math.min(length - written, size - this.offset);
      for (let channel = 0; channel < out.length; channel += 1) {
        const source = chunk[channel] ?? chunk[0];
        out[channel].set(source.subarray(this.offset, this.offset + take), written);
      }
      written += take;
      this.offset += take;
      this.played += take;
      if (this.offset >= size) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    if (written < length && this.played > 0) {
      this.dropouts += 1;
      this.port.postMessage(this.dropouts);
    }
    this.calls += 1;
    if (this.link && this.calls % 4 === 0) this.link.postMessage(this.played);
    return true;
  }
}
registerProcessor("doom-audio", DoomAudio);
`;

export function startGameClient(options: GameClientOptions) {
  const worker = new Worker(new URL("./doom-worker.ts", import.meta.url), {
    type: "module",
  });
  const audio = new AudioContext();
  let stopped = false;
  let sound = options.sound;
  let held = false;
  let pendingFrame: ArrayBuffer | null = null;
  let frameRequest = 0;
  const { network } = options;
  const inbox = network ? NetInbox.create() : null;

  const sendPause = () => {
    if (!network) send({ type: "pause", paused: document.hidden || held });
  };
  const onVisibilityChange = sendPause;
  document.addEventListener("visibilitychange", onVisibilityChange);

  const send = (message: DoomWorkerRequest, transfer: Transferable[] = []) => {
    if (!stopped) worker.postMessage(message, transfer);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    cancelAnimationFrame(frameRequest);
    worker.terminate();
    void audio.close();
  };

  const recycle = (buffer: ArrayBuffer) =>
    send({ type: "recycle", buffer }, [buffer]);

  // A frame that arrives before the last one was shown simply replaces it.
  const onDisplayFrame = () => {
    frameRequest = requestAnimationFrame(onDisplayFrame);
    send({ type: "display" });
    if (!pendingFrame) return;
    const buffer = pendingFrame;
    pendingFrame = null;
    options.onFrame(new Uint8ClampedArray(buffer));
    recycle(buffer);
  };

  const fail = (message: string) => {
    if (stopped) return;
    stop();
    options.onError(message);
  };

  worker.addEventListener(
    "message",
    (event: MessageEvent<DoomWorkerResponse>) => {
      const message = event.data;
      if (message.type === "frame") {
        if (pendingFrame) recycle(pendingFrame);
        pendingFrame = message.buffer;
        if (message.status) options.onStatus(message.status);
        if (message.network) network?.onState(message.network);
      } else if (message.type === "net") {
        network?.send(message.to, message.data);
      } else if (message.type === "exit") {
        stop();
        options.onExit();
      } else if (message.stage === "load") {
        fail(
          `The engine could not load: ${message.message} Run pnpm setup:engine if it hasn't been built.`,
        );
      } else if (message.stage === "start") {
        fail(`The game couldn't start: ${message.message}`);
      } else {
        fail(message.message);
      }
    },
  );
  worker.addEventListener("error", (event) => {
    fail(event.message || "The engine stopped.");
  });

  const connectAudio = async () => {
    const url = URL.createObjectURL(
      new Blob([audioWorklet], { type: "text/javascript" }),
    );
    try {
      await audio.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const node = new AudioWorkletNode(audio, "doom-audio", {
      numberOfInputs: 0,
      outputChannelCount: [2],
    });
    node.connect(audio.destination);
    node.port.addEventListener("message", (event: MessageEvent<number>) =>
      options.onDropouts(event.data),
    );
    node.port.start();
    // The worklet and worker talk directly, so a busy page can't delay audio.
    const channel = new MessageChannel();
    node.port.postMessage(channel.port1, [channel.port1]);
    return channel.port2;
  };

  const start = async () => {
    // AudioWorklet only exists on HTTPS and localhost; the game still runs without it.
    const audioPort = await connectAudio().catch(() => null);
    if (!audioPort) options.onAudioUnavailable();
    send(
      {
        type: "start",
        engineUrl: new URL(`${engineBase}woof.js`, location.href).href,
        baseUrl: new URL(`${engineBase}woof.pk3`, location.href).href,
        iwad: options.iwad,
        files: options.files,
        sound,
        paused: document.hidden || held,
        sampleRate: audio.sampleRate,
        audioPort,
        screen: options.screen,
        skill: options.skill,
        network:
          network && inbox
            ? {
                role: network.role,
                mode: network.mode,
                host: network.host,
                peer: network.peer,
                inbox: inbox.buffer,
              }
            : null,
      },
      audioPort ? [audioPort] : [],
    );
  };
  void start();
  frameRequest = requestAnimationFrame(onDisplayFrame);

  return {
    key: (pressed: boolean, key: number) => send({ type: "key", pressed, key }),
    turn: (amount: number) => send({ type: "turn", amount }),
    setSound: (next: SoundLevel) => {
      sound = next;
      send({ type: "sound", sound: next });
    },
    setHeld: (next: boolean) => {
      held = next;
      sendPause();
    },
    // Browsers can start audio suspended until the page gets a key or press.
    resumeAudio: () => {
      if (audio.state === "suspended") void audio.resume();
    },
    receive: (peer: number, data: Uint8Array) => inbox?.push(peer, data),
    launch: () => send({ type: "launch" }),
    stop,
  };
}

export type GameClient = ReturnType<typeof startGameClient>;
