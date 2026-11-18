import { createAgent } from "@ui-sdk/react/agent";

const mapActions = new Set([
  "addConnectedRoom",
  "setRoomHeights",
  "placeThing",
  "makeDoor",
  "addDoorSwitch",
]);

const agent = createAgent({
  allow: ({ component, action }) =>
    component === "map-editor" && mapActions.has(action),
});

Object.assign(window, { agent });

export { agent };
