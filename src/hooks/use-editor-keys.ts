import * as React from "react";

import {
  defaultKeys,
  getSavedKeys,
  resolveKeys,
  subscribeKeys,
} from "@/lib/editor/keymap";

export function useEditorKeys() {
  const saved = React.useSyncExternalStore(
    subscribeKeys,
    getSavedKeys,
    () => defaultKeys,
  );
  return React.useMemo(() => resolveKeys(saved), [saved]);
}
