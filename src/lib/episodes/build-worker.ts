import type { CheckedIssue } from "@/lib/map/checks";
import type { GameMap } from "@/lib/map/types";
import type { Lump } from "@/lib/wad/compile";

import { buildAndCheck } from "./episode-data";

interface BuildCheckRequest {
  id: number;
  map: GameMap;
}
interface BuildCheckResult {
  id: number;
  problem: string | null;
  lumps: Lump[] | null;
  vanilla: CheckedIssue[];
}

const scope = self as unknown as Worker;

scope.addEventListener(
  "message",
  ({ data }: MessageEvent<BuildCheckRequest>) => {
    const result: BuildCheckResult = {
      id: data.id,
      ...buildAndCheck(data.map),
    };
    scope.postMessage(
      result,
      result.lumps
        ? [...new Set(result.lumps.map((lump) => lump.data.buffer))]
        : [],
    );
  },
);

export type { BuildCheckRequest, BuildCheckResult };
