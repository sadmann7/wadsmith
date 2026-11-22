"use client";

import dynamic from "next/dynamic";

// The editor reads browser storage and canvas APIs from its first render.
const AppRoot = dynamic(() => import("./app-root").then((app) => app.AppRoot), {
  ssr: false,
  loading: () => (
    <div className="editor-loading" role="status">
      Loading editor…
    </div>
  ),
});

export function EditorLoader() {
  return <AppRoot />;
}
