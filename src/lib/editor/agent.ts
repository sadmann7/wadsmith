import { createAgent } from "@ui-sdk/react/agent";

import { agentActionNames } from "./agent-actions";

const mapActions = new Set(agentActionNames);

export const agent = createAgent({
  allow: ({ component, action }) =>
    component === "map-editor" && mapActions.has(action),
});

Object.assign(window, { agent });
