import { CoopJoin } from "../engine/join-room";
import { parseRoomCode } from "../engine/room";
import { ProjectApp } from "../projects/project-app";

function AppRoot() {
  const joining = /^\/join\/([^/]+)\/?$/.exec(location.pathname);
  const code = joining ? parseRoomCode(decodeURIComponent(joining[1])) : null;
  return code ? <CoopJoin code={code} /> : <ProjectApp />;
}

export { AppRoot };
