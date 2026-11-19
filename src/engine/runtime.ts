import { FramePacer } from "./frame-pacer";
import type { NetInbox } from "./net-inbox";

type DoomModule = {
  FS: {
    writeFile(path: string, data: Uint8Array | string): void;
  };
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  callMain(args: string[]): number;
  ccall(
    name: string,
    returnType: "number",
    argumentTypes: ["string"],
    args: [string],
  ): number;
  _wadsmith_run_frame(): void;
  _wadsmith_frame_count(): number;
  _wadsmith_frame_rgba(): number;
  _wadsmith_frame_width(): number;
  _wadsmith_frame_height(): number;
  _wadsmith_key(pressed: number, key: number): void;
  _wadsmith_mouse_turn(amount: number): void;
  _wadsmith_set_paused(paused: number): void;
  _wadsmith_game_state(): number;
  _wadsmith_game_tic(): number;
  _wadsmith_health(): number;
  _wadsmith_kills(): number;
  _wadsmith_frags(): number;
  _wadsmith_total_kills(): number;
  _wadsmith_player_x(): number;
  _wadsmith_player_y(): number;
  _wadsmith_player_angle(): number;
  _wadsmith_armor(): number;
  _wadsmith_ammo(): number;
  _wadsmith_ammo_type(): number;
  _wadsmith_keys(): number;
  _wadsmith_items(): number;
  _wadsmith_total_items(): number;
  _wadsmith_secrets(): number;
  _wadsmith_total_secrets(): number;
  _wadsmith_level_tics(): number;
  _wadsmith_sector_ceiling(index: number): number;
  _wadsmith_sector_floor(index: number): number;
  _wadsmith_audio_init(sampleRate: number): void;
  _wadsmith_audio_render(frames: number): number;
  _wadsmith_set_sound(volume: number, muted: number): void;
  _wadsmith_strict_mode(): number;
  _wadsmith_demo_version(): number;
  _wadsmith_net_launch(): number;
  _wadsmith_net_connected(): number;
  _wadsmith_net_waiting_players(): number;
  _wadsmith_players_in_game(): number;
  _wadsmith_console_player(): number;
  _wadsmith_net_player_x(player: number): number;
  _wadsmith_net_player_y(player: number): number;
};

type DoomModuleOptions = {
  print?: (message: string) => void;
  printErr?: (message: string) => void;
  locateFile?: (path: string) => string;
  wadsmithNet?: {
    send(peer: number, data: Uint8Array): void;
    receive(pointer: number, capacity: number, peerPointer: number): number;
    wait(ms: number): void;
  };
};

type NetworkMode = "coop" | "deathmatch";

type Skill = "easy" | "medium" | "hard";

// Doom's numbers for "Hey, not too rough", "Hurt me plenty" and "Ultra-Violence".
const skillLevels: Record<Skill, number> = { easy: 2, medium: 3, hard: 4 };

const fragLimit = 10;

/** How a network game reaches the other players, each numbered by the room. */
type NetworkOptions = {
  role: "host" | "guest";
  mode: NetworkMode;
  host: number;
  inbox: NetInbox;
  send: (peer: number, data: Uint8Array) => void;
};

type CreateDoom = (options: DoomModuleOptions) => Promise<DoomModule>;

type GameEvents = {
  onFrame?: () => void;
  onExit?: () => void;
  onFailure?: (error: unknown) => void;
};

type GameStatus = {
  inLevel: boolean;
  health: number;
  kills: number;
  frags: number;
  totalKills: number;
  x: number;
  y: number;
  angle: number;
  armor: number;
  ammo: number;
  ammoType: number;
  keys: number;
  items: number;
  totalItems: number;
  secrets: number;
  totalSecrets: number;
  tics: number;
};

type Resolution = "classic" | "high";

const screenSizes: Record<Resolution, { width: number; height: number }> = {
  classic: { width: 320, height: 200 },
  high: { width: 640, height: 400 },
};
const maxVolume = 15;
const levelState = 0;

// Woof's own conveniences and visual extras are switched off, so a playtest looks
// and plays like the classic game a map is built for.
const engineConfig = (resolution: Resolution) => `fullscreen 0
use_vsync 0
uncapped 1
fpslimit 0
widescreen 0
current_video_height ${screenSizes[resolution].height}
dynamic_resolution 0
screenblocks 13
screen_melt 1
show_endoom 0
disk_icon 0
grabmouse 0
translucency 0
fuzzmode 0
flipcorpses 0
colored_blood 0
voxels_rendering 0
invul_mode 0
extra_level_brightness 0
stretchsky 0
sky_projection 0
r_swirl 0
flashing_hom 0
palette_changes 1
hud_crosshair 0
hud_level_stats 0
hud_level_time 0
hud_player_coords 0
hud_command_history 0
hud_secret_message 0
hud_map_announce 0
show_messages 1
show_pickup_messages 1
show_toggle_messages 0
show_obituary_messages 0
message_centered 0
message_colorized 0
weapon_carousel 0
minimap 0
autorun 0
autostrafe50 0
dclick_use 0
novert 1
freelook 0
direct_vertical_aiming 0
mouse_sensitivity 25
mouse_acceleration 0
view_bobbing_pct 4
weapon_bobbing_pct 4
player_bobbing 1
weapon_recoil 0
weapon_recoilpitch 0
center_weapon 0
hide_weapon 0
classic_bfg 0
doom_weapon_toggles 1
doom_weapon_cycle 0
weapon_slots_activation 0
death_use_action 0
player_helpers 0
monsters_remember 1
monster_infighting 1
monster_backing 0
monster_avoid_hazards 0
monster_friction 0
ghost_monsters 0
help_friends 0
monkeys 0
dog_jumping 0
hangsolid 0
overunder 0
blockmapfix 0
checksight12 0
emu_spechits 1
emu_reject 1
emu_intercepts 1
emu_missedbackside 0
emu_donut 1
snd_module 0
snd_channels 8
snd_limiter 0
pitched_sounds 0
full_sounds 0
extra_music 0
autosave 0
rewind_auto 0
`;

const doomKeys = {
  right: 0xae,
  left: 0xac,
  up: 0xad,
  down: 0xaf,
  strafeLeft: "a".charCodeAt(0),
  strafeRight: "d".charCodeAt(0),
  use: " ".charCodeAt(0),
  fire: 0x8d,
  tab: 9,
  run: 0x8c,
} as const;

const keysByCode: Record<string, number> = {
  ArrowUp: doomKeys.up,
  ArrowDown: doomKeys.down,
  ArrowLeft: doomKeys.left,
  ArrowRight: doomKeys.right,
  KeyW: doomKeys.up,
  KeyS: doomKeys.down,
  KeyA: doomKeys.strafeLeft,
  KeyD: doomKeys.strafeRight,
  KeyE: doomKeys.use,
  Space: doomKeys.fire,
  ControlLeft: doomKeys.fire,
  ControlRight: doomKeys.fire,
  ShiftLeft: doomKeys.run,
  ShiftRight: doomKeys.run,
  Tab: doomKeys.tab,
  Digit1: "1".charCodeAt(0),
  Digit2: "2".charCodeAt(0),
  Digit3: "3".charCodeAt(0),
  Digit4: "4".charCodeAt(0),
  Digit5: "5".charCodeAt(0),
  Digit6: "6".charCodeAt(0),
  Digit7: "7".charCodeAt(0),
};

class DoomGame {
  private lastFrame = -1;
  private stopped = false;
  private readonly pacer = new FramePacer();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly pixels: Uint8ClampedArray<ArrayBuffer>;

  constructor(
    private readonly module: DoomModule,
    private readonly events: GameEvents = {},
    readonly resolution: Resolution = "classic",
  ) {
    const { width, height } = screenSizes[resolution];
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  run() {
    this.pacer.start(performance.now());
    this.runFrame();
    this.scheduleTimer();
  }

  syncToDisplay() {
    if (!this.stopped && this.pacer.onDisplay(performance.now())) {
      this.runFrame();
    }
  }

  // Keeps the game going when the page stops refreshing in the background.
  private scheduleTimer() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      if (this.pacer.onTimer(performance.now())) this.runFrame();
      this.scheduleTimer();
    }, this.pacer.timerDelay(performance.now()));
  }

  private runFrame() {
    if (this.stopped) return;
    try {
      this.module._wadsmith_run_frame();
    } catch (error) {
      this.stop();
      if (exitCode(error) === 0) this.events.onExit?.();
      else this.events.onFailure?.(error);
      return;
    }
    const frame = this.module._wadsmith_frame_count();
    if (frame !== this.lastFrame) {
      this.lastFrame = frame;
      this.events.onFrame?.();
    }
  }

  key(pressed: boolean, key: number) {
    this.module._wadsmith_key(pressed ? 1 : 0, key);
  }

  turn(amount: number) {
    this.module._wadsmith_mouse_turn(amount);
  }

  frame(pixels: Uint8ClampedArray<ArrayBuffer> = this.pixels) {
    const start = this.module._wadsmith_frame_rgba();
    pixels.set(this.module.HEAPU8.subarray(start, start + pixels.length));
    return pixels;
  }

  audio(frames: number) {
    const start = this.module._wadsmith_audio_render(frames) >> 2;
    const samples = this.module.HEAPF32;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let index = 0; index < frames; index += 1) {
      left[index] = samples[start + index * 2];
      right[index] = samples[start + index * 2 + 1];
    }
    return [left, right];
  }

  setPaused(paused: boolean) {
    this.module._wadsmith_set_paused(paused ? 1 : 0);
  }

  setSound(volume: number, muted: boolean) {
    const level = Math.max(0, Math.min(maxVolume, Math.round(volume)));
    this.module._wadsmith_set_sound(level, muted || level === 0 ? 1 : 0);
  }

  launchNetGame() {
    return this.module._wadsmith_net_launch() !== 0;
  }

  network() {
    const { module } = this;
    return {
      connected: module._wadsmith_net_connected() !== 0,
      waitingPlayers: module._wadsmith_net_waiting_players(),
      playersInGame: module._wadsmith_players_in_game(),
      consolePlayer: module._wadsmith_console_player(),
    };
  }

  playerPosition(player: number) {
    return {
      x: this.module._wadsmith_net_player_x(player),
      y: this.module._wadsmith_net_player_y(player),
    };
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  setting(name: string) {
    return this.module.ccall("wadsmith_setting", "number", ["string"], [name]);
  }

  classicMode() {
    return {
      strict: this.module._wadsmith_strict_mode() !== 0,
      demoVersion: this.module._wadsmith_demo_version(),
    };
  }

  gameTic() {
    return this.module._wadsmith_game_tic();
  }

  sectorFloor(index: number) {
    return this.module._wadsmith_sector_floor(index);
  }

  sectorCeiling(index: number) {
    return this.module._wadsmith_sector_ceiling(index);
  }

  status(): GameStatus {
    const { module } = this;
    return {
      inLevel: module._wadsmith_game_state() === levelState,
      health: module._wadsmith_health(),
      kills: module._wadsmith_kills(),
      frags: module._wadsmith_frags(),
      totalKills: module._wadsmith_total_kills(),
      x: module._wadsmith_player_x(),
      y: module._wadsmith_player_y(),
      angle: module._wadsmith_player_angle(),
      armor: module._wadsmith_armor(),
      ammo: module._wadsmith_ammo(),
      ammoType: module._wadsmith_ammo_type(),
      keys: module._wadsmith_keys(),
      items: module._wadsmith_items(),
      totalItems: module._wadsmith_total_items(),
      secrets: module._wadsmith_secrets(),
      totalSecrets: module._wadsmith_total_secrets(),
      tics: module._wadsmith_level_tics(),
    };
  }
}

function exitCode(error: unknown) {
  return typeof error === "object" && error && "wadsmithExit" in error
    ? (error.wadsmithExit as number)
    : null;
}

async function startDoom({
  createDoom,
  iwad,
  base,
  map,
  options,
  events,
  sampleRate = null,
  resolution = "classic",
  skill = "medium",
  network,
}: {
  createDoom: CreateDoom;
  iwad: Uint8Array;
  base: Uint8Array;
  map: Uint8Array;
  options?: DoomModuleOptions;
  events?: GameEvents;
  sampleRate?: number | null;
  resolution?: Resolution;
  skill?: Skill;
  network?: NetworkOptions;
}) {
  const doomModule = await createDoom({
    ...options,
    ...(network && {
      wadsmithNet: {
        send: network.send,
        receive: (pointer, capacity, peerPointer) => {
          for (;;) {
            const packet = network.inbox.pop();
            if (!packet) return -1;
            if (packet.data.length > capacity) continue;
            const heap = doomModule.HEAPU8;
            heap.set(packet.data, pointer);
            new DataView(heap.buffer).setUint32(peerPointer, packet.peer, true);
            return packet.data.length;
          }
        },
        wait: (ms) => network.inbox.wait(ms),
      },
    }),
  });
  doomModule.FS.writeFile("/freedoom2.wad", iwad);
  doomModule.FS.writeFile("/woof.pk3", base);
  doomModule.FS.writeFile("/wadsmith.wad", map);
  doomModule.FS.writeFile("/woof.cfg", engineConfig(resolution));
  if (sampleRate !== null) doomModule._wadsmith_audio_init(sampleRate);
  try {
    doomModule.callMain([
      "-iwad",
      "/freedoom2.wad",
      "-file",
      "/wadsmith.wad",
      "-warp",
      "1",
      "-skill",
      String(skillLevels[skill]),
      "-complevel",
      "vanilla",
      "-nogui",
      "-config",
      "/woof.cfg",
      ...(network?.role === "host" ? ["-privateserver"] : []),
      // The host's server settings reach every player, but each engine reads
      // the frag limit from its own command line.
      ...(network?.mode === "deathmatch"
        ? [
            ...(network.role === "host" ? ["-altdeath"] : []),
            "-frags",
            String(fragLimit),
          ]
        : []),
      ...(network?.role === "guest" ? ["-connect", String(network.host)] : []),
      ...(sampleRate === null ? ["-nosound", "-nomusic", "-nosfx"] : []),
    ]);
  } catch (error) {
    throw exitCode(error) === null
      ? error
      : new Error(`The engine exited with code ${exitCode(error)}.`, {
          cause: error,
        });
  }
  const { width, height } = screenSizes[resolution];
  const drawn = [
    doomModule._wadsmith_frame_width(),
    doomModule._wadsmith_frame_height(),
  ];
  if (drawn[0] !== width || drawn[1] !== height) {
    throw new Error(
      `The engine draws ${drawn.join("x")} instead of ${width}x${height}.`,
    );
  }
  const game = new DoomGame(doomModule, events, resolution);
  game.run();
  return game;
}

export {
  DoomGame,
  fragLimit,
  doomKeys,
  keysByCode,
  maxVolume,
  screenSizes,
  startDoom,
  type CreateDoom,
  type GameEvents,
  type GameStatus,
  type NetworkMode,
  type NetworkOptions,
  type Skill,
  type Resolution,
};
