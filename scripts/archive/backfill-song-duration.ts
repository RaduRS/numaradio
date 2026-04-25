import "../lib/load-env.ts";
import { PrismaClient } from "@prisma/client";
import { parseBuffer } from "music-metadata";

async function main() {
  const prisma = new PrismaClient();
  const rows = await prisma.track.findMany({
    where: { durationSeconds: null, sourceType: "minimax_request" },
    select: {
      id: true,
      title: true,
      artistDisplay: true,
      assets: {
        where: { assetType: "audio_stream" },
        select: { publicUrl: true, id: true },
      },
    },
  });
  console.log("candidates:", rows.length);
  for (const t of rows) {
    const asset = t.assets[0];
    if (!asset?.publicUrl) { console.log("skip (no url):", t.id, t.title); continue; }
    try {
      const res = await fetch(asset.publicUrl);
      if (!res.ok) { console.log("fetch failed:", t.title, res.status); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const probed = await parseBuffer(buf, { mimeType: "audio/mpeg" });
      const secs = probed.format.duration ? Math.round(probed.format.duration) : null;
      if (!secs) { console.log("no duration:", t.title); continue; }
      await prisma.$transaction([
        prisma.track.update({ where: { id: t.id }, data: { durationSeconds: secs } }),
        prisma.trackAsset.update({ where: { id: asset.id }, data: { durationSeconds: secs } }),
      ]);
      console.log("backfilled:", t.title, "->", secs, "s");
    } catch (e) { console.log("error:", t.title, String(e)); }
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
