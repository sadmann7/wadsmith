import Link from "next/link";
import * as React from "react";

import type { Complevel } from "@/lib/map/types";

import { GameView } from "@/components/play/play-panel";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { useIwad } from "@/hooks/use-iwad";
import { defaultGame, type GameId, games } from "@/lib/engine/game";
import {
  levelNumber,
  type PublishedMap,
  readPublished,
} from "@/lib/episodes/published";
import { complevels } from "@/lib/map/complevel";

type Loaded =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; details: PublishedMap; wad: Uint8Array };

interface PublishedPlayerProps {
  id: string;
}

export function PublishedPlayer({ id }: PublishedPlayerProps) {
  const [loaded, setLoaded] = React.useState<Loaded>({ kind: "loading" });
  const iwad = useIwad();
  React.useEffect(() => {
    let stale = false;
    readPublished(id)
      .then((found) => {
        if (stale) return;
        setLoaded(
          found
            ? { kind: "ready", ...found }
            : { kind: "failed", message: "That map isn't published here." },
        );
      })
      .catch((error: Error) => {
        if (!stale) setLoaded({ kind: "failed", message: error.message });
      });
    return () => {
      stale = true;
    };
  }, [id]);

  if (loaded.kind === "loading") {
    return (
      <div className="editor-loading" role="status">
        Loading the map…
      </div>
    );
  }
  if (loaded.kind === "failed") {
    return (
      <main className="grid min-h-dvh place-content-center gap-4 p-6">
        <Alert variant="destructive" role="alert">
          {loaded.message}
        </Alert>
        <Link className={buttonVariants({ variant: "primary" })} href="/maps">
          See the maps
        </Link>
      </main>
    );
  }
  const { details, wad } = loaded;
  if (!iwad) {
    return (
      <div className="editor-loading" role="status">
        Loading the game…
      </div>
    );
  }
  // A map made for Doom's episodes plays only on Doom's IWADs, and one made
  // for Doom II's numbered maps only on Doom II's.
  const made = games[details.game as GameId] ?? defaultGame;
  if (made.episodes > 0 !== iwad.game.episodes > 0) {
    return (
      <main className="grid min-h-dvh place-content-center gap-4 p-6">
        <Alert role="alert">
          {details.title} was made for {made.label}, and this browser plays{" "}
          {iwad.game.label}. Pick an IWAD like it on the maps page, then open
          the link again.
        </Alert>
        <Link className={buttonVariants({ variant: "primary" })} href="/maps">
          See the maps
        </Link>
      </main>
    );
  }
  const complevel = complevels.includes(details.complevel as Complevel)
    ? (details.complevel as Complevel)
    : "vanilla";
  return (
    <GameView
      map={null}
      files={{ wads: [wad], dehacked: [], complevel, warp: details.warp }}
      title={
        details.author ? `${details.title} by ${details.author}` : details.title
      }
      slot={details.maps[0]?.slot ?? "MAP01"}
      par={null}
      lastLevel={levelNumber(details.maps.at(-1)?.slot ?? "MAP01")}
      exit="maps"
      onExit={() => location.assign("/maps")}
    />
  );
}
