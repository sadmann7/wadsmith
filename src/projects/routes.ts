type Route =
  | { kind: "home" }
  | { kind: "featured" }
  | { kind: "episode"; id: string }
  | { kind: "map"; id: string; slot: string };

const slotPattern = /^MAP(0[1-9]|[12][0-9]|3[0-2])$/;

function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 1 && parts[0] === "maps") return { kind: "featured" };
  if (parts[0] === "episodes" && parts[1]) {
    if (parts.length === 2) return { kind: "episode", id: parts[1] };
    const slot = parts[2]?.toUpperCase();
    if (parts.length === 3 && slotPattern.test(slot)) {
      return { kind: "map", id: parts[1], slot };
    }
  }
  return { kind: "home" };
}

function pathOf(route: Route) {
  if (route.kind === "featured") return "/maps";
  if (route.kind === "episode") {
    return `/episodes/${encodeURIComponent(route.id)}`;
  }
  if (route.kind === "map") {
    return `/episodes/${encodeURIComponent(route.id)}/${route.slot}`;
  }
  return "/";
}

export { parseRoute, pathOf, type Route };
