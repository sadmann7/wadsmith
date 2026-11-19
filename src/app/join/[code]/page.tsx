import type { Metadata } from "next";

import { EditorLoader } from "@/editor/editor-loader";

export const metadata: Metadata = {
  title: "Join a game",
  description:
    "Join a game of Doom in your browser, on a map made in Wadsmith.",
};

export default function JoinPage() {
  return <EditorLoader />;
}
