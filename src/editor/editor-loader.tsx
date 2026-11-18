"use client";

import dynamic from "next/dynamic";

// The editor reads browser storage and canvas APIs from its first render.
const EditorApp = dynamic(
  () => import("./editor-app").then((editor) => editor.App),
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
  return <EditorApp />;
}

export { EditorLoader };
