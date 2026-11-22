type Route =
  | { kind: "home" }
  | { kind: "featured"; map?: string; play?: boolean }
  | { kind: "episode"; id: string; play?: boolean }
  | { kind: "map"; id: string; slot: string; play?: boolean };

const slotPattern = /^MAP(0[1-9]|[12][0-9]|3[0-6])$/;
const shortIdPattern = /^[0-9a-z]{8}$/;

// Episodes made before short ids keep their stored id, and their address is a
// stable hash of it, so links stay the same across visits and tabs.
function episodeSlug(id: string) {
  if (shortIdPattern.test(id)) return id;
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  for (const char of id) {
    const code = char.codePointAt(0) ?? 0;
    a = Math.imul(a ^ code, 2654435761);
    b = Math.imul(b ^ code, 1597334677);
  }
  a =
    Math.imul(a ^ (a >>> 16), 2246822507) ^
    Math.imul(b ^ (b >>> 13), 3266489909);
  b =
    Math.imul(b ^ (b >>> 16), 2246822507) ^
    Math.imul(a ^ (a >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & b) + (a >>> 0);
  return hash.toString(36).padStart(8, "0").slice(-8);
}

function findEpisode<T extends { id: string }>(episodes: T[], slug: string) {
  return (
    episodes.find((episode) => episode.id === slug) ??
    episodes.find(
      (episode) => episodeSlug(episode.id) === slug.toLowerCase(),
    ) ??
    null
  );
}

function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const play = parts.at(-1) === "play";
  const rest = play ? parts.slice(0, -1) : parts;
  const playing = <T extends Route>(route: T): T =>
    play ? { ...route, play } : route;
  if (rest[0] === "maps") {
    if (rest.length === 1 && !play) return { kind: "featured" };
    if (rest.length === 2) return playing({ kind: "featured", map: rest[1] });
  }
  if (rest[0] === "episodes" && rest[1]) {
    if (rest.length === 2) return playing({ kind: "episode", id: rest[1] });
    const slot = rest[2]?.toUpperCase();
    if (rest.length === 3 && slotPattern.test(slot)) {
      return playing({ kind: "map", id: rest[1], slot });
    }
  }
  return { kind: "home" };
}

function pathOf(route: Route) {
  const play = route.kind !== "home" && route.play ? "/play" : "";
  if (route.kind === "featured") {
    return route.map
      ? `/maps/${encodeURIComponent(route.map)}${play}`
      : "/maps";
  }
  if (route.kind === "episode") {
    return `/episodes/${episodeSlug(route.id)}${play}`;
  }
  if (route.kind === "map") {
    return `/episodes/${episodeSlug(route.id)}/${route.slot.toLowerCase()}${play}`;
  }
  return "/";
}

export { episodeSlug, findEpisode, parseRoute, pathOf, type Route };
