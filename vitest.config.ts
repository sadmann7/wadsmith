import { availableParallelism } from "node:os";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: [
      "src/**/*.test.{ts,tsx}",
      "scripts/**/*.test.mjs",
      "rooms/src/**/*.test.ts",
    ],
    // Engine tests mostly wait on game time, so they can outnumber the cores.
    maxWorkers: availableParallelism() + 2,
  },
});
