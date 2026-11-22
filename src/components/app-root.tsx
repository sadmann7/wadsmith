import { usePathname } from "next/navigation";

import { EpisodeScreen } from "@/components/episodes/episode-screen";
import { CoopJoin } from "@/components/play/join-room";
import { parseRoomCode } from "@/lib/engine/room";

import { DeviceNotice } from "./device-notice";

export function AppRoot() {
  const joining = /^\/join\/([^/]+)\/?$/.exec(usePathname());
  const code = joining ? parseRoomCode(decodeURIComponent(joining[1])) : null;
  return (
    <>
      {code ? <CoopJoin code={code} /> : <EpisodeScreen />}
      <DeviceNotice />
    </>
  );
}
