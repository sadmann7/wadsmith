type Route =
  | { kind: "home" }
  | { kind: "featured"; map?: string; play?: boolean }
  | { kind: "episode"; id: string; play?: boolean }
  | { kind: "map"; id: string; slot: string; play?: boolean };

const slotPattern = /^MAP(0[1-9]|[12][0-9]|3[0-2])$/;

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
    return `/episodes/${encodeURIComponent(route.id)}${play}`;
  }
  if (route.kind === "map") {
    return `/episodes/${encodeURIComponent(route.id)}/${route.slot}${play}`;
  }
  return "/";
}

export { parseRoute, pathOf, type Route };
