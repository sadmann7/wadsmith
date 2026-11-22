import type { Metadata } from "next";

import { EditorLoader } from "@/components/editor-loader";

export const metadata: Metadata = {
  title: "Shared map",
  description: "Open a Doom map kept online with Wadsmith.",
};

export default function SharedMapPage() {
  return <EditorLoader />;
}
