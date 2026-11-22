import type { RoomMessage, RoomTransport } from "./room";

// Game packets travel as [from, to, ...data] binary frames, because they are
// most of the traffic. Everything else is JSON with its bytes in base64.
const bytesKey = "$bytes";

function toBase64(bytes: Uint8Array) {
  let text = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(text);
}

function fromBase64(text: string) {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

function encodeMessage(message: RoomMessage): string | Uint8Array<ArrayBuffer> {
  if (message.type === "packet") {
    const frame = new Uint8Array(message.data.length + 2);
    frame.set([message.from, message.to]);
    frame.set(message.data, 2);
    return frame;
  }
  return JSON.stringify(message, (_key, value: unknown) =>
    value instanceof Uint8Array ? { [bytesKey]: toBase64(value) } : value,
  );
}

function decodeMessage(data: string | ArrayBuffer): RoomMessage | null {
  if (typeof data !== "string") {
    const frame = new Uint8Array(data);
    if (frame.length < 3) return null;
    return {
      type: "packet",
      from: frame[0],
      to: frame[1],
      data: frame.slice(2),
    };
  }
  try {
    return JSON.parse(data, (_key, value: unknown) =>
      value && typeof value === "object" && bytesKey in value
        ? fromBase64((value as Record<string, string>)[bytesKey])
        : value,
    ) as RoomMessage;
  } catch {
    return null;
  }
}

// Reaches the room server, which passes each message to the room's other players.
function socketTransport(url: string): RoomTransport {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  const waiting: (string | Uint8Array<ArrayBuffer>)[] = [];
  let handler: ((message: RoomMessage) => void) | null = null;
  let closing = false;

  const send = (data: string | Uint8Array<ArrayBuffer>) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(data);
    else if (socket.readyState === WebSocket.CONNECTING) waiting.push(data);
  };

  socket.addEventListener("open", () => {
    for (const data of waiting.splice(0)) socket.send(data);
  });
  socket.addEventListener("message", (event: MessageEvent) => {
    const message = decodeMessage(event.data as string | ArrayBuffer);
    if (message) handler?.(message);
  });
  socket.addEventListener("close", () => {
    if (!closing) handler?.({ type: "dropped" });
  });

  return {
    post: (message) => send(encodeMessage(message)),
    listen: (next) => {
      handler = next;
    },
    identify: (peer) => send(JSON.stringify({ type: "identify", peer })),
    close: () => {
      closing = true;
      // Messages posted just before closing, like a goodbye, still go out.
      if (socket.readyState === WebSocket.OPEN) socket.close();
      else socket.addEventListener("open", () => socket.close());
    },
  };
}

export { decodeMessage, encodeMessage, socketTransport };
