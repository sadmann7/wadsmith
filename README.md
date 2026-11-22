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
- **Draw room:** click corners, then click the first corner or press Enter. Reuse another room's corners to connect the two.
- **Rooms inside rooms:** draw a room inside another for a platform, a pit or an island. Choose **Make pillar** on it to turn it into solid wall, and right-click a pillar to make it a room again or delete it. A wall of an inner room can stay solid towards the room around it from the line's **Flags**.
- **Walls:** right-click a wall and choose **Add corner here** to split it. Drop a corner onto another to join them, and drag a wall in line mode to move both of its corners.
- **Lines:** choose **Draw line** and click points inside a room, then click the last one again or press Enter. A line has the room on both sides, so it can hold a see-through middle texture or a walk-over action. Right-click it to delete it.
- **Grid:** the grid menu in the status bar picks a size from 1 to 64 and turns snapping off. Press [ and ] to halve or double it and G to toggle snapping.
- **Your own game:** drop doom.wad, doom2.wad, plutonia.wad or tnt.wad onto the page, or choose **Use your own IWAD** on the featured maps page, and the editor, the texture catalog and the game use it instead of Freedoom. The file stays in your browser. With Doom's own IWAD, episodes play as E1M1 to E4M9 and the checks flag Doom II's monsters and items.
- **Level info:** **Map settings** also picks a map's music and sky from the game's own and takes the text shown after it. Episodes write them, with each map's name and par time, into a UMAPINFO lump that Woof reads.
- **Compatibility:** **Map settings** picks the engine the map is made for: Vanilla, Boom, MBF or MBF21. From Boom up, a line's action menu offers Boom floors, ceilings, doors, locked doors, lifts, stairs and crushers built from their own fields, and a room's behaviour adds damage, secret, friction and wind, with MBF21's kill modes above that. A line or room can still take a raw special number for anything else, and the checks flag numbers and flags past the map's level.
- **Place:** pick a thing and click inside a room.
- **Switch:** click a solid wall to add a switch, then drag from it to a door.
- **Doors:** draw a thin room between two rooms and turn on **Door** in the inspector. It can open with the use key or a switch, and close again or stay open. Each line into the door can keep the door shut on its side, open it its own way or wear its own face, and **Use on the whole door** paints every face again.
- **Edit modes:** press V, L, S or T to work with vertices, lines, sectors or things.
- **Views:** switch between **Map**, **Split** and **3D**. Drag the divider, or press M to maximize the view under the pointer and return to Split. In Map view, the player view stays docked in the corner.
- **Camera:** drag the camera marker on the map, double-click the map or press C to move the 3D view, and use **Find camera** to center the map on it.
- **3D:** click a floor, ceiling, wall, door, switch or thing to select it. Drag floors and ceilings to change height, or pick a texture in the side panel. Choose **Place** to put the chosen thing on a floor, and drag things to move them. Walk with WASD, step through surfaces with N and P, nudge heights with Page Up and Page Down, and nudge a selected thing with Alt and the arrow keys.
- **Co-op:** place a Player 2 start, and Player 3 and 4 starts for more players, then press **Co-op** and send the invite link. Guests join from the link without the map, and the host presses Start once everyone is in.
- **Play:** builds a WAD and opens it full size in vanilla Doom mode at 60 frames a second, with sound effects, music and a volume control. Click the game to capture the mouse, then move it to turn and click to fire. Move with WASD, turn with the arrow keys, fire with Space and use with E. Esc releases the mouse and pauses, and a second Esc returns to the editor.

Your map saves in this browser as you edit. Use **File** to start a new map, save a map file, open one again, or download a WAD.

`window.agent` exposes the UI SDK agent bridge, with `addConnectedRoom`, `setRoomHeights`, `placeThing`, `makeDoor` and `addDoorSwitch` on the Map component.

## License

Wadsmith is GPL-2.0-or-later, the same license as Woof, with the text in `LICENSE`. `engine/woof.patch` holds every change to Woof, and the compiled engine is a build of Woof with that patch.

Woof is GPL-2.0-or-later and Freedoom is BSD-licensed. Neither is committed here. `setup:engine` writes their licenses to `public/engine`, and `public/engine/licenses` holds the notices for everything else linked into the engine, including SDL3, Emscripten's runtime, musl, miniz, spng, yyjson and Nuked OPL3. Anything that distributes Wadsmith or the compiled engine has to meet the GPL's terms, including offering the matching source: this repository, the pinned Woof commit and `engine/woof.patch`.
