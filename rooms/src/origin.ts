// In an entry, ":*" stands for any port and any other "*" for one run of
// letters and digits, so a wildcard can never reach into another domain.
function originPattern(entry: string) {
  const source = entry
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:\*$/, ":\\d+")
    .replaceAll("*", "[a-z0-9]+");
  return new RegExp(`^${source}$`);
}

function allowedOrigin(origin: string, allowed: string) {
  return allowed
    .split(/\s+/)
    .filter(Boolean)
    .some((entry) => originPattern(entry).test(origin));
}

export { allowedOrigin };
