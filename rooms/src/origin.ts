// An entry ending in ":*" allows any port on that host.
function allowedOrigin(origin: string, allowed: string) {
  return allowed
    .split(/\s+/)
    .some((entry) =>
      entry.endsWith(":*")
        ? origin.startsWith(entry.slice(0, -1)) &&
          /^\d+$/.test(origin.slice(entry.length - 1))
        : origin === entry,
    );
}

export { allowedOrigin };
