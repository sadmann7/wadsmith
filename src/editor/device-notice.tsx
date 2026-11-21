import { createLocalStorage } from "@ui-sdk/core";
import { Monitor } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

const savedNotice = createLocalStorage("wadsmith:device-notice");
// Phones and tablets without a keyboard or mouse can't edit or play.
const touchOnlyQuery = "(hover: none) and (pointer: coarse)";

function subscribeTouchOnly(listener: () => void) {
  const query = matchMedia(touchOnlyQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function isTouchOnly() {
  return matchMedia(touchOnlyQuery).matches;
}

function DeviceNotice() {
  const touchOnly = useSyncExternalStore(subscribeTouchOnly, isTouchOnly);
  const [dismissed, setDismissed] = useState(() => savedNotice.get() !== null);
  if (!touchOnly || dismissed) return null;
  return (
    <section
      aria-labelledby="device-notice-title"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto grid max-w-[420px] gap-3 rounded-[6px] border border-border-strong bg-surface p-4 text-fg shadow-lg"
    >
      <h2
        id="device-notice-title"
        className="m-0 flex items-center gap-2 text-base font-semibold"
      >
        <Monitor size={16} aria-hidden="true" className="text-fg-muted" />
        Best on a computer
      </h2>
      <p className="m-0 text-sm text-fg-soft">
        Building and playing maps needs a keyboard and mouse. Look around here,
        then open Wadsmith on a computer to make your own.
      </p>
      <button
        type="button"
        className="button justify-self-start"
        onClick={() => {
          savedNotice.set("1");
          setDismissed(true);
        }}
      >
        Got it
      </button>
    </section>
  );
}

export { DeviceNotice };
