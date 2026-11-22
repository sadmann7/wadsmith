import type { PeerSignal } from "./room";

// STUN finds each player's public address so most networks can connect
// directly. Players whose networks block that keep using the room's relay.
const iceServers: RTCIceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
];
// A channel this far behind is congested, and the relay is the better route.
const maxBuffered = 64 * 1024;
const connectTimeoutMs = 10_000;

export type LinkState = "connecting" | "direct" | "relayed";

interface Link {
  connection: RTCPeerConnection;
  channel: RTCDataChannel | null;
  ready: boolean;
  candidates: RTCIceCandidateInit[];
  timer: ReturnType<typeof setTimeout>;
}

// Game packets go straight between players once WebRTC connects, and through
// the room until then. Guests offer and the host answers, so offers never cross.
export function peerLinks({
  signal,
  onPacket,
  onState,
}: {
  signal: (to: number, signal: PeerSignal) => void;
  onPacket: (from: number, data: Uint8Array) => void;
  onState: (peer: number, state: LinkState) => void;
}) {
  const links = new Map<number, Link>();
  const supported = typeof RTCPeerConnection === "function";

  const attach = (peer: number, link: Link, channel: RTCDataChannel) => {
    link.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.addEventListener("open", () => {
      clearTimeout(link.timer);
      onState(peer, "direct");
    });
    channel.addEventListener("close", () => {
      if (links.get(peer) === link) onState(peer, "relayed");
    });
    channel.addEventListener("message", (event: MessageEvent<ArrayBuffer>) =>
      onPacket(peer, new Uint8Array(event.data)),
    );
  };

  const create = (peer: number) => {
    const connection = new RTCPeerConnection({ iceServers });
    const link: Link = {
      connection,
      channel: null,
      ready: false,
      candidates: [],
      // A link that never opens is left to try, while play goes through the relay.
      timer: setTimeout(() => onState(peer, "relayed"), connectTimeoutMs),
    };
    links.set(peer, link);
    onState(peer, "connecting");
    connection.addEventListener("icecandidate", (event) => {
      if (event.candidate)
        signal(peer, { candidate: event.candidate.toJSON() });
    });
    connection.addEventListener("datachannel", (event) =>
      attach(peer, link, event.channel),
    );
    connection.addEventListener("connectionstatechange", () => {
      if (connection.connectionState === "failed") onState(peer, "relayed");
    });
    return link;
  };

  const describe = async (
    link: Link,
    description: RTCSessionDescriptionInit,
  ) => {
    await link.connection.setRemoteDescription(description);
    link.ready = true;
    for (const candidate of link.candidates.splice(0)) {
      await link.connection.addIceCandidate(candidate).catch(() => {});
    }
  };

  return {
    connect: async (peer: number) => {
      if (!supported) {
        onState(peer, "relayed");
        signal(peer, { relayOnly: true });
        return;
      }
      const link = create(peer);
      attach(
        peer,
        link,
        link.connection.createDataChannel("game", {
          ordered: false,
          maxRetransmits: 0,
        }),
      );
      await link.connection.setLocalDescription();
      if (link.connection.localDescription) {
        signal(peer, {
          description: link.connection.localDescription.toJSON(),
        });
      }
    },
    handle: async (from: number, data: PeerSignal) => {
      if (!supported || data.relayOnly) {
        onState(from, "relayed");
        return;
      }
      const link = links.get(from) ?? create(from);
      try {
        if (data.description) {
          await describe(link, data.description);
          if (data.description.type === "offer") {
            await link.connection.setLocalDescription();
            if (link.connection.localDescription) {
              signal(from, {
                description: link.connection.localDescription.toJSON(),
              });
            }
          }
        }
        if (data.candidate) {
          if (link.ready) {
            await link.connection.addIceCandidate(data.candidate);
          } else {
            link.candidates.push(data.candidate);
          }
        }
      } catch {
        onState(from, "relayed");
      }
    },
    // Returns false when the packet has to go through the room instead.
    send: (to: number, data: Uint8Array) => {
      const channel = links.get(to)?.channel;
      if (
        channel?.readyState !== "open" ||
        channel.bufferedAmount > maxBuffered
      ) {
        return false;
      }
      channel.send(data as Uint8Array<ArrayBuffer>);
      return true;
    },
    close: (peer: number) => {
      const link = links.get(peer);
      if (!link) return;
      clearTimeout(link.timer);
      link.connection.close();
      links.delete(peer);
    },
    closeAll: () => {
      for (const link of links.values()) {
        clearTimeout(link.timer);
        link.connection.close();
      }
      links.clear();
    },
  };
}

export type PeerLinks = ReturnType<typeof peerLinks>;
