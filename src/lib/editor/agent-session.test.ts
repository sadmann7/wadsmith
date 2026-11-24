import type { AgentAction } from "@ui-sdk/react/agent";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defined } from "@/lib/defined";
import { updateThing } from "@/lib/map/edit";
import { testMap } from "@/lib/map/test-map";

import { createAgentSession, getAgentStepsOnMap } from "./agent-session";
import { createEditHistory } from "./edit-history";

const step = (action: string, args: unknown[] = []): AgentAction => ({
  ref: "c1",
  component: "map-editor",
  action,
  args,
});

const summary = (args: unknown[]) => ({
  label: `Step ${String(args[0])}`,
  at: { x: 1, y: 2 },
});

describe("an agent session", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("counts calls close together as one request", () => {
    const session = createAgentSession({ busyMs: 2000, requestGapMs: 10_000 });
    expect(session.allow(step("addRoom", ["a"]))).toBe(true);
    expect(session.currentRequest()).toBe(1);
    expect(session.record("addRoom", [], summary)).toBe(true);
    vi.advanceTimersByTime(1500);
    void session.allow(step("placeThing", ["b"]));
    session.record("placeThing", ["Light it."], summary);
    const { request, status } = session.getSnapshot();
    expect(status).toBe("working");
    expect(request).toMatchObject({
      id: 1,
      steps: [{ label: "Step a" }, { label: "Step b" }],
      todo: ["Light it."],
      at: { x: 1, y: 2 },
    });
  });

  it("starts a new request after a long pause or the person's edit", () => {
    const session = createAgentSession({ busyMs: 2000, requestGapMs: 10_000 });
    void session.allow(step("addRoom"));
    session.record("addRoom", [], summary);
    vi.advanceTimersByTime(5000);
    expect(session.getSnapshot().status).toBe("idle");
    void session.allow(step("addRoom"));
    expect(session.getSnapshot().request?.id).toBe(1);
    vi.advanceTimersByTime(11_000);
    void session.allow(step("addRoom"));
    expect(session.getSnapshot().request).toMatchObject({ id: 2, steps: [] });
    session.endRequest();
    void session.allow(step("addRoom"));
    expect(session.getSnapshot().request?.id).toBe(3);
  });

  it("leaves edits it didn't allow off the trail", () => {
    const session = createAgentSession();
    expect(session.record("placeThing", [], summary)).toBe(false);
    void session.allow(step("describeMap"));
    expect(session.currentRequest()).toBeNull();
    expect(session.record("describeMap", [], summary)).toBe(false);
  });

  it("asks before taking something away", async () => {
    const session = createAgentSession();
    const asked = session.allow(step("removeRoom", ["Arena"]));
    expect(session.getSnapshot()).toMatchObject({
      status: "asking",
      question: { action: "removeRoom", args: ["Arena"] },
    });
    session.answer(true);
    await expect(asked).resolves.toBe(true);
    expect(session.getSnapshot().question).toBeNull();
    expect(session.currentRequest()).toBe(1);

    const refused = session.allow(step("removeThing", ["imp-1"]));
    session.answer(false);
    await expect(refused).resolves.toBe(false);
    expect(session.currentRequest()).toBeNull();
  });

  it("stops asking once removals are allowed until reload", async () => {
    const session = createAgentSession();
    const asked = session.allow(step("removeRoom"));
    session.answer(true, { always: true });
    await asked;
    expect(session.allow(step("removeThing"))).toBe(true);
  });

  it("gives up a question when the call is cancelled", async () => {
    const session = createAgentSession();
    const controller = new AbortController();
    const asked = session.allow(step("removeRoom"), controller.signal);
    controller.abort();
    await expect(asked).resolves.toBe(false);
    expect(session.getSnapshot().status).toBe("idle");
  });

  it("refuses the rest of a stopped request until its card closes", async () => {
    const session = createAgentSession({ busyMs: 2000, requestGapMs: 10_000 });
    void session.allow(step("addRoom"));
    const asked = session.allow(step("removeRoom"));
    session.stop();
    await expect(asked).resolves.toBe(false);
    expect(session.allow(step("addRoom"))).toBe(false);
    vi.advanceTimersByTime(20_000);
    expect(session.allow(step("addRoom"))).toBe(false);
    session.dismiss();
    expect(session.allow(step("addRoom"))).toBe(true);
    expect(session.getSnapshot().request?.stopped).toBe(false);
  });

  it("asks before a line special clears a wall's action", async () => {
    const session = createAgentSession();
    expect(session.allow(step("setLineSpecial", ["v1|v2", 11]))).toBe(true);
    for (const special of [-1, 0.4]) {
      const early = session.allow(step("setLineSpecial", ["v1|v2", special]));
      session.answer(false);
      await expect(early).resolves.toBe(false);
    }
    const asked = session.allow(step("setLineSpecial", ["v1|v2", 0]));
    expect(session.getSnapshot().status).toBe("asking");
    session.answer(false);
    await expect(asked).resolves.toBe(false);
  });

  it("closes the card only once the agent is idle", () => {
    const session = createAgentSession({ busyMs: 2000, requestGapMs: 10_000 });
    void session.allow(step("addRoom"));
    session.dismiss();
    expect(session.getSnapshot().request).not.toBeNull();
    vi.advanceTimersByTime(2500);
    session.dismiss();
    expect(session.getSnapshot().request).toBeNull();
  });

  it("lists only the edits still on the map after undo, redo and a new edit", () => {
    const session = createAgentSession({ busyMs: 2000, requestGapMs: 10_000 });
    const history = createEditHistory({ limit: 10, groupDelay: 500 });
    let map = testMap;
    const edit = (x: number) => {
      void session.allow(step("updateThing", [x]));
      const next = updateThing(map, "imp-1", { x });
      const id = history.record(map, next, { batch: "agent-1" });
      session.record("updateThing", [], summary, id);
      map = next;
    };
    const labels = () =>
      getAgentStepsOnMap(
        defined(session.getSnapshot().request).steps,
        history.getDoneIds(),
      ).map((item) => item.label);

    edit(10);
    edit(20);
    edit(30);
    map = defined(history.undo(map));
    map = defined(history.undo(map));
    expect(labels()).toEqual(["Step 10"]);
    map = defined(history.redo(map));
    expect(labels()).toEqual(["Step 10", "Step 20"]);
    edit(40);
    expect(labels()).toEqual(["Step 10", "Step 20", "Step 40"]);
    map = defined(history.undo(map));
    edit(50);
    expect(labels()).toEqual(["Step 10", "Step 20", "Step 50"]);

    map = defined(history.undoBatch("agent-1", map));
    expect(map).toEqual(testMap);
    expect(labels()).toEqual([]);
  });

  it("leaves a step whose edit changed nothing off the list", () => {
    const session = createAgentSession();
    void session.allow(step("updateThing", [1]));
    session.record("updateThing", [], summary);
    const { steps } = defined(session.getSnapshot().request);
    expect(getAgentStepsOnMap(steps, new Set([1]))).toEqual([]);
  });
});
