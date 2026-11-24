import * as React from "react";

// Shortcuts match the character typed, and "+" can't be written as one, so
// Shift+=, the keypad's + and layouts with a + key all arrive here.
export function usePlusKey(enabled: boolean, onPress: () => boolean) {
  const press = React.useEffectEvent(onPress);
  React.useEffect(() => {
    if (!enabled) return;
    const listener = (event: KeyboardEvent) => {
      if (
        event.key !== "+" ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }
      if (press()) event.preventDefault();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [enabled]);
}
