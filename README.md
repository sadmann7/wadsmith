# Wadsmith

A Doom map editor for the browser, built with [Next.js](https://nextjs.org), [Tailwind CSS](https://tailwindcss.com) and [UI SDK](https://github.com/vercel-labs/ui). Draw rooms from above, walk them in a live preview, then press Play to fight in the real engine.

## Setup

You need Node, pnpm, [Emscripten](https://emscripten.org), git, curl and unzip.

```bash
pnpm install
pnpm setup:engine
pnpm dev
```

`setup:engine` compiles a pinned commit of [Woof](https://github.com/fabiangreffrath/woof) to WebAssembly with the changes in `engine/woof.patch`, and downloads a checksummed [Freedoom](https://freedoom.github.io/) release into `public/engine`.

Co-op rooms run on a Cloudflare Worker in `rooms/`. Copy `.env.example` to `.env`, then run `pnpm dev:coop` to start it next to the app and play across browsers or Chrome profiles. Without `NEXT_PUBLIC_ROOMS_URL`, co-op works between tabs of one browser. Players connect directly over WebRTC when their networks allow it, and through the room otherwise.

Set `NEXT_PUBLIC_SITE_URL` to the full public URL, including `https://`, when deploying outside Vercel, so social previews use the right image URLs.

Maps save per browser address. The dev server now uses `localhost:3000`, so a map saved on the old `localhost:5173` address appears only with `pnpm dev -p 5173`, where you can save it to a file.

## Using it

- **Select:** drag corners and things, click a room to edit it, and drag empty space to pan.
- **Draw room:** click corners, then click the first corner or press Enter. The **Shape** menu in the status bar draws a rectangle from two opposite corners, or a polygon of 3 to 24 sides from its middle and one corner. A room drawn against or across a wall shares corners with it, so the two connect. A label by the pointer shows the length and angle of the wall being drawn.
- **Rooms inside rooms:** draw a room inside another for a platform, a pit or an island. Choose **Make pillar** on it to turn it into solid wall, and right-click a pillar to make it a room again or delete it. A wall of an inner room can stay solid towards the room around it from the line's **Flags**.
- **Walls:** right-click a wall and choose **Add corner here** to split it. Drop a corner onto another to join them, and drag a wall in line mode to move both of its corners. A selected wall shows its length and angle, and a dashed line to each room it acts on or the spot its teleporter lands on. A selected room shows the lines that act on it.
- **Lines:** choose **Draw line** and click points inside a room, then click the last one again or press Enter. A line has the room on both sides, so it can hold a see-through middle texture or a walk-over action. Right-click it to delete it.
- **Grid:** the grid menu in the status bar picks a size from 1 to 64 and turns snapping off. Press [ and ] to halve or double it and G to toggle snapping.
- **Your own game:** drop doom.wad, doom2.wad, plutonia.wad or tnt.wad onto the page, or choose **Use your own IWAD** on the featured maps page, and the editor, the texture catalog and the game use it instead of Freedoom. The file stays in your browser. With Doom's own IWAD, episodes play as E1M1 to E4M9 and the checks flag Doom II's monsters and items.
- **Your own textures:** choose **Add textures** in the texture picker, or **Textures** on the featured maps page, and pick a texture WAD or images. An image becomes a wall texture named after its file, matched to the game's palette, and one of 64 by 64 is a flat as well. They show up under **Custom**, and importing a WAD that brings its own textures keeps them. A built WAD carries only the ones its maps use. When a resource repaints some frames of an animated floor, the WAD also carries the game's other frames of it, which the engine needs beside them.
- **Level info:** **Map settings** also picks a map's music and sky from the game's own and takes the text shown after it. Episodes write them, with each map's name and par time, into a UMAPINFO lump that Woof reads.
- **Compatibility:** **Map settings** picks the engine the map is made for: Vanilla, Boom, MBF or MBF21. From Boom up, a line's action menu offers Boom floors, ceilings, doors, locked doors, lifts, stairs and crushers built from their own fields, and a room's behaviour adds damage, secret, friction and wind, with MBF21's kill modes above that. A line or room can still take a raw special number for anything else, and the checks flag numbers and flags past the map's level.
- **Place:** pick a thing and click inside a room.
- **Switch:** click a solid wall to add a switch, then drag from it to a door.
- **Doors:** draw a thin room between two rooms and turn on **Door** in the inspector. It can open with the use key or a switch, and close again or stay open. Each line into the door can keep the door shut on its side, open it its own way or wear its own face, and **Use on the whole door** paints every face again.
- **Edit modes:** press V, L, S or T to work with vertices, lines, sectors or things.
- **Select:** Shift-click adds a corner, a thing or a whole room to the selection, and Shift-drag selects every corner and thing in a box. In sector mode, drag a selected room to move everything selected with it.
- **Copy and paste:** copy, cut and paste the selected rooms and things with the usual keys, or from the right-click menu. A paste lands at the pointer, in this map or one in another tab, and a room keeps the rooms drawn inside it, the things standing in it and its switches. Duplicate puts a copy beside the original.
- **Transform:** press R or Shift+R to turn the selection a quarter, Shift+H or Shift+V to flip it, or choose **Transform** in the right-click menu to resize it or turn it by any angle. The result lands on the grid.
- **Textures:** right-click a wall and open **Texture** to carry its texture on unbroken along the room's walls, to pick it up and apply it to other walls or a whole room, or to replace it with another everywhere in the map. A room's menu replaces its floor, ceiling or wall texture everywhere the same way.
- **Several rooms:** with more than one room selected, the inspector edits their heights, light and textures together, and shows Mixed where they differ.
- **Prefabs:** choose **Prefabs** in the right-click menu to save the selection under a name and place it again in any map.
- **Views:** switch between **Map**, **Split** and **3D**. Drag the divider, or press M to maximize the view under the pointer and return to Split. In Map view, the player view stays docked in the corner.
- **Camera:** drag the camera marker on the map, double-click the map or press C to move the 3D view, and use **Find camera** to center the map on it.
- **3D:** the view draws the sky where a ceiling wears the sky flat, see-through middle textures on open lines, and texture offsets and pegging as the game does. Press O over a door or a lift to see it open or lowered, and again to shut it. Drag a wall to move its texture, holding Shift to carry it along the walls beside it, and turn the mouse wheel over a floor or ceiling to raise or lower it, or with Shift to change its room's brightness. Copy a surface's look with the copy key and paste it on another, paint it on with Alt and a click, or press F to flood it along the joined walls that share the old texture. Shift-click picks several surfaces, and the inspector then spreads a height or a brightness evenly from the first to the last. Click a floor, ceiling, wall, door, switch or thing to select it. Drag floors and ceilings to change height, or pick a texture in the side panel. Choose **Place** to put the chosen thing on a floor, and drag things to move them. Walk with WASD, step through surfaces with N and P, nudge heights with Page Up and Page Down, and nudge a selected thing with Alt and the arrow keys.
- **Co-op:** place a Player 2 start, and Player 3 and 4 starts for more players, then press **Co-op** and send the invite link. Guests join from the link without the map, and the host presses Start once everyone is in.
- **Play:** builds a WAD and opens it full size in vanilla Doom mode at 60 frames a second, with sound effects, music and a volume control. Click the game to capture the mouse, then move it to turn and click to fire. Move with WASD, turn with the arrow keys, fire with Space and use with E. Esc releases the mouse and pauses, and a second Esc returns to the editor.
- **Playtest results:** back in the editor, the map shows where each player walked, took damage, died and picked things up, in the player's color in a co-op game, and the side panel lists the time to the exit, the kills, secrets and items found, and a par to aim for. Hide the layer or clear it from that panel. **Play from here** in the 3D view starts the game where the camera stands, and a note left with N keeps how far into the run it was.

Your map saves in this browser as you edit. Use **File** to start a new map, save a map file, open one again, or download a WAD.

## Agents

An agent can build a whole map. Its actions cover rooms, pillars, doors, corners, lines and their actions, flags and sides, textures, things with their flags, switches and notes. Read actions describe the map, list its rooms and things, and return its errors, warnings and balance. An edit that would break the map is refused and changes nothing, a problem with a known fix is fixed on the way, and each edit answers with what the map still needs.

- **In the page:** `window.agent` is the UI SDK agent bridge. `agent.snapshot()` lists the Map component's actions, and `agent.act({ steps: [{ ref: "Map", action: "help" }] })` returns each one with what it takes.
- **Outside the page:** the `wadsmith` MCP server offers the same actions as tools, with `newMap`, `openMap`, `saveMap` and `exportWad` for files. Once `pnpm setup:engine` has run, it checks texture names against Freedoom's. Claude Code picks it up from `.mcp.json`. For another client, run `node --experimental-transform-types scripts/wadsmith-mcp.mjs`, and add `--map file.json` to open that file and save it after every edit.

To build a map from a sentence, open the repo in Claude Code and ask for one:

```text
Use the wadsmith tools to build a small techbase: a start room, a locked
blue door with its key behind a lift, an arena with six imps, and an exit
switch. Check the map, then save it as maps/techbase.json and export
maps/techbase.wad.
```

Open the saved file with **File**, then **Open**, or play the WAD in any Doom engine.

## License

Wadsmith is GPL-2.0-or-later, the same license as Woof, with the text in `LICENSE`. `engine/woof.patch` holds every change to Woof, and the compiled engine is a build of Woof with that patch.

Woof is GPL-2.0-or-later and Freedoom is BSD-licensed. Neither is committed here. `setup:engine` writes their licenses to `public/engine`, and `public/engine/licenses` holds the notices for everything else linked into the engine, including SDL3, Emscripten's runtime, musl, miniz, spng, yyjson and Nuked OPL3. Anything that distributes Wadsmith or the compiled engine has to meet the GPL's terms, including offering the matching source: this repository, the pinned Woof commit and `engine/woof.patch`.
