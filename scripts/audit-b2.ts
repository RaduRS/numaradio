import "../lib/load-env";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { s3, bucket } from "../lib/storage/client";
import { prisma } from "../lib/db";

type Obj = { Key: string; Size: number; LastModified?: Date };

async function listAllObjects(): Promise<Obj[]> {
  const out: Obj[] = [];
  let continuationToken: string | undefined;
  let pages = 0;

  do {
    const res = await s3().send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );
    for (const o of res.Contents ?? []) {
      if (!o.Key) continue;
      out.push({
        Key: o.Key,
        Size: o.Size ?? 0,
        LastModified: o.LastModified,
      });
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    pages++;
  } while (continuationToken);

  console.log(`(listed ${out.length} objects in ${pages} page(s))`);
  return out;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

async function main() {
  console.log("Listing all B2 objects…");
  const objects = await listAllObjects();

  const totalBytes = objects.reduce((s, o) => s + o.Size, 0);
  console.log(`\nTotal: ${objects.length} objects, ${fmtBytes(totalBytes)}\n`);

  const byPrefix = new Map<string, { count: number; bytes: number }>();
  for (const o of objects) {
    const prefix = o.Key.split("/")[0] || "(root)";
    const cur = byPrefix.get(prefix) ?? { count: 0, bytes: 0 };
    cur.count++;
    cur.bytes += o.Size;
    byPrefix.set(prefix, cur);
  }
  console.log("By top-level prefix:");
  for (const [prefix, { count, bytes }] of [...byPrefix.entries()].sort()) {
    console.log(`  ${prefix.padEnd(20)} ${String(count).padStart(5)} objs  ${fmtBytes(bytes)}`);
  }

  const dbAssets = await prisma.trackAsset.findMany({
    select: { storageKey: true, trackId: true, assetType: true },
  });
  const dbKeys = new Set(dbAssets.map((a) => a.storageKey));
  console.log(`\nDB has ${dbKeys.size} TrackAsset storageKeys`);

  const b2Keys = new Set(objects.map((o) => o.Key));
  const orphans = objects.filter((o) => !dbKeys.has(o.Key));
  const missing = [...dbKeys].filter((k) => !b2Keys.has(k));

  console.log(`\n▸ B2 objects NOT referenced by any DB TrackAsset: ${orphans.length}`);
  if (orphans.length) {
    const orphanBytes = orphans.reduce((s, o) => s + o.Size, 0);
    console.log(`  (total: ${fmtBytes(orphanBytes)})`);
    console.log(`  Sample (up to 30, oldest first):`);
    orphans
      .slice()
      .sort(
        (a, b) =>
          (a.LastModified?.getTime() ?? 0) - (b.LastModified?.getTime() ?? 0),
      )
      .slice(0, 30)
      .forEach((o) => {
        console.log(
          `    ${o.LastModified?.toISOString().slice(0, 10) ?? "?"}  ${fmtBytes(o.Size).padStart(10)}  ${o.Key}`,
        );
      });
  }

  console.log(`\n▸ DB TrackAsset rows pointing to MISSING B2 keys: ${missing.length}`);
  if (missing.length) {
    console.log(`  Sample:`);
    missing.slice(0, 20).forEach((k) => console.log(`    ${k}`));
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
