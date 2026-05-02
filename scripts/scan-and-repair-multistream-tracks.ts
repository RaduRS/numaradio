// Scan every TrackAsset audio_stream MP3 in B2; if it has more than
// one stream (e.g. the Suno-style embedded MJPEG cover art delivered
// as a "video stream"), remux to audio-only and re-upload to the
// same key. Same fix that resolved the 2026-05-02 "Stay → Silhouette"
// skip: Liquidsoap's content-type guard expects audio=pcm(stereo) and
// intermittently fails on dual-stream MP3s.
//
// Lossless (no re-encode), preserves duration + bitrate + ID3v2 tags.
// Updates TrackAsset.byteSize to match the new file size so bandwidth
// math doesn't drift.
//
// Dry-run by default. Pass --apply to write.
//
//   npx tsx scripts/scan-and-repair-multistream-tracks.ts          # report
//   npx tsx scripts/scan-and-repair-multistream-tracks.ts --apply  # repair

import "../lib/load-env.ts";
import { PrismaClient } from "@prisma/client";
import { putObject } from "../lib/storage/index.ts";
import { sanitizeMp3AudioOnly } from "../lib/sanitize-mp3-audio-only.ts";

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

// Bypass the Cloudflare CDN when fetching for scan — Cloudflare caches
// our `Cache-Control: immutable, max-age=31536000` responses for a year,
// so a freshly-uploaded repair won't appear in CDN edges immediately.
// Hit the B2 origin directly to see the current truth.
const B2_ORIGIN = "https://f003.backblazeb2.com/file/numaradio";
const CDN_PREFIX = process.env.B2_BUCKET_PUBLIC_URL ?? "https://cdn.numaradio.com/file/numaradio";
function originUrl(publicUrl: string): string {
  if (publicUrl.startsWith(CDN_PREFIX)) {
    return B2_ORIGIN + publicUrl.slice(CDN_PREFIX.length);
  }
  return publicUrl;
}

async function main() {
  const assets = await prisma.trackAsset.findMany({
    where: { assetType: "audio_stream" },
    select: {
      id: true,
      storageKey: true,
      publicUrl: true,
      byteSize: true,
      track: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  console.log(`Scanning ${assets.length} audio assets…\n`);

  const dirty: Array<{ id: string; key: string; title: string; oldBytes: number; newBytes: number; removed: number }> = [];
  let scanned = 0;
  for (const a of assets) {
    scanned++;
    if (!a.publicUrl) continue;
    let buf: Buffer;
    try {
      const res = await fetch(originUrl(a.publicUrl));
      if (!res.ok) {
        console.warn(`  [${scanned}/${assets.length}] HTTP ${res.status} for "${a.track.title}" — skipping`);
        continue;
      }
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      console.warn(`  [${scanned}/${assets.length}] fetch failed for "${a.track.title}": ${e instanceof Error ? e.message : "?"}`);
      continue;
    }
    let r;
    try {
      r = await sanitizeMp3AudioOnly(buf);
    } catch (e) {
      console.warn(`  [${scanned}/${assets.length}] sanitize failed for "${a.track.title}": ${e instanceof Error ? e.message : "?"}`);
      continue;
    }
    if (r.changed) {
      dirty.push({
        id: a.id,
        key: a.storageKey,
        title: a.track.title,
        oldBytes: buf.length,
        newBytes: r.buffer.length,
        removed: r.bytesRemoved,
      });
      process.stdout.write("✗");
      if (apply) {
        try {
          await putObject(a.storageKey, r.buffer, "audio/mpeg", "public, max-age=31536000, immutable");
          await prisma.trackAsset.update({ where: { id: a.id }, data: { byteSize: r.buffer.length } });
          process.stdout.write("✓");
        } catch (e) {
          process.stdout.write("!");
          console.error(`\n  upload failed for "${a.track.title}": ${e instanceof Error ? e.message : "?"}`);
        }
      }
    } else {
      process.stdout.write(".");
    }
    if (scanned % 50 === 0) process.stdout.write(`  [${scanned}]\n`);
  }
  console.log(`\n\nScanned: ${assets.length}`);
  console.log(`Multi-stream (need repair): ${dirty.length}`);
  if (dirty.length > 0) {
    console.log("\nFirst 15 dirty:");
    console.table(dirty.slice(0, 15).map(d => ({
      title: d.title.slice(0, 40),
      old_kb: Math.round(d.oldBytes / 1024),
      new_kb: Math.round(d.newBytes / 1024),
      removed_kb: Math.round(d.removed / 1024),
    })));
  }
  if (!apply) {
    console.log("\nDry-run. Pass --apply to repair + upload.");
  } else {
    console.log(`\nRepaired + uploaded: ${dirty.length}`);
    if (dirty.length > 0) {
      // Cloudflare caches `Cache-Control: immutable` for a year — without
      // a purge, Liquidsoap will keep serving the OLD broken files from
      // the CDN edge for up to 12 months. Try the API; if creds aren't
      // set, print the URLs so the operator can purge manually in the
      // Cloudflare dashboard (Caching → Purge Cache → Custom).
      const urls = await Promise.all(dirty.map(async (d) => {
        const a = await prisma.trackAsset.findUnique({ where: { id: d.id }, select: { publicUrl: true } });
        return a?.publicUrl ?? "";
      }));
      const validUrls = urls.filter(Boolean);
      const purged = await tryPurgeCloudflare(validUrls);
      if (purged) {
        console.log(`Purged ${validUrls.length} URLs from Cloudflare CDN.`);
      } else {
        console.log("\n⚠ Cloudflare CDN still has the OLD cached files (immutable, 1-year TTL).");
        console.log("Set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID to auto-purge, OR purge these URLs manually in the CF dashboard:");
        for (const u of validUrls) console.log(`  ${u}`);
      }
    }
  }
  await prisma.$disconnect();
}

async function tryPurgeCloudflare(urls: string[]): Promise<boolean> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zone) return false;
  // Cloudflare's purge_cache endpoint accepts up to 30 files per call.
  for (let i = 0; i < urls.length; i += 30) {
    const batch = urls.slice(i, i + 30);
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ files: batch }),
    });
    if (!res.ok) {
      console.error(`CF purge HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return false;
    }
  }
  return true;
}

main().catch(e => { console.error(e); process.exit(1); });
