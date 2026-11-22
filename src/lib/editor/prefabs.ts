import type { GameMap } from "@/lib/map/types";

import { listStoredFiles, writeStoredFile } from "@/lib/episodes/episode-store";
import { parseFragment, serializeFragment } from "@/lib/map/fragment";

// A copied piece kept under a name, to place again in this map or another.
export interface Prefab {
  id: string;
  name: string;
  fragment: GameMap;
}

const prefix = "prefab:";
const maxNameLength = 40;

// One that can no longer be read is left out.
export async function listPrefabs(): Promise<Prefab[]> {
  const files = await listStoredFiles(prefix);
  return files.flatMap(({ key, name, data }) => {
    const piece = parseFragment(new TextDecoder().decode(data));
    return piece
      ? [{ id: key.slice(prefix.length), name, fragment: piece.fragment }]
      : [];
  });
}

// Like the maps, a prefab stays in this browser.
export async function savePrefab(
  name: string,
  fragment: GameMap,
): Promise<Prefab> {
  const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const key = `${prefix}${id}`;
  const kept = name.trim().slice(0, maxNameLength) || "Prefab";
  await writeStoredFile(key, {
    key,
    name: kept,
    data: new TextEncoder().encode(serializeFragment(fragment)),
  });
  return { id, name: kept, fragment };
}

export async function removePrefab(id: string) {
  await writeStoredFile(`${prefix}${id}`, null);
}
