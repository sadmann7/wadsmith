import { decodeImage } from "@/lib/wad/image";
import { getIsWad, WadFileError } from "@/lib/wad/inspect";
import { packWad } from "@/lib/wad/pack";
import {
  buildTextureWad,
  flatSize,
  type IndexedImage,
  largestImage,
  lumpNameFor,
  quantizeImage,
  readWadTextures,
  takenNames,
} from "@/lib/wad/resources";

import { addResource, loadIwad, texturesOf } from "./iwad";

export interface AddedTextures {
  // The lump names of the textures made from images, and the WADs taken whole.
  images: string[];
  wads: string[];
  // Every wall texture and flat added, from an image or a WAD, and the images
  // with see-through parts, which suit an open line and not a solid wall.
  textures: string[];
  flats: string[];
  holed: string[];
  // DEHACKED patches, added as WADs that hold them.
  patches: string[];
  skipped: { name: string; reason: string }[];
}

const paletteBytes = 768;
const patchFile = /\.(deh|bex)$/i;

// Texture WADs are kept as they are. Images are matched to the game's palette
// and packed into one WAD, each under a name of its own made from its file's.
export async function addTextureFiles(files: File[]): Promise<AddedTextures> {
  const result: AddedTextures = {
    images: [],
    wads: [],
    textures: [],
    flats: [],
    holed: [],
    patches: [],
    skipped: [],
  };
  const iwad = await loadIwad();
  const source = texturesOf(iwad);
  const pictures: File[] = [];
  for (const file of files) {
    const data = new Uint8Array(await file.arrayBuffer());
    if (patchFile.test(file.name)) {
      try {
        const wad = packWad([{ name: "DEHACKED", data }]);
        await addResource(file.name, wad);
        source.resources.push(wad);
        result.patches.push(file.name);
      } catch (error) {
        result.skipped.push({
          name: file.name,
          reason:
            error instanceof WadFileError
              ? error.message
              : "It couldn't be read.",
        });
      }
      continue;
    }
    if (!getIsWad(data)) {
      pictures.push(file);
      continue;
    }
    try {
      await addResource(file.name, data);
      source.resources.push(data);
      result.wads.push(file.name);
      const added = readWadTextures(data, file.name);
      result.textures.push(...added.definitions.keys());
      result.flats.push(...added.flats.keys());
    } catch (error) {
      result.skipped.push({
        name: file.name,
        reason:
          error instanceof WadFileError
            ? error.message
            : "It couldn't be read.",
      });
    }
  }
  if (pictures.length === 0) return result;

  const palette = readWadTextures(iwad.data, iwad.game.file)
    .lumps.get("PLAYPAL")
    ?.subarray(0, paletteBytes);
  const taken = takenNames(source);
  const images: { name: string; image: IndexedImage }[] = [];
  const sources: string[] = [];
  for (const file of pictures) {
    try {
      if (!palette || palette.length < paletteBytes) {
        throw new WadFileError("The game has no palette to match it to.");
      }
      const decoded = await decodeImage(file);
      if (decoded.width > largestImage || decoded.height > largestImage) {
        throw new WadFileError(
          `It is larger than ${largestImage} by ${largestImage}.`,
        );
      }
      const name = lumpNameFor(file.name, taken);
      taken.add(name);
      images.push({
        name,
        image: quantizeImage(
          decoded.rgba,
          decoded.width,
          decoded.height,
          palette,
        ),
      });
      sources.push(file.name);
    } catch (error) {
      result.skipped.push({
        name: file.name,
        reason:
          error instanceof WadFileError
            ? error.message
            : "It isn't a WAD or an image the browser can read.",
      });
    }
  }
  if (images.length > 0) {
    await addResource(
      sources.length === 1
        ? sources[0]
        : `${sources[0]} and ${sources.length - 1} more`,
      buildTextureWad(images),
    );
    result.images = images.map(({ name }) => name);
    result.textures.push(...result.images);
    result.flats.push(
      ...images
        .filter(({ image }) => getIsFlatSized(image))
        .map(({ name }) => name),
    );
    result.holed = images
      .filter(({ image }) => image.opaque.includes(0))
      .map(({ name }) => name);
  }
  return result;
}

function getIsFlatSized(image: IndexedImage) {
  return image.width === flatSize && image.height === flatSize;
}
