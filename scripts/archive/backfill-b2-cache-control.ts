import "../lib/load-env";
import {
  CopyObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { prisma } from "../lib/db";

const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

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

interface Counts {
  total: number;
  alreadySet: number;
  updated: number;
  missing: number;
  errored: number;
}

async function processKey(
  key: string,
  mimeType: string | null,
  counts: Counts,
): Promise<void> {
  let head;
  try {
    head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name;
    if (name === "NotFound" || name === "NoSuchKey") {
      counts.missing += 1;
      console.log(`  missing: ${key}`);
      return;
    }
    counts.errored += 1;
    console.error(`  head failed for ${key}:`, err);
    return;
  }

  if (head.CacheControl === IMMUTABLE_CACHE_CONTROL) {
    counts.alreadySet += 1;
    return;
  }

  const contentType = head.ContentType ?? mimeType ?? "application/octet-stream";
  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: key,
        CopySource: `/${bucket}/${encodeURIComponent(key)}`,
        MetadataDirective: "REPLACE",
        CacheControl: IMMUTABLE_CACHE_CONTROL,
        ContentType: contentType,
      }),
    );
    counts.updated += 1;
    if (counts.updated % 10 === 0) {
      console.log(`  ${counts.updated} updated so far...`);
    }
  } catch (err) {
    counts.errored += 1;
    console.error(`  copy failed for ${key}:`, err);
  }
}

async function main(): Promise<void> {
  const assets = await prisma.trackAsset.findMany({
    where: { storageProvider: "b2" },
    select: { storageKey: true, mimeType: true, assetType: true },
    orderBy: { createdAt: "asc" },
  });

  const counts: Counts = {
    total: assets.length,
    alreadySet: 0,
    updated: 0,
    missing: 0,
    errored: 0,
  };

  console.log(`Backfilling Cache-Control on ${counts.total} B2 objects...`);
  for (const asset of assets) {
    await processKey(asset.storageKey, asset.mimeType, counts);
  }

  console.log("\nDone.");
  console.log(`  total       : ${counts.total}`);
  console.log(`  already set : ${counts.alreadySet}`);
  console.log(`  updated     : ${counts.updated}`);
  console.log(`  missing     : ${counts.missing}`);
  console.log(`  errored     : ${counts.errored}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
