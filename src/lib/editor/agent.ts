import { createAgent, registerTools } from "@ui-sdk/react/agent";

import { agentActionNames } from "./agent-actions";
import { createAgentSession } from "./agent-session";

const mapActions = new Set(agentActionNames);

export const agent = createAgent({
  allow: ({ component, action }) =>
    component === "map-editor" && mapActions.has(action),
});

export const agentSession = createAgentSession();

// A browser with WebMCP lets its own agent call the bridge. Its steps go
// through the session, which shows them and asks before anything is removed.
registerTools(agent, {
  allow: (step, { signal }) => agentSession.allow(step, signal),
});

Object.assign(window, { agent });
