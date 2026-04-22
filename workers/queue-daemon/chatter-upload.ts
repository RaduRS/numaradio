import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export interface UploadDeps {
  bucket: string;
  publicBaseUrl: string;
  s3: S3Client;
}

export async function uploadChatterAudio(
  body: Buffer,
  chatterId: string,
  deps: UploadDeps,
): Promise<string> {
  const key = `stations/${STATION_SLUG}/chatter/${chatterId}.mp3`;
  await deps.s3.send(
    new PutObjectCommand({
      Bucket: deps.bucket,
      Key: key,
      Body: body,
      ContentType: "audio/mpeg",
      CacheControl: IMMUTABLE_CACHE_CONTROL,
    }),
  );
  const base = deps.publicBaseUrl.replace(/\/+$/, "");
  return `${base}/${key}`;
}
