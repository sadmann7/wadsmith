import { type GameFile, WadFileError } from "./inspect";

const endSignature = 0x06054b50;
const entrySignature = 0x02014b50;
const localSignature = 0x04034b50;
const stored = 0;
const deflated = 8;
const wanted = /\.(wad|deh|bex)$/i;

export function isZip(data: Uint8Array) {
  return (
    data.length >= 4 &&
    new DataView(data.buffer, data.byteOffset).getUint32(0, true) ===
      localSignature
  );
}

// Only the WADs and patches come out; text files, demos and screenshots stay behind.
export async function unzip(file: GameFile): Promise<GameFile[]> {
  const { data } = file;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  for (
    let at = data.length - 22;
    at >= Math.max(0, data.length - 65557);
    at--
  ) {
    if (view.getUint32(at, true) === endSignature) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new WadFileError(`${file.name} is damaged.`);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files: GameFile[] = [];
  for (let index = 0; index < count; index++) {
    if (view.getUint32(at, true) !== entrySignature) {
      throw new WadFileError(`${file.name} is damaged.`);
    }
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const path = new TextDecoder().decode(
      data.subarray(at + 46, at + 46 + nameLength),
    );
    at += 46 + nameLength + extraLength + commentLength;
    const name = path.split("/").at(-1) ?? path;
    // macOS adds __MACOSX/._name copies that hold file metadata, not data.
    if (!wanted.test(name) || name.startsWith("._")) continue;
    const start =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    const packed = data.subarray(start, start + size);
    if (method === stored) files.push({ name, data: packed.slice() });
    else if (method === deflated)
      files.push({ name, data: await inflate(packed) });
    else {
      throw new WadFileError(
        `${file.name} uses a compression Wadsmith can't open. Unzip it first.`,
      );
    }
  }
  return files;
}

async function inflate(data: Uint8Array) {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
