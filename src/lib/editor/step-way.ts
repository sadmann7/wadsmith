// Which way a step went, read from what caused it: the field counts from zero
// when it is empty, and its limits hide the direction.
export function stepWay(details: { reason: string; event?: Event }) {
  if (details.reason === "increment-press") return 1;
  if (details.reason === "decrement-press") return -1;
  const key =
    details.reason === "step-key" && details.event instanceof KeyboardEvent
      ? details.event.key
      : "";
  if (key === "ArrowUp" || key === "PageUp") return 1;
  return key === "ArrowDown" || key === "PageDown" ? -1 : 0;
}
