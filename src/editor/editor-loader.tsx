"use client";

import dynamic from "next/dynamic";

// The editor reads browser storage and canvas APIs from its first render.
const ProjectApp = dynamic(
  () => import("../projects/project-app").then((app) => app.ProjectApp),
  {
    ssr: false,
    loading: () => (
      <div className="editor-loading" role="status">
        Loading editor…
      </div>
    ),
  },
);

function EditorLoader() {
  return <ProjectApp />;
}

export { EditorLoader };
