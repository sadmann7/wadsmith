// @vitest-environment happy-dom
import { createAgent } from "@ui-sdk/core/agent";
import { mount } from "@ui-sdk/core/testing";
import { afterEach, expect, it } from "vitest";

import { testMap } from "@/lib/map/test-map";

import { mapEditor } from "./map-editor";

let unmount = () => {};

afterEach(() => unmount());

it("keeps the Map ref once a room shows its name", async () => {
  const [room] = testMap.sectors;
  const mounted = mount(
    mapEditor,
    { map: testMap },
    `<root aria-label="Map"><caption value="${room.id}" corners="${room.vertices.join(",")}">${room.name}</caption></root>`,
  );
  unmount = mounted.unmount;
  const agent = createAgent();
  expect(agent.snapshot()).toMatchObject([
    { component: "map-editor", label: "Map" },
  ]);
  const outcome = await agent.act({
    steps: [{ ref: "Map", action: "listRooms", args: [] }],
  });
  expect(outcome.ok).toBe(true);
});
