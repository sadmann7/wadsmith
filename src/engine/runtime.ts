import { FramePacer } from "./frame-pacer";

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
  _wadsmith_key(pressed: number, key: number): void;
  _wadsmith_mouse_turn(amount: number): void;
  _wadsmith_set_paused(paused: number): void;
  _wadsmith_game_state(): number;
  _wadsmith_game_tic(): number;
  _wadsmith_health(): number;
  _wadsmith_kills(): number;
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
  _wadsmith_audio_init(sampleRate: number): void;
  _wadsmith_audio_render(frames: number): number;
  _wadsmith_set_sound(volume: number, muted: number): void;
  _wadsmith_strict_mode(): number;
  _wadsmith_demo_version(): number;
};

type DoomModuleOptions = {
  print?: (message: string) => void;
  printErr?: (message: string) => void;
  locateFile?: (path: string) => string;
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

const screenWidth = 320;
const screenHeight = 200;
const maxVolume = 15;
const levelState = 0;

// Woof's own conveniences and visual extras are switched off, so a playtest looks
// and plays like the classic game a map is built for.
const engineConfig = `fullscreen 0
use_vsync 0
uncapped 1
fpslimit 0
widescreen 0
current_video_height 200
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
  private pixels: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(
    screenWidth * screenHeight * 4,
  );

  constructor(
    private readonly module: DoomModule,
    private readonly events: GameEvents = {},
  ) {}

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

  sectorCeiling(index: number) {
    return this.module._wadsmith_sector_ceiling(index);
  }

  status(): GameStatus {
    const { module } = this;
    return {
      inLevel: module._wadsmith_game_state() === levelState,
      health: module._wadsmith_health(),
      kills: module._wadsmith_kills(),
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
}: {
  createDoom: CreateDoom;
  iwad: Uint8Array;
  base: Uint8Array;
  map: Uint8Array;
  options?: DoomModuleOptions;
  events?: GameEvents;
  sampleRate?: number | null;
}) {
  const doomModule = await createDoom(options ?? {});
  doomModule.FS.writeFile("/freedoom2.wad", iwad);
  doomModule.FS.writeFile("/woof.pk3", base);
  doomModule.FS.writeFile("/wadsmith.wad", map);
  doomModule.FS.writeFile("/woof.cfg", engineConfig);
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
      "3",
      "-complevel",
      "vanilla",
      "-nogui",
      "-config",
      "/woof.cfg",
      ...(sampleRate === null ? ["-nosound", "-nomusic", "-nosfx"] : []),
    ]);
  } catch (error) {
    throw exitCode(error) === null
      ? error
      : new Error(`The engine exited with code ${exitCode(error)}.`, {
          cause: error,
        });
  }
  const game = new DoomGame(doomModule, events);
  game.run();
  return game;
}

export {
  DoomGame,
  doomKeys,
  keysByCode,
  maxVolume,
  screenHeight,
  screenWidth,
  startDoom,
  type CreateDoom,
  type GameEvents,
  type GameStatus,
};
