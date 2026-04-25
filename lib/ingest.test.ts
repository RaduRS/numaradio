import { test } from "node:test";
import { strict as assert } from "node:assert";
import { _ingestTrackImpl } from "./ingest.ts";

function makeFakePrisma(opts: { existingSunoId?: string } = {}) {
  const trackId = "trk_test_1";
  return {
    track: {
      findFirst: async ({ where }: any) => {
        if (opts.existingSunoId && where.sourceReference === opts.existingSunoId) {
          return { id: "trk_existing" };
        }
        return null;
      },
    },
    $transaction: async (fn: any) =>
      fn({
        track: {
          create: async ({ data }: any) => ({ id: trackId, ...data }),
          update: async ({ data }: any) => ({ id: trackId, ...data }),
        },
        trackAsset: {
          create: async ({ data }: any) => ({ id: `asset_${Math.random()}`, ...data }),
        },
      }),
  };
}

test("ingestTrack happy path creates Track + audio asset", async () => {
  const fakePrisma = makeFakePrisma();
  const uploaded: { key: string }[] = [];
  const r = await _ingestTrackImpl({
    prisma: fakePrisma as any,
    putObject: async (key) => {
      uploaded.push({ key });
    },
    deleteObject: async () => {},
    publicUrl: (k) => `https://b2.example/${k}`,
    stationSlug: "numaradio",
    cacheControl: "public",
    input: {
      stationId: "station_1",
      audioBuffer: Buffer.from("fake"),
      show: "morning_room",
      title: "Test Song",
      durationSeconds: 180,
    },
  });
  assert.equal(r.status, "ingested");
  assert.equal(uploaded.length, 1);
  assert.match(uploaded[0].key, /\/audio\/stream\.mp3$/);
});

test("ingestTrack dedupe-by-sunoId returns skipped", async () => {
  const fakePrisma = makeFakePrisma({ existingSunoId: "abc-123" });
  const uploaded: { key: string }[] = [];
  const r = await _ingestTrackImpl({
    prisma: fakePrisma as any,
    putObject: async (key) => {
      uploaded.push({ key });
    },
    deleteObject: async () => {},
    publicUrl: (k) => k,
    stationSlug: "numaradio",
    cacheControl: "public",
    input: {
      stationId: "station_1",
      audioBuffer: Buffer.from("fake"),
      show: "morning_room",
      title: "Test",
      sunoId: "abc-123",
    },
  });
  assert.equal(r.status, "skipped");
  assert.equal(r.trackId, "trk_existing");
  assert.equal(uploaded.length, 0);
});

test("ingestTrack throws when show missing", async () => {
  const fakePrisma = makeFakePrisma();
  await assert.rejects(
    _ingestTrackImpl({
      prisma: fakePrisma as any,
      putObject: async () => {},
      deleteObject: async () => {},
      publicUrl: (k) => k,
      stationSlug: "numaradio",
      cacheControl: "public",
      input: {
        stationId: "station_1",
        audioBuffer: Buffer.from("fake"),
        show: undefined as any,
        title: "Test",
      },
    }),
    /show is required/i,
  );
});

test("ingestTrack rolls back B2 on tx failure", async () => {
  const deleted: string[] = [];
  const fakePrisma = {
    ...makeFakePrisma(),
    $transaction: async () => {
      throw new Error("simulated tx failure");
    },
  };
  await assert.rejects(
    _ingestTrackImpl({
      prisma: fakePrisma as any,
      putObject: async () => {},
      deleteObject: async (key: string) => {
        deleted.push(key);
      },
      publicUrl: (k) => k,
      stationSlug: "numaradio",
      cacheControl: "public",
      input: {
        stationId: "station_1",
        audioBuffer: Buffer.from("fake"),
        show: "morning_room",
        title: "Test",
      },
    }),
    /simulated tx failure/,
  );
  assert.equal(deleted.length, 1);
});

test("ingestTrack uploads artwork when provided", async () => {
  const fakePrisma = makeFakePrisma();
  const uploaded: { key: string }[] = [];
  await _ingestTrackImpl({
    prisma: fakePrisma as any,
    putObject: async (key) => {
      uploaded.push({ key });
    },
    deleteObject: async () => {},
    publicUrl: (k) => k,
    stationSlug: "numaradio",
    cacheControl: "public",
    input: {
      stationId: "station_1",
      audioBuffer: Buffer.from("fake"),
      show: "morning_room",
      title: "Test",
      artwork: { buffer: Buffer.from("png-bytes"), mimeType: "image/png" },
    },
  });
  assert.equal(uploaded.length, 2);
  assert.ok(uploaded.some((u) => u.key.includes("/artwork/primary.png")));
});

test("ingestTrack rolls back BOTH audio and artwork on tx failure", async () => {
  const deleted: string[] = [];
  const fakePrisma = {
    track: {
      findFirst: async () => null,
    },
    $transaction: async () => { throw new Error("simulated tx failure"); },
  };
  await assert.rejects(
    _ingestTrackImpl({
      prisma: fakePrisma as any,
      putObject: async () => {},
      deleteObject: async (key: string) => { deleted.push(key); },
      publicUrl: (k) => k,
      stationSlug: "numaradio",
      cacheControl: "public",
      input: {
        stationId: "station_1",
        audioBuffer: Buffer.from("fake"),
        show: "morning_room",
        title: "Test",
        artwork: { buffer: Buffer.from("png-bytes"), mimeType: "image/png" },
      },
    }),
    /simulated tx failure/,
  );
  assert.equal(deleted.length, 2, "both audio and artwork keys should be deleted");
  assert.ok(deleted.some((k) => k.includes("/audio/stream.mp3")), "audio key deleted");
  assert.ok(deleted.some((k) => k.includes("/artwork/primary.png")), "artwork key deleted");
});
