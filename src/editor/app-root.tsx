import { usePathname } from "next/navigation";

import { CoopJoin } from "@/engine/join-room";
import { parseRoomCode } from "@/engine/room";
import { EpisodeScreen } from "@/episodes/episode-screen";
import { DeviceNotice } from "./device-notice";

function AppRoot() {
  const joining = /^\/join\/([^/]+)\/?$/.exec(usePathname());
  const code = joining ? parseRoomCode(decodeURIComponent(joining[1])) : null;
  return (
    <>
      {code ? <CoopJoin code={code} /> : <EpisodeScreen />}
      <DeviceNotice />
    </>
  );
}

export { AppRoot };
