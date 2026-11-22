import { readStoredFile, writeStoredFile } from "@/lib/episodes/episode-store";
import { parsePlaytest, type SavedPlaytest } from "@/lib/map/playtest";

const prefix = "playtest:";

// The last playtest of a map, kept in this browser like the map itself. One
// that can no longer be read counts as none.
export async function loadPlaytest(
  mapId: string,
): Promise<SavedPlaytest | null> {
  const file = await readStoredFile(`${prefix}${mapId}`);
  if (!file) return null;
  try {
    return parsePlaytest(JSON.parse(new TextDecoder().decode(file.data)));
  } catch {
    return null;
  }
}

export async function savePlaytest(mapId: string, saved: SavedPlaytest) {
  const key = `${prefix}${mapId}`;
  await writeStoredFile(key, {
    key,
    name: saved.run.id,
    data: new TextEncoder().encode(JSON.stringify(saved)),
  });
}

export async function clearPlaytest(mapId: string) {
  await writeStoredFile(`${prefix}${mapId}`, null);
}
