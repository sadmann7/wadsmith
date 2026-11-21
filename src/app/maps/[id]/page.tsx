import type { Metadata } from "next";

import { EditorLoader } from "@/editor/editor-loader";
import { featuredMaps } from "@/map/featured";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const entry = featuredMaps.find((item) => item.id === id);
  return entry
    ? { title: entry.title, description: entry.blurb }
    : { title: "Featured maps" };
}

export default function FeaturedMapPage() {
  return <EditorLoader />;
}
