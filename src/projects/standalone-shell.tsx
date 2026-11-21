"use client";

import { useEffect, useState, type ReactNode } from "react";

import { AppShell } from "./app-sidebar";
import type { Project } from "./project-data";
import { openProjectStore } from "./project-store";

function StandaloneShell({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [durable, setDurable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    openProjectStore()
      .then(async (store) => {
        const listed = await store.listProjects();
        const nextCounts = Object.fromEntries(
          await Promise.all(
            listed.map(
              async (item) =>
                [item.id, await store.countMaps(item.id)] as const,
            ),
          ),
        );
        if (cancelled) return;
        setProjects(listed);
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
    <AppShell sidebar={{ projects, counts, current: null, durable }}>
      {children}
    </AppShell>
  );
}

export { StandaloneShell };
