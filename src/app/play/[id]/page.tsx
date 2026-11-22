import type { Metadata } from "next";

import { EditorLoader } from "@/components/editor-loader";

export const metadata: Metadata = {
  title: "Play a map",
  description: "Play a Doom map made in Wadsmith, right in your browser.",
};

export default function PublishedMapPage() {
  return <EditorLoader />;
}
