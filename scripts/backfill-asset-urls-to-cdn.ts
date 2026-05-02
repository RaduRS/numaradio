// Rewrite TrackAsset.publicUrl from B2 origin
// (https://f003.backblazeb2.com/file/numaradio/...) to the
// Cloudflare CDN equivalent (https://cdn.numaradio.com/file/numaradio/...).
// Same path, just the host swaps — the B2 object is unchanged.
//
// These rows were minted before B2_BUCKET_PUBLIC_URL was switched to
// the CDN. Every playback / dashboard render of an affected track
// goes direct to B2 (Class B charge, no edge cache). Rewriting puts
// them behind Cloudflare so subsequent requests are cache hits.
//
// Dry-run by default. Pass --apply to write.

import "../lib/load-env.ts";
import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");
const FROM_PREFIX = "https://f003.backblazeb2.com/file/numaradio";
const TO_PREFIX = process.env.B2_BUCKET_PUBLIC_URL ?? "https://cdn.numaradio.com/file/numaradio";

async function main() {
  const p = new PrismaClient();
  const assets = await p.trackAsset.findMany({
    where: { publicUrl: { startsWith: FROM_PREFIX } },
    select: { id: true, publicUrl: true, assetType: true, track: { select: { title: true } } },
  });
  console.log(`Assets with B2-origin publicUrl: ${assets.length}`);
  console.log(`  Will rewrite to: ${TO_PREFIX}/...`);
  for (const a of assets) {
    const newUrl = a.publicUrl!.replace(FROM_PREFIX, TO_PREFIX);
    console.log(`  [${a.assetType.padEnd(15)}] "${a.track.title}"`);
    console.log(`    ${a.publicUrl}`);
    console.log(`    → ${newUrl}`);
  }
  if (!apply) {
    console.log("\nDry-run. Pass --apply to rewrite.");
    await p.$disconnect();
    return;
  }
  let n = 0;
  for (const a of assets) {
    const newUrl = a.publicUrl!.replace(FROM_PREFIX, TO_PREFIX);
    await p.trackAsset.update({ where: { id: a.id }, data: { publicUrl: newUrl } });
    n++;
  }
  console.log(`\nRewrote ${n} TrackAsset publicUrl(s).`);
  await p.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
