# Wadsmith

A Doom map editor for the browser, built with [UI SDK](https://github.com/vercel-labs/ui). Draw rooms from above, walk them in a live preview, then press Play to fight in the real engine.

## Setup

You need Node, pnpm, [Emscripten](https://emscripten.org), autoconf, automake and pkg-config.

```bash
pnpm install
pnpm setup:engine
pnpm dev
```

`setup:engine` compiles [Chocolate Doom](https://www.chocolate-doom.org) from [cloudflare/doom-wasm](https://github.com/cloudflare/doom-wasm) to WebAssembly and downloads [Freedoom](https://freedoom.github.io/) into `public/engine`.

## Using it

- **Select:** drag corners and things, click a room to edit it, and drag empty space to pan.
- **Draw room:** click corners, then click the first corner or press Enter. Reuse another room's corners to connect the two.
- **Place:** pick a thing and click inside a room.
- **Switch:** click a solid wall to add a switch, then drag from it to a door.
- **Doors:** draw a thin room between two rooms and turn on **Door** in the inspector. It can open with the use key or a switch, and close again or stay open.
- **Views:** switch between **Map**, **Split** and **3D**. Drag the divider, or press M to maximize the view under the pointer and return to Split.
- **Camera:** drag the camera marker on the map, double-click the map or press L to move the 3D view, and use **Find camera** to center the map on it.
- **3D:** click a floor, ceiling, wall, door, switch or thing to select it. Drag floors and ceilings to change height, or pick a texture in the side panel. Choose **Place** to put the chosen thing on a floor, and drag things to move them. Walk with WASD, step through surfaces with N and P, nudge heights with Page Up and Page Down, and nudge a selected thing with Alt and the arrow keys.
- **Play:** builds a WAD and opens it full size, with sound effects, music and a volume control. Move with WASD, turn with the arrow keys, fire with Space and use with E.

Your map saves in this browser as you edit. Use **File** to start a new map, save a map file, open one again, or download a WAD.

`window.agent` exposes the UI SDK agent bridge, with `addConnectedRoom`, `setRoomHeights`, `placeThing`, `makeDoor` and `addDoorSwitch` on the Map component.

## License

The engine is GPL-2.0 and Freedoom is BSD-licensed. Neither is committed here. Anything that distributes the compiled engine has to meet the GPL's terms.
