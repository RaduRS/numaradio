import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

let cached: S3Client | undefined;

export function s3(): S3Client {
  if (cached) return cached;
  cached = new S3Client({
    region: getEnv("B2_REGION"),
    endpoint: getEnv("B2_ENDPOINT"),
    credentials: {
      accessKeyId: getEnv("B2_ACCESS_KEY_ID"),
      secretAccessKey: getEnv("B2_SECRET_ACCESS_KEY"),
    },
  });
  return cached;
}

export const bucket = () => getEnv("B2_BUCKET_NAME");

export async function putObject(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
  cacheControl?: string,
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "name" in err &&
      (err as { name?: string }).name === "NotFound"
    )
      return false;
    throw err;
  }
}

/**
 * Read an object from B2 as a Buffer. Used by the dashboard approve
 * flow (which feeds the buffer to ingestTrack) and by the audio-preview
 * proxy route. For very large objects this loads the whole body into
 * memory — fine for our 10MB submission cap, would need streaming for
 * larger payloads.
 */
export async function getObject(key: string): Promise<Buffer> {
  const res = await s3().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
  );
  if (!res.Body) throw new Error(`empty body for ${key}`);
  // Body is a Readable stream in Node — collect into a Buffer
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
