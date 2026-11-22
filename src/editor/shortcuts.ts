const editorShortcuts = {
  vertices: { keys: "v", description: "Edit vertices", area: "map" },
  lines: { keys: "l", description: "Edit lines", area: "map" },
  sectors: { keys: "s", description: "Edit sectors", area: "map" },
  things: { keys: "t", description: "Edit things", area: "map" },
  draw: { keys: "d", description: "Draw a room", area: "map" },
  drawLine: { keys: "shift+d", description: "Draw a line", area: "map" },
  gridSmaller: { keys: "[", description: "Halve the grid", area: "map" },
  gridLarger: { keys: "]", description: "Double the grid", area: "map" },
  snap: { keys: "g", description: "Snap to the grid, on or off", area: "map" },
  undo: { keys: "mod+z", description: "Undo" },
  redo: { keys: "mod+shift+z", description: "Redo" },
  duplicate: { keys: "mod+d", description: "Duplicate the selected things" },
  pane: {
    keys: "m",
    description: "Maximise the pane under the pointer, or split again",
  },
  look: { keys: "c", description: "Point the 3D camera at the pointer" },
  help: { keys: "mod+/", description: "Show keyboard shortcuts" },
} as const;

type EditorShortcut = keyof typeof editorShortcuts;

export { editorShortcuts, type EditorShortcut };
