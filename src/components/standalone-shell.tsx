"use client";

import * as React from "react";

import type { Episode } from "@/lib/episodes/episode-data";

import { useIwad } from "@/hooks/use-iwad";
import { defaultGame } from "@/lib/engine/game";
import { openEpisodeStore } from "@/lib/episodes/episode-store";

import { AppShell } from "./app-sidebar";

interface StandaloneShellProps {
  children: React.ReactNode;
}

export function StandaloneShell({ children }: StandaloneShellProps) {
  const [episodes, setEpisodes] = React.useState<Episode[]>([]);
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [durable, setDurable] = React.useState(true);
  const iwad = useIwad();

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
    <AppShell
      sidebar={{
        episodes,
        counts,
        current: null,
        durable,
        game: iwad?.game ?? defaultGame,
      }}
    >
      {children}
    </AppShell>
  );
}
