import { createAgent } from "@ui-sdk/react/agent";

import { agentActionNames, argsListError } from "./agent-actions";
import { createAgentSession } from "./agent-session";
import { registerMapTools } from "./webmcp";

const mapActions = new Set(agentActionNames);
const pageCalls = new WeakSet<unknown[]>();

export const agentSession = createAgentSession();

// The page's own calls, like Quick build, are the person's. Every other step
// counts as an agent's and goes through the session, which shows it and asks
// before removals.
const bridge = createAgent({
  allow: (step, { signal }) => {
    if (step.component !== "map-editor" || !mapActions.has(step.action)) {
      return false;
    }
    return pageCalls.has(step.args) || agentSession.allow(step, signal);
  },
});

// A step's args that aren't a list fail in the bridge with a message about
// spreading, so they get a plain answer here.
export const agent: typeof bridge = {
  ...bridge,
  act: (input, options) => {
    const step = (input?.steps ?? []).findIndex(
      (item) => item?.args != null && !Array.isArray(item.args),
    );
    if (step < 0) return bridge.act(input, options);
    const { action, args } = input.steps[step];
    return Promise.resolve({
      ok: false,
      error: {
        step,
        message: `${argsListError(action, args)} No step ran.`,
      },
      steps: [],
      appeared: [],
      values: {},
    });
  },
};

// Runs a map action for the person at the keyboard.
export function actForPerson(action: string, args: unknown[]) {
  pageCalls.add(args);
  return agent.act({ steps: [{ ref: "Map", action, args }] });
}

// A hot reload runs this again, and the old tools hold the old session.
(window as { unregisterMapTools?: () => void }).unregisterMapTools?.();
const unregister = registerMapTools(agent);
Object.assign(window, { agent, unregisterMapTools: unregister });
