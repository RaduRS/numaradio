// Probe each TrackAsset URL with a HEAD request and report
// Cloudflare's cf-cache-status header. Tells you whether the CDN
// is doing its job — every HIT means zero B2 Class B transactions
// for that file.
//
// HEAD requests against the CDN are themselves served from cache
// (no B2 hit), so this script is cheap to run repeatedly.
//
// Run: npx tsx scripts/check-cdn-hit-ratio.ts

import "../lib/load-env.ts";
import { PrismaClient } from "@prisma/client";

const CONCURRENCY = 8;

async function head(url: string): Promise<{ status: number; cf: string; age: number }> {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return {
      status: r.status,
      cf: r.headers.get("cf-cache-status") ?? "—",
      age: parseInt(r.headers.get("age") ?? "0", 10),
    };
  } catch {
    return { status: 0, cf: "FETCH_ERR", age: 0 };
  }
}

async function pmap<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (true) {
        const j = i++;
        if (j >= items.length) return;
        out[j] = await fn(items[j]);
      }
    }),
  );
  return out;
}

async function main() {
  const p = new PrismaClient();
  const assets = await p.trackAsset.findMany({
    select: { publicUrl: true, assetType: true, track: { select: { title: true } } },
  });
  await p.$disconnect();

  const valid = assets.filter((a): a is typeof a & { publicUrl: string } => !!a.publicUrl);
  console.log(`Probing ${valid.length} URLs (${CONCURRENCY} concurrent)…`);

  const results = await pmap(valid, CONCURRENCY, async (a) => {
    const r = await head(a.publicUrl!);
    return { url: a.publicUrl!, kind: a.assetType, title: a.track.title, ...r };
  });

  const byKind: Record<string, Record<string, number>> = {};
  for (const r of results) {
    const kind = r.kind ?? "unknown";
    byKind[kind] ??= {};
    byKind[kind][r.cf] = (byKind[kind][r.cf] ?? 0) + 1;
  }

  console.log("\nCloudflare cf-cache-status by asset type:");
  for (const [kind, counts] of Object.entries(byKind)) {
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    const hit = counts["HIT"] ?? 0;
    const ratio = total === 0 ? 0 : Math.round((hit / total) * 100);
    console.log(`  ${kind}: ${total} files · ${ratio}% HIT`);
    for (const [status, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${status.padEnd(12)} ${n}`);
    }
  }

  // Drill into anything that's not cached cleanly
  const problems = results.filter(
    (r) => r.cf !== "HIT" && r.cf !== "REVALIDATED" && r.status === 200,
  );
  if (problems.length > 0) {
    console.log(`\n${problems.length} non-HIT URLs (each one is a B2 Class B txn next time it's loaded):`);
    for (const r of problems.slice(0, 20)) {
      console.log(`  [${r.cf}] ${r.kind}  "${r.title}"`);
    }
    if (problems.length > 20) console.log(`  … ${problems.length - 20} more`);
  }

  console.log("\nKey:");
  console.log("  HIT          ✓ served from CF edge, no B2 hit");
  console.log("  MISS         ✗ first request — fetched from B2 just now and cached for next time");
  console.log("  EXPIRED      ✗ TTL ran out, refetched from B2 (shouldn't happen with 1y immutable)");
  console.log("  DYNAMIC      ✗ CF chose not to cache (fix with Cache Everything page rule)");
  console.log("  REVALIDATED  ~ CF asked B2 'still fresh?' — small Class B but no body transfer");
  console.log("  BYPASS       ✗ a CF rule explicitly told it not to cache");
}

main().catch((e) => { console.error(e); process.exit(1); });
