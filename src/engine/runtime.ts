type DoomModule = {
  FS: {
    writeFile(path: string, data: Uint8Array | string): void;
  };
  HEAPU8: Uint8Array;
  SDL2?: { audioContext?: AudioContext };
  callMain(args: string[]): number;
  _doom_post_event(
    type: number,
    data1: number,
    data2: number,
    data3: number,
  ): void;
  _doom_screen(): number;
  _doom_palette(): number;
  _doom_frame_count(): number;
  _doom_set_paused(paused: number): void;
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
  _wadsmith_set_volume(volume: number): void;
  _wadsmith_set_muted(muted: number): void;
  _wadsmith_stop(): void;
};

type DoomModuleOptions = {
  print?: (message: string) => void;
  printErr?: (message: string) => void;
  onExit?: (code: number) => void;
  locateFile?: (path: string) => string;
};

type CreateDoom = (options: DoomModuleOptions) => Promise<DoomModule>;

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
const keyDownEvent = 0;
const keyUpEvent = 1;

const engineConfig = `snd_musicdevice 3
snd_sfxdevice 3
snd_channels 8
screenblocks 11
detaillevel 0
show_messages 1
`;

const engineExtraConfig = `startup_delay 0
show_diskicon 0
show_endoom 0
grabmouse 0
novert 1
`;

const doomKeys = {
  right: 0xae,
  left: 0xac,
  up: 0xad,
  down: 0xaf,
  strafeLeft: ",".charCodeAt(0),
  strafeRight: ".".charCodeAt(0),
  use: " ".charCodeAt(0),
  fire: 0x80 + 0x1d,
  escape: 27,
  enter: 13,
  tab: 9,
  run: 0x80 + 0x36,
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
  Enter: doomKeys.enter,
  Tab: doomKeys.tab,
  Digit1: "1".charCodeAt(0),
  Digit2: "2".charCodeAt(0),
  Digit3: "3".charCodeAt(0),
  Digit4: "4".charCodeAt(0),
};

function stopModule(module: DoomModule) {
  try {
    module._wadsmith_stop();
  } catch {
    // A crashed or exited engine can't run its own shutdown.
  }
  void module.SDL2?.audioContext?.close();
}

class DoomGame {
  private lastFrame = -1;
  private stopped = false;
  private pixels: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(
    screenWidth * screenHeight * 4,
  );

  constructor(private readonly module: DoomModule) {}

  hasNewFrame() {
    const frame = this.module._doom_frame_count();
    if (frame === this.lastFrame) return false;
    this.lastFrame = frame;
    return true;
  }

  key(pressed: boolean, key: number) {
    this.module._doom_post_event(
      pressed ? keyDownEvent : keyUpEvent,
      key,
      key,
      key,
    );
  }

  frame(pixels: Uint8ClampedArray<ArrayBuffer> = this.pixels) {
    const { HEAPU8: memory } = this.module;
    const screen = this.module._doom_screen();
    const palette = this.module._doom_palette();
    for (let index = 0; index < screenWidth * screenHeight; index += 1) {
      const color = palette + memory[screen + index] * 4;
      const pixel = index * 4;
      pixels[pixel] = memory[color];
      pixels[pixel + 1] = memory[color + 1];
      pixels[pixel + 2] = memory[color + 2];
      pixels[pixel + 3] = 255;
    }
    return pixels;
  }

  setPaused(paused: boolean) {
    this.module._doom_set_paused(paused ? 1 : 0);
  }

  setSound(volume: number, muted: boolean) {
    const level = Math.max(0, Math.min(maxVolume, Math.round(volume)));
    this.module._wadsmith_set_volume(level);
    this.module._wadsmith_set_muted(muted || level === 0 ? 1 : 0);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    stopModule(this.module);
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

async function startDoom({
  createDoom,
  iwad,
  map,
  options,
  sound = true,
}: {
  createDoom: CreateDoom;
  iwad: Uint8Array;
  map: Uint8Array;
  options?: DoomModuleOptions;
  sound?: boolean;
}) {
  const doomModule = await createDoom(options ?? {});
  doomModule.FS.writeFile("/freedoom2.wad", iwad);
  doomModule.FS.writeFile("/wadsmith.wad", map);
  doomModule.FS.writeFile("/default.cfg", engineConfig);
  doomModule.FS.writeFile("/extra.cfg", engineExtraConfig);
  // A map error can stop startup after the music has begun.
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
      "-window",
      "-nogui",
      "-pageframes",
      "-config",
      "/default.cfg",
      "-extraconfig",
      "/extra.cfg",
      ...(sound ? [] : ["-nosound", "-nomusic"]),
    ]);
  } catch (error) {
    stopModule(doomModule);
    throw error;
  }
  return new DoomGame(doomModule);
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
  type GameStatus,
};
