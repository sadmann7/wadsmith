import { thingCatalog, thingKinds } from "./catalog";

// One stretch a player walked without a break, as x and y pairs in the
// editor's coordinates. A teleport, a death or a fresh start begins another.
export interface RunPath {
  player: number;
  points: number[];
}

export type RunMarkKind = "damage" | "death" | "pickup";

// Something that happened to a player at a spot. The value is the damage
// taken, the Doom type of the thing picked up, or what killed the player: a
// thing's Doom type, -1 for a player and 0 for the level itself.
export interface RunMark {
  kind: RunMarkKind;
  player: number;
  x: number;
  y: number;
  tic: number;
  value: number;
}

// How the level stood when the players left through its exit.
export interface RunResult {
  tics: number;
  kills: number;
  totalKills: number;
  items: number;
  totalItems: number;
  secrets: number;
  totalSecrets: number;
}

// What the engine saw during one playtest of a map, every try included.
export interface PlaytestRun {
  id: string;
  at: number;
  players: number[];
  paths: RunPath[];
  marks: RunMark[];
  // Null when nobody reached the exit.
  result: RunResult | null;
  // God mode or no clipping was on at some point.
  cheated: boolean;
}

// The last run of a map, and the fastest any run of it reached the exit, in
// tics.
export interface SavedPlaytest {
  run: PlaytestRun;
  best: number | null;
}

export const ticsPerSecond = 35;

const parStep = 5;
const killedByPlayer = -1;
const kindsByType = new Map(
  thingKinds.map((kind) => [thingCatalog[kind].doomType, kind]),
);

export function runSummary(run: PlaytestRun) {
  const of = (kind: RunMarkKind) =>
    run.marks.filter((mark) => mark.kind === kind);
  return {
    deaths: of("death").length,
    damage: of("damage").reduce((total, mark) => total + mark.value, 0),
    pickups: of("pickup").length,
  };
}

// A level's time as minutes and seconds.
export function formatTics(tics: number) {
  const seconds = Math.floor(tics / ticsPerSecond);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// A share of a total as a whole percentage, or null when there is none to
// take a share of.
export function percentOf(count: number, total: number) {
  return total > 0 ? Math.min(100, Math.round((count / total) * 100)) : null;
}

// A par to aim for: the fastest exit so far, rounded up to the five seconds
// the game's own par times step by.
export function suggestedPar(tics: number) {
  const seconds = Math.ceil(tics / ticsPerSecond);
  return Math.max(parStep, Math.ceil(seconds / parStep) * parStep);
}

// The thing a pickup or a death names by its Doom type, or null when the
// editor has no such thing.
export function markThing(mark: RunMark) {
  const kind = kindsByType.get(mark.value);
  return kind ? thingCatalog[kind].label : null;
}

// What killed the players and how often, the most frequent first. A crusher,
// a damaging floor and a fall from a barrel's blast all count as the level.
export function killersOf(run: PlaytestRun) {
  const counts = new Map<string, number>();
  for (const mark of run.marks) {
    if (mark.kind !== "death") continue;
    const name =
      mark.value === killedByPlayer
        ? "A player"
        : (markThing(mark) ?? "The level");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .toSorted((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

// A new run takes the last one's place, and the fastest exit is kept. A run
// that didn't start at the player start, or used cheats, is no time to beat.
export function keepRun(
  saved: SavedPlaytest | null,
  run: PlaytestRun,
  timed = true,
): SavedPlaytest {
  const times = [
    saved?.best,
    timed && !run.cheated ? run.result?.tics : null,
  ].filter((tics) => tics !== null && tics !== undefined);
  return { run, best: times.length > 0 ? Math.min(...times) : null };
}

export function parsePlaytest(value: unknown): SavedPlaytest | null {
  if (!getIsRecord(value)) return null;
  const run = parseRun(value.run);
  if (!run) return null;
  return { run, best: getIsCount(value.best) ? value.best : null };
}

// A run read back from storage, or null when it isn't one.
export function parseRun(value: unknown): PlaytestRun | null {
  if (!getIsRecord(value)) return null;
  const { id, at, players, paths, marks, result, cheated } = value;
  if (typeof id !== "string" || !getIsCount(at)) return null;
  if (!Array.isArray(players) || !players.every(getIsCount)) return null;
  if (!Array.isArray(paths) || !Array.isArray(marks)) return null;
  const readPaths = paths.map(parsePath);
  const readMarks = marks.map(parseMark);
  if (readPaths.includes(null) || readMarks.includes(null)) return null;
  const readResult = result === null ? null : parseResult(result);
  if (readResult === undefined) return null;
  return {
    id,
    at,
    players,
    paths: readPaths.filter((path) => path !== null),
    marks: readMarks.filter((mark) => mark !== null),
    result: readResult,
    cheated: cheated === true,
  };
}

function parsePath(value: unknown): RunPath | null {
  if (!getIsRecord(value) || !getIsCount(value.player)) return null;
  const { points } = value;
  if (!Array.isArray(points) || points.length % 2 !== 0) return null;
  return points.every(Number.isFinite)
    ? { player: value.player, points: points as number[] }
    : null;
}

const markKinds: RunMarkKind[] = ["damage", "death", "pickup"];

function parseMark(value: unknown): RunMark | null {
  if (!getIsRecord(value)) return null;
  const { kind, player, x, y, tic, value: amount } = value;
  const numbers = [x, y, tic, amount];
  if (!markKinds.includes(kind as RunMarkKind) || !getIsCount(player)) {
    return null;
  }
  if (!numbers.every(Number.isFinite)) return null;
  return {
    kind: kind as RunMarkKind,
    player,
    x: x as number,
    y: y as number,
    tic: tic as number,
    value: amount as number,
  };
}

const resultFields = [
  "tics",
  "kills",
  "totalKills",
  "items",
  "totalItems",
  "secrets",
  "totalSecrets",
] as const;

function parseResult(value: unknown): RunResult | undefined {
  if (!getIsRecord(value)) return undefined;
  if (!resultFields.every((field) => getIsCount(value[field]))) {
    return undefined;
  }
  return Object.fromEntries(
    resultFields.map((field) => [field, value[field]]),
  ) as unknown as RunResult;
}

function getIsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getIsCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}
