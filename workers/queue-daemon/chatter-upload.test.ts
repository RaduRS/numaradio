import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadChatterAudio } from "./chatter-upload.ts";

interface RecordedPut {
  Bucket: string;
  Key: string;
  Body: unknown;
  ContentType: string;
  CacheControl: string;
}

function fakeS3() {
  const calls: RecordedPut[] = [];
  return {
    calls,
    client: {
      async send(cmd: { input: RecordedPut }) {
        calls.push(cmd.input);
      },
    },
  };
}

test("uploadChatterAudio calls PutObjectCommand with immutable cache-control", async () => {
  const s3 = fakeS3();
  const url = await uploadChatterAudio(
    Buffer.from([0xff, 0xfb]),
    "chatter-abc123",
    {
      bucket: "numaradio",
      publicBaseUrl: "https://cdn.numaradio.com/file/numaradio",
      s3: s3.client as never,
    },
  );
  assert.equal(s3.calls.length, 1);
  const put = s3.calls[0];
  assert.equal(put.Bucket, "numaradio");
  assert.equal(put.Key, "stations/numaradio/chatter/chatter-abc123.mp3");
  assert.equal(put.ContentType, "audio/mpeg");
  assert.equal(put.CacheControl, "public, max-age=31536000, immutable");
  assert.equal(
    url,
    "https://cdn.numaradio.com/file/numaradio/stations/numaradio/chatter/chatter-abc123.mp3",
  );
});

test("uploadChatterAudio propagates S3 errors", async () => {
  const client = { async send() { throw new Error("b2 down"); } };
  await assert.rejects(
    () =>
      uploadChatterAudio(Buffer.from([0]), "x", {
        bucket: "b",
        publicBaseUrl: "https://cdn.example.com",
        s3: client as never,
      }),
    /b2 down/,
  );
});
