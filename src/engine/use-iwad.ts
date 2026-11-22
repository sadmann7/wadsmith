import * as React from "react";

import { loadIwad, onIwadChange, type Iwad } from "./iwad";

// The IWAD in use, or null until it has loaded. Changing it reloads here.
function useIwad() {
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

export { useIwad };
