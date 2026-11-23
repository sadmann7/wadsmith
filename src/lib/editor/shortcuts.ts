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
  clearSelection: {
    keys: "",
    description: "Clear the selection, as Esc does too",
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
  flipWalls: {
    keys: "f",
    description: "Flip the selected walls to face the other way",
    area: "map",
  },
  swapSides: {
    keys: "shift+f",
    description: "Swap what the selected walls' two sides show",
    area: "map",
  },
  joinRooms: {
    keys: "j",
    description: "Join the selected rooms into one",
    area: "map",
  },
  makeDoor: {
    keys: "o",
    description: "Make the selected rooms doors, or rooms again",
    area: "map",
  },
  floorGradient: {
    keys: "shift+g",
    description:
      "Slope the floors of the selected rooms from the first to the last",
    area: "map",
  },
  ceilingGradient: {
    keys: "alt+shift+g",
    description: "Slope their ceilings",
    area: "map",
  },
  lightGradient: {
    keys: "alt+g",
    description: "Fade their light",
    area: "map",
  },
  placePrefab: {
    keys: "p",
    description: "Place the last prefab again at the pointer",
    area: "map",
  },
  fitSelection: {
    keys: "z",
    description: "Zoom to the selection, or to the whole map",
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
  switchView: {
    keys: "q",
    description: "Switch between the map and the 3D view",
  },
  play: { keys: "f9", description: "Play the map" },
  playHere: {
    keys: "mod+f9",
    description: "Play the map from where the 3D view stands",
  },
  help: { keys: "mod+/", description: "Show keyboard shortcuts" },
  sceneFly: {
    keys: "g",
    description:
      "Switch between walking, which stops at walls and climbs steps, and flying through them",
    area: "scene",
  },
  sceneLook: {
    keys: "z",
    description:
      "Look with the mouse until pressed again, and act on what the crosshair is over",
    area: "scene",
  },
  sceneNext: {
    keys: "n",
    description: "Select the next surface",
    area: "scene",
  },
  scenePrevious: {
    keys: "p",
    description: "Select the previous surface",
    area: "scene",
  },
  sceneOpen: {
    keys: "o",
    description: "Open or shut the door or lift under the pointer",
    area: "scene",
  },
  sceneFlood: {
    keys: "f",
    description: "Flood the copied texture along joined walls",
    area: "scene",
  },
  sceneAlignAlong: {
    keys: "shift+a",
    description: "Align the texture along the walls beside the one aimed at",
    area: "scene",
  },
  sceneAlignRows: {
    keys: "alt+a",
    description: "Line up the texture's rows on the walls beside it",
    area: "scene",
  },
  scenePegUpper: {
    keys: "u",
    description: "Peg the upper texture of the walls, or unpeg it",
    area: "scene",
  },
  scenePegLower: {
    keys: "l",
    description: "Peg the lower texture of the walls, or unpeg it",
    area: "scene",
  },
  sceneResetOffsets: {
    keys: "shift+r",
    description: "Reset the walls' texture offsets",
    area: "scene",
  },
  sceneFullbright: {
    keys: "b",
    description: "Show everything at full light, or as lit",
    area: "scene",
  },
  sceneThings: {
    keys: "t",
    description: "Show or hide things",
    area: "scene",
  },
} as const;

export type EditorShortcut = keyof typeof editorShortcuts;

export type ShortcutScope = "editor" | "map" | "scene";

// Map keys and 3D view keys never fire together, so each may reuse the
// other's, while an editor key works in both.
export function scopeOf(name: EditorShortcut): ShortcutScope {
  const entry = editorShortcuts[name];
  return "area" in entry ? entry.area : "editor";
}

export function getIsScopeShared(a: ShortcutScope, b: ShortcutScope) {
  return a === b || a === "editor" || b === "editor";
}
