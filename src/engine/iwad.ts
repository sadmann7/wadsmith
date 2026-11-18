const engineBase = "/engine/";
// Hosts don't compress WAD files, so setup:engine writes this one gzipped.
const iwadFile = "freedoom-0.13.0.wad.gz";

let iwad: Promise<Uint8Array> | null = null;

function loadIwad() {
  iwad ??= fetch(`${engineBase}${iwadFile}`)
    .then(async (response) => {
      if (!response.ok || !response.body) {
        throw new Error(`${iwadFile} is missing.`);
      }
      const data = response.body.pipeThrough(new DecompressionStream("gzip"));
      return new Uint8Array(await new Response(data).arrayBuffer());
    })
    .catch((error: unknown) => {
      iwad = null;
      throw error;
    });
  return iwad;
}

export { engineBase, loadIwad };
