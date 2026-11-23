import { fuzzyScore } from "@ui-sdk/core/text-match";

// The items whose texts match the query, best first, with ties kept in the
// order given. An empty query keeps every item as it was.
export function rankByQuery<T>(
  items: readonly T[],
  query: string,
  textsOf: (item: T) => string[],
): T[] {
  const typed = query.trim();
  if (!typed) return [...items];
  return items
    .map((item, index) => ({
      item,
      index,
      score: Math.max(...textsOf(item).map((text) => fuzzyScore(text, typed))),
    }))
    .filter(({ score }) => score > 0)
    .toSorted((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);
}
