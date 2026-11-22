export const editorShortcuts = {
  vertices: { keys: "v", description: "Edit vertices", area: "map" },
  lines: { keys: "l", description: "Edit lines", area: "map" },
  sectors: { keys: "s", description: "Edit sectors", area: "map" },
  things: { keys: "t", description: "Edit things", area: "map" },
  draw: { keys: "d", description: "Draw a room", area: "map" },
  drawLine: {
    keys: "shift+d",
    description: "Draw a line, or split a room from wall to wall",
    area: "map",
  },
  gridSmaller: { keys: "[", description: "Halve the grid", area: "map" },
  gridLarger: { keys: "]", description: "Double the grid", area: "map" },
  snap: { keys: "g", description: "Snap to the grid, on or off", area: "map" },
  selectAll: {
    keys: "mod+a",
    description: "Select everything the mode works on",
    area: "map",
  },
  invertSelection: {
    keys: "mod+i",
    description: "Swap what is selected for what isn't",
    area: "map",
  },
  find: {
    keys: "mod+shift+f",
    description: "Find and select by texture, tag, action or thing type",
  },
  undo: { keys: "mod+z", description: "Undo" },
  redo: { keys: "mod+shift+z", description: "Redo" },
  duplicate: { keys: "mod+d", description: "Duplicate the selection" },
  rotateRight: {
    keys: "r",
    description: "Turn the selection a quarter to the right",
    area: "map",
  },
  rotateLeft: {
    keys: "shift+r",
    description: "Turn the selection a quarter to the left",
    area: "map",
  },
  flipAcross: {
    keys: "shift+h",
    description: "Flip the selection left to right",
    area: "map",
  },
  joinRooms: {
    keys: "j",
    description: "Join the selected rooms into one",
    area: "map",
  },
  flipOver: {
    keys: "shift+v",
    description: "Flip the selection top to bottom",
    area: "map",
  },
  pane: {
    keys: "m",
    description: "Maximise the pane under the pointer, or split again",
  },
  look: { keys: "c", description: "Point the 3D camera at the pointer" },
  help: { keys: "mod+/", description: "Show keyboard shortcuts" },
} as const;

export type EditorShortcut = keyof typeof editorShortcuts;
