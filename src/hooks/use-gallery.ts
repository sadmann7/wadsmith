import * as React from "react";

import { type GalleryEntry, listGallery } from "@/lib/episodes/published";

// The newest published maps whose authors chose to list them, or null while
// they load or when there is no server to ask.
export function useGallery() {
  const [entries, setEntries] = React.useState<GalleryEntry[] | null>(null);
  React.useEffect(() => {
    let stale = false;
    listGallery()
      .then((found) => {
        if (!stale) setEntries(found);
      })
      .catch(() => {
        if (!stale) setEntries([]);
      });
    return () => {
      stale = true;
    };
  }, []);
  return entries;
}
