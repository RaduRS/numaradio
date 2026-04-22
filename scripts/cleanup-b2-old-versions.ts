// One-shot cleanup: after the backfill-b2-cache-control.ts migration added a
// new version of every object (with Cache-Control headers), the pre-backfill
// versions linger as hidden older versions. They aren't served by the public
// URL (B2 always serves IsLatest=true) but still consume storage. This script
// deletes them by (Key, VersionId).

import "../lib/load-env";
import {
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const s3 = new S3Client({
  region: getEnv("B2_REGION"),
  endpoint: getEnv("B2_ENDPOINT"),
  credentials: {
    accessKeyId: getEnv("B2_ACCESS_KEY_ID"),
    secretAccessKey: getEnv("B2_SECRET_ACCESS_KEY"),
  },
});
const bucket = getEnv("B2_BUCKET_NAME");

async function main(): Promise<void> {
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  const stale: { Key: string; VersionId: string }[] = [];

  do {
    const r = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }),
    );
    for (const v of r.Versions ?? []) {
      if (v.IsLatest) continue;
      if (!v.Key || !v.VersionId) continue;
      stale.push({ Key: v.Key, VersionId: v.VersionId });
    }
    keyMarker = r.IsTruncated ? r.NextKeyMarker : undefined;
    versionIdMarker = r.IsTruncated ? r.NextVersionIdMarker : undefined;
  } while (keyMarker);

  console.log(`Found ${stale.length} stale versions to delete.`);

  let deleted = 0;
  let failed = 0;
  for (const obj of stale) {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: obj.Key,
          VersionId: obj.VersionId,
        }),
      );
      deleted += 1;
      if (deleted % 20 === 0) console.log(`  ${deleted} deleted...`);
    } catch (err) {
      failed += 1;
      console.error(`  failed: ${obj.Key} (${obj.VersionId}):`, err);
    }
  }

  console.log(`\nDone. deleted=${deleted} failed=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
