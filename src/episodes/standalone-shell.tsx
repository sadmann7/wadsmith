"use client";

import * as React from "react";

import { AppShell } from "./app-sidebar";
import type { Episode } from "./episode-data";
import { openEpisodeStore } from "./episode-store";

function StandaloneShell({ children }: { children: React.ReactNode }) {
  const [episodes, setEpisodes] = React.useState<Episode[]>([]);
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [durable, setDurable] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    openEpisodeStore()
      .then(async (store) => {
        const listed = await store.listEpisodes();
        const nextCounts = Object.fromEntries(
          await Promise.all(
            listed.map(
              async (item) =>
                [item.id, await store.countMaps(item.id)] as const,
            ),
          ),
        );
        if (cancelled) return;
        setEpisodes(listed);
        setCounts(nextCounts);
        setDurable(store.durable);
      })
      .catch(() => {
        if (!cancelled) setDurable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell sidebar={{ episodes, counts, current: null, durable }}>
      {children}
    </AppShell>
  );
}

export { StandaloneShell };
