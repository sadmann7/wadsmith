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

it("renames the map through onRename, or says where to rename it", async () => {
  const renamed: string[] = [];
  const mounted = mount(
    mapEditor,
    { map: testMap, onRename: (name: string) => renamed.push(name) },
    `<root aria-label="Map"></root>`,
  );
  unmount = mounted.unmount;
  const agent = createAgent();
  const outcome = await agent.act({
    steps: [
      { ref: "Map", action: "setMapDetails", args: [{ name: " Vault " }] },
    ],
  });
  expect(outcome.ok).toBe(true);
  expect(renamed).toEqual(["Vault"]);
  const empty = await agent.act({
    steps: [{ ref: "Map", action: "setMapDetails", args: [{ name: "  " }] }],
  });
  expect(empty.error?.message).toBe("A map's name can't be empty.");
  unmount();

  const bare = mount(
    mapEditor,
    { map: testMap },
    `<root aria-label="Map"></root>`,
  );
  unmount = bare.unmount;
  const refused = await createAgent().act({
    steps: [{ ref: "Map", action: "setMapDetails", args: [{ name: "Vault" }] }],
  });
  expect(refused.error?.message).toMatch(/Map settings/);
});
