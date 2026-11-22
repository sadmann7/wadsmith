import type { Metadata } from "next";

import { EditorLoader } from "@/components/editor-loader";
import { featuredMaps } from "@/lib/map/featured";

export async function generateMetadata({
  params,
}: PageProps<"/maps/[id]">): Promise<Metadata> {
  const { id } = await params;
  const entry = featuredMaps.find((item) => item.id === id);
  return entry
    ? { title: entry.title, description: entry.blurb }
    : { title: "Featured maps" };
}

export default function FeaturedMapPage() {
  return <EditorLoader />;
}
