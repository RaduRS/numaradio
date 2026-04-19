import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
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
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
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
