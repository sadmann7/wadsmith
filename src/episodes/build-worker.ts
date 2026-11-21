import type { GameMap } from "../map/types";
import { buildProblem } from "./episode-data";

type BuildCheckRequest = { id: number; map: GameMap };
type BuildCheckResult = { id: number; problem: string | null };

self.addEventListener(
  "message",
  ({ data }: MessageEvent<BuildCheckRequest>) => {
    const result: BuildCheckResult = {
      id: data.id,
      problem: buildProblem(data.map),
    };
    self.postMessage(result);
  },
);

export type { BuildCheckRequest, BuildCheckResult };
