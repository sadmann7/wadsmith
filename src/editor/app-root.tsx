import { CoopJoin } from "../engine/coop-panel";
import { ProjectApp } from "../projects/project-app";

function AppRoot() {
  const roomId = new URLSearchParams(location.search).get("join");
  return roomId ? <CoopJoin roomId={roomId} /> : <ProjectApp />;
}

export { AppRoot };
