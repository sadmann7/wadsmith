import type { Metadata } from "next";

import { EditorLoader } from "@/components/editor-loader";

export const metadata: Metadata = {
  title: "Featured maps",
  description:
    "Maps made in Wadsmith. Play one, bring friends, or open a copy to see how it's built.",
};

export default function FeaturedMapsPage() {
  return <EditorLoader />;
}
