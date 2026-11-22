import type {
  PlaytestRun,
  RunMark,
  RunMarkKind,
  RunPath,
  RunResult,
} from "@/lib/map/playtest";

// How many numbers the engine writes for each event: the level's time, the
// kind, the player, a place on the map and a value.
export const trailFields = 6;

const kinds = {
  start: 0,
  step: 1,
  damage: 2,
  death: 3,
  pickup: 4,
  totals: 5,
  exit: 6,
} as const;
const markKinds: Partial<Record<number, RunMarkKind>> = {
  [kinds.damage]: "damage",
  [kinds.death]: "death",
  [kinds.pickup]: "pickup",
};
// Further than a player runs between two steps, so a teleport or a new life
// starts another path.
const jump = 384;
// Hits this close in place and time count as one, so a chaingunner leaves a
// mark and not a cloud.
const hitReach = 48;
const hitTics = 24;
const maxPoints = 20_000;
const maxMarks = 4000;

// Builds a run from the events the engine reports while a map is played. A
// level that starts again, like after a death, adds to the same run.
export class RunRecorder {
  readonly id = `run-${Date.now().toString(36)}`;
  private readonly at = Date.now();
  private readonly players = new Set<number>();
  private readonly paths: RunPath[] = [];
  private readonly marks: RunMark[] = [];
  private readonly walking = new Map<number, RunPath>();
  private points = 0;
  private level: string | null = null;
  private left = false;
  private totals = { kills: 0, secrets: 0, items: 0 };
  private result: RunResult | null = null;

  add(events: Int32Array) {
    for (let at = 0; at + trailFields <= events.length; at += trailFields) {
      if (this.left) return;
      const [tic, kind, player, x, y, value] = events.subarray(at);
      // The engine's y runs up and the editor's runs down.
      const point = { x, y: 0 - y };
      if (kind === kinds.start) {
        // A start names its episode and map. Past the exit the engine loads
        // the game's next map, which is no part of this playtest.
        const level = `${x}:${y}`;
        this.left = this.level !== null && this.level !== level;
        if (this.left) return;
        this.level = level;
        this.walking.clear();
        this.result = null;
      } else if (kind === kinds.step) {
        this.step(player, point);
      } else if (kind === kinds.totals) {
        this.totals = { kills: x, secrets: y, items: value };
      } else if (kind === kinds.exit) {
        this.exit(tic, x, y, value);
      } else {
        const mark = markKinds[kind];
        if (mark) this.mark({ kind: mark, player, ...point, tic, value });
      }
    }
  }

  // The run so far, or null when nobody has moved yet.
  run(): PlaytestRun | null {
    const paths = this.paths.filter((path) => path.points.length > 2);
    if (paths.length === 0 && this.marks.length === 0) return null;
    return {
      id: this.id,
      at: this.at,
      players: [...this.players].toSorted((a, b) => a - b),
      paths: paths.map((path) => ({ ...path, points: [...path.points] })),
      marks: this.marks.map((mark) => ({ ...mark })),
      result: this.result,
    };
  }

  private step(player: number, point: { x: number; y: number }) {
    if (this.points >= maxPoints) return;
    this.players.add(player);
    let path = this.walking.get(player);
    const [lastX, lastY] = path?.points.slice(-2) ?? [];
    if (
      !path ||
      Math.abs(point.x - lastX) > jump ||
      Math.abs(point.y - lastY) > jump
    ) {
      path = { player, points: [] };
      this.walking.set(player, path);
      this.paths.push(path);
    }
    path.points.push(point.x, point.y);
    this.points += 1;
  }

  private mark(mark: RunMark) {
    this.players.add(mark.player);
    const last = this.marks.findLast(
      (item) => item.kind === "damage" && item.player === mark.player,
    );
    if (
      mark.kind === "damage" &&
      last &&
      mark.tic >= last.tic &&
      mark.tic - last.tic <= hitTics &&
      Math.abs(mark.x - last.x) <= hitReach &&
      Math.abs(mark.y - last.y) <= hitReach
    ) {
      last.value += mark.value;
      last.tic = mark.tic;
    } else if (this.marks.length < maxMarks) {
      this.marks.push(mark);
    }
  }

  // Every player in the game reports at the exit, and their counts add up.
  private exit(tic: number, kills: number, secrets: number, items: number) {
    const before = this.result?.tics === tic ? this.result : null;
    this.result = {
      tics: tic,
      kills: (before?.kills ?? 0) + kills,
      totalKills: this.totals.kills,
      items: (before?.items ?? 0) + items,
      totalItems: this.totals.items,
      secrets: (before?.secrets ?? 0) + secrets,
      totalSecrets: this.totals.secrets,
    };
  }
}
