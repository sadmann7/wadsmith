import { afterEach, describe, expect, it, vi } from "vitest";

import { agentActionNames } from "./agent-actions";
import { registerMapTools } from "./webmcp";

interface Tool {
  name: string;
  annotations: Record<string, boolean>;
  execute: (
    input?: Record<string, unknown>,
    context?: { signal?: AbortSignal },
  ) => Promise<string>;
}

describe("the map's WebMCP tools", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers each map action as its own tool with the right hints", () => {
    const { tools } = setUp(() => Promise.resolve({ ok: true, steps: [] }));
    expect([...tools.keys()]).toEqual(
      agentActionNames.filter((name) => name !== "help"),
    );
    expect(tools.get("describeMap")?.annotations).toMatchObject({
      readOnlyHint: true,
      consequentialHint: false,
    });
    expect(tools.get("removeRoom")?.annotations).toMatchObject({
      readOnlyHint: false,
      consequentialHint: true,
    });
  });

  it("answers with only what the action reported", async () => {
    const { tools, act } = setUp(() =>
      Promise.resolve({
        ok: true,
        steps: [{ result: { result: "imp-2", fixed: [], todo: [] } }],
        values: { huge: "the whole map" },
      }),
    );
    const answer = await tools
      .get("placeThing")
      ?.execute({ room: "Arena", kind: "imp" });
    expect(JSON.parse(answer ?? "")).toEqual({
      result: "imp-2",
      fixed: [],
      todo: [],
    });
    const [request] = act.mock.calls[0] as [
      { steps: { action: string; args: unknown[] }[] },
    ];
    expect(request.steps[0].action).toBe("placeThing");
    expect(request.steps[0].args.slice(0, 2)).toEqual(["imp", "Arena"]);
  });

  it("names a key the tool doesn't take", async () => {
    const { tools, act } = setUp(() => Promise.resolve({ ok: true }));
    await expect(
      tools.get("removeRoom")?.execute({ room: "Arena", why: "tidy" }),
    ).rejects.toThrow('removeRoom takes no "why". It takes: room.');
    expect(act).not.toHaveBeenCalled();
  });

  it("fails with the action's own message", async () => {
    const { tools } = setUp(() =>
      Promise.resolve({ ok: false, error: { step: 0, message: "No room." } }),
    );
    await expect(tools.get("placeThing")?.execute({})).rejects.toThrow(
      "No room.",
    );
  });

  it("says when the person didn't allow a step", async () => {
    const { tools } = setUp(() =>
      Promise.resolve({
        ok: false,
        error: { step: 0, message: "The app refused removeRoom on c18." },
      }),
    );
    await expect(
      tools.get("removeRoom")?.execute({ room: "Arena" }),
    ).rejects.toThrow(/didn't allow removeRoom/);
  });

  it("does nothing once the call is cancelled", async () => {
    const { tools, act } = setUp(() => Promise.resolve({ ok: true }));
    const controller = new AbortController();
    controller.abort();
    await expect(
      tools.get("addRoom")?.execute({}, { signal: controller.signal }),
    ).rejects.toThrow("addRoom was cancelled.");
    expect(act).not.toHaveBeenCalled();
  });
});

function setUp(respond: (request: unknown) => Promise<unknown>) {
  const tools = new Map<string, Tool>();
  vi.stubGlobal("document", {
    modelContext: {
      registerTool: (tool: Tool) => {
        tools.set(tool.name, tool);
        return Promise.resolve();
      },
    },
  });
  const act = vi.fn(respond);
  registerMapTools({ act } as unknown as Parameters<
    typeof registerMapTools
  >[0]);
  return { tools, act };
}
