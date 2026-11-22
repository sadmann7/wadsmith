import type { createAgent } from "@ui-sdk/react/agent";

import {
  agentActions,
  agentInputSchema,
  getIsAgentAskFirst,
} from "./agent-actions";

interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: object;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
    consequentialHint: boolean;
  };
  execute: (
    input: Record<string, unknown> | undefined,
    context?: { signal?: AbortSignal },
  ) => Promise<string>;
}

interface ModelContext {
  registerTool: (
    tool: ModelContextTool,
    options: { signal: AbortSignal },
  ) => Promise<void>;
}

// Each map action becomes its own WebMCP tool, so a browser's agent calls
// addRoom or placeThing directly and gets back only what the action reports,
// not the page's components or the whole map.
export function registerMapTools(agent: ReturnType<typeof createAgent>) {
  const modelContext = (document as Document & { modelContext?: ModelContext })
    .modelContext;
  const controller = new AbortController();
  if (typeof modelContext?.registerTool !== "function") {
    return () => controller.abort();
  }
  for (const action of agentActions) {
    if (action.name === "help") continue;
    const tool: ModelContextTool = {
      name: action.name,
      description: action.description,
      inputSchema: agentInputSchema(action.params),
      annotations: {
        readOnlyHint: Boolean(action.reads),
        // Room names, notes and texture names come from whoever made the map.
        untrustedContentHint: true,
        consequentialHint: getIsAgentAskFirst(action.name),
      },
      execute: async (input = {}, context = {}) => {
        if (context.signal?.aborted) {
          throw new Error(`${action.name} was cancelled.`);
        }
        const names = action.params.map((param) => param.name);
        const unknown = Object.keys(input).find((key) => !names.includes(key));
        if (unknown) {
          throw new Error(
            `${action.name} takes no "${unknown}". It takes: ${names.join(", ") || "nothing"}.`,
          );
        }
        const outcome = await agent.act(
          {
            steps: [
              {
                ref: "Map",
                action: action.name,
                args: names.map((name) => input[name]),
              },
            ],
          },
          { signal: context.signal },
        );
        if (!outcome.ok) {
          const failure =
            typeof outcome.error === "string"
              ? outcome.error
              : outcome.error?.message;
          throw new Error(
            failure?.startsWith("The app refused")
              ? `The person didn't allow ${action.name}, or stopped the agent. Ask them before trying again.`
              : (failure ?? `${action.name} failed.`),
          );
        }
        return JSON.stringify(outcome.steps[0]?.result ?? null);
      },
    };
    modelContext
      .registerTool(tool, { signal: controller.signal })
      .catch(() => {});
  }
  return () => controller.abort();
}
