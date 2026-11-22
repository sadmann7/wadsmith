import { usePathname } from "next/navigation";

import { EpisodeScreen } from "@/components/episodes/episode-screen";
import { CoopJoin } from "@/components/play/join-room";
import { PublishedPlayer } from "@/components/play/published-player";
import { parseRoomCode } from "@/lib/engine/room";
import { playTarget } from "@/lib/episodes/published";

import { DeviceNotice } from "./device-notice";

export function AppRoot() {
  const pathname = usePathname();
  const joining = /^\/join\/([^/]+)\/?$/.exec(pathname);
  const code = joining ? parseRoomCode(decodeURIComponent(joining[1])) : null;
  const published = playTarget(pathname);
  return (
    <>
      {published ? (
        <PublishedPlayer id={published} />
      ) : code ? (
        <CoopJoin code={code} />
      ) : (
        <EpisodeScreen />
      )}
      <DeviceNotice />
    </>
  );
}
