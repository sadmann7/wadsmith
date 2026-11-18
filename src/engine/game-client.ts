import type {
  DoomWorkerRequest,
  DoomWorkerResponse,
  SoundLevel,
} from "./doom-worker";
import { engineBase } from "./iwad";
import type { GameStatus } from "./runtime";

type GameClientOptions = {
  iwad: Uint8Array;
  map: Uint8Array;
  sound: SoundLevel;
  onFrame: (pixels: Uint8ClampedArray<ArrayBuffer>) => void;
  onStatus: (status: GameStatus) => void;
  onDropouts: (count: number) => void;
  onAudioUnavailable: () => void;
  onError: (message: string) => void;
  onExit: () => void;
};

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

function startGameClient(options: GameClientOptions) {
  const worker = new Worker(new URL("./doom-worker.ts", import.meta.url), {
    type: "module",
  });
  const audio = new AudioContext();
  let stopped = false;
  let sound = options.sound;

  const onVisibilityChange = () =>
    send({ type: "pause", paused: document.hidden });
  document.addEventListener("visibilitychange", onVisibilityChange);

  const send = (message: DoomWorkerRequest, transfer: Transferable[] = []) => {
    if (!stopped) worker.postMessage(message, transfer);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    worker.terminate();
    void audio.close();
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
        options.onFrame(new Uint8ClampedArray(message.buffer));
        if (message.status) options.onStatus(message.status);
        send({ type: "recycle", buffer: message.buffer }, [message.buffer]);
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
        engineUrl: new URL(`${engineBase}websockets-doom.js`, location.href)
          .href,
        iwad: options.iwad,
        map: options.map,
        sound,
        paused: document.hidden,
        sampleRate: audio.sampleRate,
        audioPort,
      },
      audioPort ? [audioPort] : [],
    );
  };
  void start();

  return {
    key: (pressed: boolean, key: number) => send({ type: "key", pressed, key }),
    setSound: (next: SoundLevel) => {
      sound = next;
      send({ type: "sound", sound: next });
    },
    // Browsers can start audio suspended until the page gets a key or press.
    resumeAudio: () => {
      if (audio.state === "suspended") void audio.resume();
    },
    stop,
  };
}

type GameClient = ReturnType<typeof startGameClient>;

export { startGameClient, type GameClient };
