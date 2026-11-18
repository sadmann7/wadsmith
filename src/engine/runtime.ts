type DoomModule = {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
  };
  HEAPU8: Uint8Array;
  callMain(args: string[]): number;
  _wadsmith_key(pressed: number, key: number): void;
  _wadsmith_tick(): void;
  _wadsmith_screen(): number;
  _wadsmith_frames(): number;
  _wadsmith_game_state(): number;
  _wadsmith_health(): number;
  _wadsmith_kills(): number;
  _wadsmith_total_kills(): number;
  _wadsmith_player_x(): number;
  _wadsmith_player_y(): number;
  _wadsmith_sector_ceiling(index: number): number;
};

type DoomModuleOptions = {
  print?: (message: string) => void;
  printErr?: (message: string) => void;
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
};

const screenWidth = 640;
const screenHeight = 400;
const ticsPerSecond = 35;
const levelState = 0;

const doomKeys = {
  right: 0xae,
  left: 0xac,
  up: 0xad,
  down: 0xaf,
  strafeLeft: 0xa0,
  strafeRight: 0xa1,
  use: 0xa2,
  fire: 0xa3,
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
  Escape: doomKeys.escape,
  Enter: doomKeys.enter,
  Tab: doomKeys.tab,
  KeyY: "y".charCodeAt(0),
  KeyN: "n".charCodeAt(0),
  Digit1: "1".charCodeAt(0),
  Digit2: "2".charCodeAt(0),
  Digit3: "3".charCodeAt(0),
  Digit4: "4".charCodeAt(0),
};

class DoomGame {
  private lastTic = -1;
  private pixels: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(
    screenWidth * screenHeight * 4,
  );

  constructor(private readonly module: DoomModule) {}

  // The engine spins until its next tic is due, so calling it early would stall the page.
  tick(now: number) {
    const tic = Math.floor((now * ticsPerSecond) / 1000);
    if (tic === this.lastTic) return false;
    this.lastTic = tic;
    this.module._wadsmith_tick();
    return true;
  }

  key(pressed: boolean, key: number) {
    this.module._wadsmith_key(pressed ? 1 : 0, key);
  }

  // The engine writes BGRA with an unused alpha byte.
  frame() {
    const source = this.module.HEAPU8;
    const start = this.module._wadsmith_screen();
    const { pixels } = this;
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = source[start + index + 2];
      pixels[index + 1] = source[start + index + 1];
      pixels[index + 2] = source[start + index];
      pixels[index + 3] = 255;
    }
    return pixels;
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
    };
  }
}

async function startDoom({
  createDoom,
  iwad,
  map,
  options,
}: {
  createDoom: CreateDoom;
  iwad: Uint8Array;
  map: Uint8Array;
  options?: DoomModuleOptions;
}) {
  const module = await createDoom(options ?? {});
  module.FS.writeFile("/freedoom2.wad", iwad);
  module.FS.writeFile("/wadsmith.wad", map);
  module.callMain([
    "-iwad",
    "/freedoom2.wad",
    "-file",
    "/wadsmith.wad",
    "-warp",
    "1",
    "-skill",
    "3",
    "-nosound",
    "-nomusic",
  ]);
  return new DoomGame(module);
}

export {
  DoomGame,
  doomKeys,
  keysByCode,
  screenHeight,
  screenWidth,
  startDoom,
  type CreateDoom,
  type GameStatus,
};
