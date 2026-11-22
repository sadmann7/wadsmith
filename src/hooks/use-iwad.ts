import * as React from "react";

import { type Iwad, loadIwad, onIwadChange } from "@/lib/engine/iwad";

// The IWAD in use, or null until it has loaded. Changing it reloads here.
export function useIwad() {
  const [iwad, setIwad] = React.useState<Iwad | null>(null);
  React.useEffect(() => {
    let active = true;
    // A slow load that finishes after a change must not undo the change.
    let run = 0;
    const load = () => {
      const current = ++run;
      loadIwad()
        .then((next) => {
          if (active && current === run) setIwad(next);
        })
        .catch(() => {});
    };
    load();
    const stop = onIwadChange(load);
    return () => {
      active = false;
      stop();
    };
  }, []);
  return iwad;
}
