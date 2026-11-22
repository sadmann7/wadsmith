import { describe, expect, it } from "vitest";

import { sectorAt } from "@/lib/map/geometry";
import { testMap } from "@/lib/map/test-map";

import {
  agentRisk,
  agentStepSummary,
  getIsAgentAskFirst,
  getIsAgentRead,
  runAgentAction,
} from "./agent-actions";

describe("reviewing an agent's steps", () => {
  it("says what removing a room takes with it", () => {
    const inside = testMap.things.filter(
      (thing) => sectorAt(testMap, thing)?.id === "sector-1",
    ).length;
    const risk = agentRisk(testMap, "removeRoom", ["Start room"]);
    expect(risk.title).toBe("Remove Start room?");
    expect(risk.detail).toMatch(/^Its switch and /);
    expect(risk.detail).toContain(`${inside} thing`);
    expect(risk.confirm).toBe("Remove Start room");
  });

  it("counts the surfaces a texture swap changes", () => {
    const texture = testMap.sectors[0].floorTexture;
    const risk = agentRisk(testMap, "replaceTexture", [
      texture,
      "FLAT1",
      "flat",
    ]);
    expect(risk.title).toBe(`Replace ${texture} with FLAT1?`);
    expect(risk.detail).toMatch(/^\d+ surfaces? change\./);
  });

  it("still asks when the step names something missing", () => {
    expect(agentRisk(testMap, "removeRoom", ["Nowhere"]).title).toBe(
      "Let the agent run remove room?",
    );
  });

  it("names where a step worked", () => {
    expect(
      agentStepSummary(testMap, "updateRoom", ["Arena"], null),
    ).toMatchObject({
      label: "Update room · Arena",
      at: expect.objectContaining({ x: expect.any(Number) }),
    });
    expect(agentStepSummary(testMap, "updateThing", [], "imp-1")).toEqual({
      label: "Update thing · Imp",
      at: { x: 832, y: 64 },
    });
    expect(agentStepSummary(testMap, "checkMap", [], null)).toEqual({
      label: "Check map",
      at: null,
    });
  });

  it("knows reads from edits and which edits ask first", () => {
    expect(getIsAgentRead("describeMap")).toBe(true);
    expect(getIsAgentRead("addRoom")).toBe(false);
    expect(getIsAgentAskFirst("removeRoom")).toBe(true);
    expect(getIsAgentAskFirst("addRoom")).toBe(false);
  });
});

describe("placing things for an agent", () => {
  it("keeps things placed in one room apart", () => {
    let map = testMap;
    const placed: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const outcome = runAgentAction(map, "placeThing", ["imp", "Arena"]);
      map = outcome.map;
      placed.push(String(outcome.result));
    }
    const spots = placed.map((id) => {
      const thing = map.things.find((item) => item.id === id);
      return `${thing?.x},${thing?.y}`;
    });
    expect(new Set(spots).size).toBe(4);
    for (const id of placed) {
      const thing = map.things.find((item) => item.id === id);
      expect(thing && sectorAt(map, thing)?.id).toBe("sector-3");
    }
  });

  it("keeps big monsters clear of each other and the walls", () => {
    let map = testMap;
    const placed: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const outcome = runAgentAction(map, "placeThing", ["demon", "Arena"]);
      map = outcome.map;
      placed.push(String(outcome.result));
    }
    const [first, second] = placed.map((id) =>
      map.things.find((thing) => thing.id === id),
    );
    expect(first && second).toBeTruthy();
    if (!first || !second) return;
    expect(
      Math.max(Math.abs(first.x - second.x), Math.abs(first.y - second.y)),
    ).toBeGreaterThanOrEqual(60);
    for (const thing of [first, second]) {
      for (const [dx, dy] of [
        [-30, -30],
        [30, 30],
      ]) {
        expect(sectorAt(map, { x: thing.x + dx, y: thing.y + dy })?.id).toBe(
          "sector-3",
        );
      }
    }
  });

  it("says so when a room has no space left", () => {
    expect(() =>
      runAgentAction(testMap, "placeThing", ["mancubus", "Arena door"]),
    ).toThrow(/No room left in Arena door/);
  });
});
