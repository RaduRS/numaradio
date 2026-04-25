// One-shot migration: rewrite TrackAsset.publicUrl from the raw B2 hostname
// to the Cloudflare-proxied CDN hostname. Idempotent (safe to run twice).
//
//   OLD: https://f003.backblazeb2.com/file/numaradio/<key>
//   NEW: https://cdn.numaradio.com/file/numaradio/<key>
//
// Rationale: Cloudflare edge-caches artwork + audio (Cache-Control was set
// in scripts/backfill-b2-cache-control.ts), cutting B2 egress. See HANDOFF
// "Cloudflare CDN in front of B2 — LIVE" section.

import "../lib/load-env";
import { prisma } from "../lib/db";

const OLD_PREFIX = "https://f003.backblazeb2.com/file/numaradio/";
const NEW_PREFIX = "https://cdn.numaradio.com/file/numaradio/";

async function main(): Promise<void> {
  const rows = await prisma.$executeRawUnsafe(
    `UPDATE "TrackAsset"
        SET "publicUrl" = REPLACE("publicUrl", $1, $2)
      WHERE "publicUrl" LIKE $3`,
    OLD_PREFIX,
    NEW_PREFIX,
    `${OLD_PREFIX}%`,
  );
  console.log(`Updated ${rows} TrackAsset rows.`);

  const sample = await prisma.trackAsset.findFirst({
    where: { publicUrl: { startsWith: NEW_PREFIX } },
    select: { storageKey: true, publicUrl: true },
  });
  if (sample) {
    console.log(`Sample after migration: ${sample.publicUrl}`);
  }

  const stragglers = await prisma.trackAsset.count({
    where: { publicUrl: { startsWith: OLD_PREFIX } },
  });
  if (stragglers > 0) {
    console.warn(`WARNING: ${stragglers} rows still reference ${OLD_PREFIX}`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
