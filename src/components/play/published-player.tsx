import Link from "next/link";
import * as React from "react";

import type { Complevel } from "@/lib/map/types";

import { GameView } from "@/components/play/play-panel";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { type PublishedMap, readPublished } from "@/lib/episodes/published";
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
      exit="maps"
      onExit={() => location.assign("/maps")}
    />
  );
}
