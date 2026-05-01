// One-shot: set CORS on the Numa Radio B2 bucket so the public submit
// form can PUT directly to B2 from numaradio.com without the browser
// blocking the cross-origin request. Run once after migrating to the
// direct-upload flow.
//
// Usage:
//   npx tsx scripts/set-b2-cors.ts
//   npx tsx scripts/set-b2-cors.ts --get   # just print current rules

import "../lib/load-env.ts";
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3";

const ALLOWED_ORIGINS = [
  "https://numaradio.com",
  "https://www.numaradio.com",
  "https://*.vercel.app", // preview deploys
];

async function main() {
  const region = process.env.B2_REGION ?? "";
  const endpoint = process.env.B2_ENDPOINT ?? "";
  const bucket = process.env.B2_BUCKET_NAME ?? "";
  if (!region || !endpoint || !bucket) {
    throw new Error("B2_REGION / B2_ENDPOINT / B2_BUCKET_NAME must all be set in .env.local");
  }

  const s3 = new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId: process.env.B2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.B2_SECRET_ACCESS_KEY ?? "",
    },
  });

  if (process.argv.includes("--get")) {
    try {
      const cur = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
      console.log(JSON.stringify(cur.CORSRules, null, 2));
    } catch (err) {
      console.log("(no CORS rules currently set)");
      console.error(err instanceof Error ? err.message : err);
    }
    return;
  }

  await s3.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ALLOWED_ORIGINS,
            AllowedMethods: ["PUT", "GET", "HEAD"],
            AllowedHeaders: ["content-type", "x-amz-*"],
            ExposeHeaders: ["etag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  console.log(`✓ CORS rules applied to bucket "${bucket}".`);
  console.log("Allowed origins:", ALLOWED_ORIGINS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
