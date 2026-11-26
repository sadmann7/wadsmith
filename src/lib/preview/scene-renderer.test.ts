import { expect, it } from "vitest";

import { sceneRendererFrom } from "./scene-renderer";

it("draws with WebGL unless the column renderer was chosen", () => {
  expect(sceneRendererFrom(null)).toBe("webgl");
  expect(sceneRendererFrom("webgl")).toBe("webgl");
  expect(sceneRendererFrom("columns")).toBe("columns");
  expect(sceneRendererFrom("software")).toBe("webgl");
});
