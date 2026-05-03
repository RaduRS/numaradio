// /live?broadcast=1 is loaded as a Browser Source by OBS Studio on the
// Windows host — that's the live encoder pushing to YouTube (since
// 2026-05-01). The WSL numa-youtube-encoder.service is a cold fallback
// only. Pushing a code change to this page won't reach YouTube until
// the OBS Browser Source is refreshed (right-click → Properties →
// "Refresh cache of current page"). The hooks under _components also
// detect ?broadcast=1 to bypass the visibility gate + edge cache so
// the encoder shows track changes within seconds.
import type { Metadata } from "next";
import { BroadcastStage } from "../_components/BroadcastStage";

export const metadata: Metadata = {
  title: "Numa Radio · 24/7 Live",
  description:
    "Live YouTube broadcast stage — same booth, full bleed, always on.",
  alternates: { canonical: "/live" },
  // No need to be indexed; the YouTube watch page is the public surface.
  robots: { index: false, follow: false },
};

export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<{ broadcast?: string }>;
}) {
  const params = await searchParams;
  const isBroadcast = params.broadcast === "1";
  return <BroadcastStage broadcast={isBroadcast} />;
}
