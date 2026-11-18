const engineBase = `${import.meta.env.BASE_URL}engine/`;

let iwad: Promise<Uint8Array> | null = null;

function loadIwad() {
  iwad ??= fetch(`${engineBase}freedoom2.wad`)
    .then(async (response) => {
      if (!response.ok) throw new Error("freedoom2.wad is missing.");
      return new Uint8Array(await response.arrayBuffer());
    })
    .catch((error: unknown) => {
      iwad = null;
      throw error;
    });
  return iwad;
}

export { engineBase, loadIwad };
