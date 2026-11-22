import type { GameMap } from "@/map/types";
import type { Lump } from "@/wad/compile";
import { buildMap } from "./episode-data";

type BuildCheckRequest = { id: number; map: GameMap };
type BuildCheckResult = {
  id: number;
  problem: string | null;
  lumps: Lump[] | null;
};

const scope = self as unknown as Worker;

scope.addEventListener(
  "message",
  ({ data }: MessageEvent<BuildCheckRequest>) => {
    const result: BuildCheckResult = { id: data.id, ...buildMap(data.map) };
    scope.postMessage(
      result,
      result.lumps
        ? [...new Set(result.lumps.map((lump) => lump.data.buffer))]
        : [],
    );
  },
);

export type { BuildCheckRequest, BuildCheckResult };
