type GameId = "freedoom2" | "freedoom1" | "doom2" | "plutonia" | "tnt" | "doom";

// Woof tells the Doom II games apart by the IWAD's file name, so each game
// keeps the name it ships under. Doom 1 games count their episodes and play
// ExMy maps; the rest play MAP01 to MAP32.
interface GameInfo {
  id: GameId;
  label: string;
  file: string;
  episodes: number;
  doom2: boolean;
}

const doom2Slots = 32;
const mapsPerEpisode = 9;
const mapSlot = /^MAP(\d\d)$/;
const episodeSlot = /^E(\d)M(\d)$/;

const games: Record<GameId, GameInfo> = {
  freedoom2: {
    id: "freedoom2",
    label: "Freedoom: Phase 2",
    file: "freedoom2.wad",
    episodes: 0,
    doom2: true,
  },
  freedoom1: {
    id: "freedoom1",
    label: "Freedoom: Phase 1",
    file: "freedoom1.wad",
    episodes: 4,
    doom2: false,
  },
  doom2: {
    id: "doom2",
    label: "Doom II: Hell on Earth",
    file: "doom2.wad",
    episodes: 0,
    doom2: true,
  },
  plutonia: {
    id: "plutonia",
    label: "Final Doom: The Plutonia Experiment",
    file: "plutonia.wad",
    episodes: 0,
    doom2: true,
  },
  tnt: {
    id: "tnt",
    label: "Final Doom: TNT: Evilution",
    file: "tnt.wad",
    episodes: 0,
    doom2: true,
  },
  doom: {
    id: "doom",
    label: "The Ultimate Doom",
    file: "doom.wad",
    episodes: 4,
    doom2: false,
  },
};

const defaultGame = games.freedoom2;

function slotCount(game: GameInfo) {
  return game.episodes > 0 ? game.episodes * mapsPerEpisode : doom2Slots;
}

// Episodes keep MAP01 to MAP32 as their slots whatever the game; a Doom 1 game
// plays MAP10 as E2M1.
function slotIndex(slot: string) {
  const match = mapSlot.exec(slot);
  return match ? Number(match[1]) : 0;
}

function engineSlot(slot: string, game: GameInfo) {
  if (game.episodes === 0) return slot;
  const index = slotIndex(slot);
  if (index === 0) return slot;
  const episode = Math.ceil(index / mapsPerEpisode);
  const map = ((index - 1) % mapsPerEpisode) + 1;
  return `E${episode}M${map}`;
}

// What an engine lump named like a map plays as, in MAP01 to MAP32 numbering.
function lumpSlotIndex(name: string) {
  const map = mapSlot.exec(name);
  if (map) return Number(map[1]);
  const episode = episodeSlot.exec(name);
  if (!episode) return null;
  return (Number(episode[1]) - 1) * mapsPerEpisode + Number(episode[2]);
}

function isMapLump(name: string) {
  return mapSlot.test(name) || episodeSlot.test(name);
}

function warpArgs(game: GameInfo, index: number) {
  if (game.episodes === 0) return ["-warp", String(index)];
  return [
    "-warp",
    String(Math.ceil(index / mapsPerEpisode)),
    String(((index - 1) % mapsPerEpisode) + 1),
  ];
}

function indexSlot(index: number) {
  return `MAP${String(index).padStart(2, "0")}`;
}

// A map's name in a game that counts episodes, or in one that doesn't.
function slotName(index: number, episodes: boolean) {
  return episodes
    ? `E${Math.ceil(index / mapsPerEpisode)}M${((index - 1) % mapsPerEpisode) + 1}`
    : indexSlot(index);
}

// The engine reports the episode and map it is in; a Doom II game reports
// only the map.
function statusIndex(game: GameInfo, episode: number, map: number) {
  return game.episodes === 0 ? map : (episode - 1) * mapsPerEpisode + map;
}

// The engine ends the game on these maps and never leaves their finale.
function endsGame(slot: string) {
  return slot === "MAP30" || /^E\dM8$/.test(slot);
}

function statusSlot(game: GameInfo, episode: number, map: number) {
  return slotName(statusIndex(game, episode, map), game.episodes > 0);
}

export {
  defaultGame,
  endsGame,
  engineSlot,
  games,
  indexSlot,
  isMapLump,
  lumpSlotIndex,
  slotCount,
  slotIndex,
  slotName,
  statusIndex,
  statusSlot,
  warpArgs,
  type GameId,
  type GameInfo,
};
