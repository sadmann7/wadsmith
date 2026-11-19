const maxPacket = 16384;
const headerBytes = 16;
const recordHeader = 8;
const writeIndex = 0;
const readIndex = 1;
const signalIndex = 2;

// One writer and one reader share a ring of [peer, length, bytes] records.
// Positions only grow, so the space in use is always write minus read.
class NetInbox {
  private readonly header: Int32Array;
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private readonly capacity: number;

  constructor(readonly buffer: SharedArrayBuffer) {
    this.header = new Int32Array(buffer, 0, headerBytes / 4);
    this.bytes = new Uint8Array(buffer, headerBytes);
    this.view = new DataView(buffer, headerBytes);
    this.capacity = this.bytes.length;
    // Positions wrap at 2^32, which only lines up with a power-of-two ring.
    if (this.capacity & (this.capacity - 1)) {
      throw new Error("The inbox size must be a power of two.");
    }
  }

  static create(capacity = 256 * 1024) {
    return new NetInbox(new SharedArrayBuffer(headerBytes + capacity));
  }

  // Returns false when the packet is dropped, as a full network would.
  push(peer: number, data: Uint8Array) {
    if (data.length === 0 || data.length > maxPacket) return false;
    const size = recordSize(data.length);
    const write = Atomics.load(this.header, writeIndex) >>> 0;
    const read = Atomics.load(this.header, readIndex) >>> 0;
    if (this.capacity - ((write - read) >>> 0) < size) return false;
    this.setUint32(write, peer);
    this.setUint32(write + 4, data.length);
    this.copyIn(write + recordHeader, data);
    Atomics.store(this.header, writeIndex, (write + size) | 0);
    Atomics.add(this.header, signalIndex, 1);
    Atomics.notify(this.header, signalIndex);
    return true;
  }

  pop(): { peer: number; data: Uint8Array } | null {
    const read = Atomics.load(this.header, readIndex) >>> 0;
    const write = Atomics.load(this.header, writeIndex) >>> 0;
    if (read === write) return null;
    const peer = this.getUint32(read);
    const length = this.getUint32(read + 4);
    if (length === 0 || length > maxPacket) {
      Atomics.store(this.header, readIndex, write | 0);
      return null;
    }
    const data = this.copyOut(read + recordHeader, length);
    Atomics.store(this.header, readIndex, (read + recordSize(length)) | 0);
    return { peer, data };
  }

  // Blocks the calling worker until a packet arrives or the time runs out.
  wait(ms: number) {
    const signal = Atomics.load(this.header, signalIndex);
    if (
      Atomics.load(this.header, readIndex) !==
      Atomics.load(this.header, writeIndex)
    ) {
      return;
    }
    Atomics.wait(this.header, signalIndex, signal, Math.max(0, ms));
  }

  private offset(position: number) {
    return position % this.capacity;
  }

  private setUint32(position: number, value: number) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    this.copyIn(position, bytes);
  }

  private getUint32(position: number) {
    const start = this.offset(position);
    if (start + 4 <= this.capacity) return this.view.getUint32(start, true);
    const bytes = this.copyOut(position, 4);
    return new DataView(bytes.buffer).getUint32(0, true);
  }

  private copyIn(position: number, data: Uint8Array) {
    const start = this.offset(position);
    const first = Math.min(data.length, this.capacity - start);
    this.bytes.set(data.subarray(0, first), start);
    this.bytes.set(data.subarray(first), 0);
  }

  private copyOut(position: number, length: number) {
    const start = this.offset(position);
    const first = Math.min(length, this.capacity - start);
    const data = new Uint8Array(length);
    data.set(this.bytes.subarray(start, start + first));
    data.set(this.bytes.subarray(0, length - first), first);
    return data;
  }
}

function recordSize(length: number) {
  return recordHeader + Math.ceil(length / 4) * 4;
}

export { maxPacket, NetInbox };
