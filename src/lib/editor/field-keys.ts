const typedFields = new Set(["text", "number", "search"]);

export function notTyping() {
  const focused = document.activeElement;
  return !(
    focused instanceof HTMLElement &&
    (focused.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName))
  );
}

// Enter, or Escape outside an open list, ends an edit in a field of `panel`.
// Keys from a dialog the panel opened reach it through React's portals, so
// the field must sit inside the panel itself.
export function endsFieldEdit(event: KeyboardEvent, panel: Element) {
  const field = event.target;
  if (
    !(field instanceof HTMLInputElement) ||
    !typedFields.has(field.type) ||
    !panel.contains(field) ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return false;
  }
  if (event.key === "Enter") return true;
  return (
    event.key === "Escape" && field.getAttribute("aria-expanded") !== "true"
  );
}
