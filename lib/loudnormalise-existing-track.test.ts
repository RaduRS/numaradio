import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loudnormaliseExistingTrack } from "./loudnormalise-existing-track.ts";

interface FakeTrack {
  id: string;
  title: string;
  sourceType: string;
  airingPolicy: string;
  loudnessLufs: number | null;
  assets: { assetType: string; storageKey: string; publicUrl: string }[];
}

interface FakePrismaWithCapture {
  track: {
    findUnique: (args: { where: { id: string }; include?: unknown }) => Promise<FakeTrack | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<FakeTrack>;
  };
  _captured: () => Record<string, unknown> | null;
}

function makePrisma(track: FakeTrack | null): FakePrismaWithCapture {
  let updated: Record<string, unknown> | null = null;
  return {
    track: {
      findUnique: async () => track,
      update: async ({ data }) => { updated = data; return { ...(track as FakeTrack), ...(data as object) }; },
    },
    _captured: () => updated,
  };
}

const baseTrack: FakeTrack = {
  id: "trk1",
  title: "Some Song",
  sourceType: "minimax_request",
  airingPolicy: "library",
  loudnessLufs: null,
  assets: [{
    assetType: "audio_stream",
    storageKey: "stations/numaradio/tracks/trk1/audio/stream.mp3",
    publicUrl: "https://numaradio.example/x.mp3",
  }],
};

describe("loudnormaliseExistingTrack", () => {
  test("skipped: voice — external_import + request_only + Shoutout title", async () => {
    const t = { ...baseTrack, sourceType: "external_import", airingPolicy: "request_only", title: "Shoutout from Lara" };
    const prisma = makePrisma(t);
    const r = await loudnormaliseExistingTrack(prisma as unknown as never, "trk1", {
      fetchImpl: async () => new Response(new Uint8Array(10), { status: 200 }),
      headImpl: async () => true,
      putOriginalImpl: async () => undefined,
      putCanonicalImpl: async () => undefined,
      loudnormImpl: async () => ({ buffer: Buffer.alloc(10), measurement: { inputI: -10, inputTp: -1, inputLra: 5, outputI: -14, outputTp: -1 } }),
      cfPurgeImpl: async () => ({ skipped: "no_creds" }),
    });
    assert.deepEqual(r, { skipped: "voice" });
  });

  test("skipped: already_done — loudnessLufs not null", async () => {
    const t = { ...baseTrack, loudnessLufs: -14.1 };
    const prisma = makePrisma(t);
    const r = await loudnormaliseExistingTrack(prisma as unknown as never, "trk1", {} as never);
    assert.deepEqual(r, { skipped: "already_done" });
  });

  test("skipped: missing_asset — no audio_stream asset", async () => {
    const t = { ...baseTrack, assets: [] };
    const prisma = makePrisma(t);
    const r = await loudnormaliseExistingTrack(prisma as unknown as never, "trk1", {} as never);
    assert.deepEqual(r, { skipped: "missing_asset" });
  });

  test("skipped: not_found — Track row missing", async () => {
    const prisma = makePrisma(null);
    const r = await loudnormaliseExistingTrack(prisma as unknown as never, "trk1", {} as never);
    assert.deepEqual(r, { skipped: "not_found" });
  });

  test("happy path: writes loudness fields and uploads original + canonical", async () => {
    const t = { ...baseTrack };
    const prisma = makePrisma(t);
    let originalPut = false;
    let canonicalPut = false;
    let purgedUrls: string[] = [];

    const r = await loudnormaliseExistingTrack(prisma as unknown as never, "trk1", {
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
      headImpl: async () => false, // original not yet present
      putOriginalImpl: async () => { originalPut = true; },
      putCanonicalImpl: async () => { canonicalPut = true; },
      loudnormImpl: async () => ({
        buffer: Buffer.from([4, 5, 6]),
        measurement: { inputI: -10.0, inputTp: -0.5, inputLra: 6.0, outputI: -14.0, outputTp: -1.0 },
      }),
      cfPurgeImpl: async (urls) => { purgedUrls = urls; return { ok: true }; },
    });

    assert.deepEqual(r, { ok: true, measurement: { inputI: -10.0, inputTp: -0.5, inputLra: 6.0, outputI: -14.0, outputTp: -1.0 } });
    assert.equal(originalPut, true);
    assert.equal(canonicalPut, true);
    assert.deepEqual(purgedUrls, ["https://numaradio.example/x.mp3"]);
    const captured = prisma._captured();
    assert.equal(captured?.loudnessLufs, -14.0);
    assert.equal(captured?.loudnessTruePeakDbtp, -1.0);
    assert.equal(captured?.loudnessSourceLufs, -10.0);
  });

  test("idempotent: skips uploading original when HEAD returns true", async () => {
    const t = { ...baseTrack };
    const prisma = makePrisma(t);
    let originalPut = false;
    await loudnormaliseExistingTrack(prisma as unknown as never, "trk1", {
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
      headImpl: async () => true, // already present
      putOriginalImpl: async () => { originalPut = true; },
      putCanonicalImpl: async () => undefined,
      loudnormImpl: async () => ({ buffer: Buffer.alloc(3), measurement: { inputI: -10, inputTp: -1, inputLra: 5, outputI: -14, outputTp: -1 } }),
      cfPurgeImpl: async () => ({ skipped: "no_creds" }),
    });
    assert.equal(originalPut, false, "should not re-upload original when HEAD says it exists");
  });

  test("loudnorm failure: returns { error: ... }, does not update Track row", async () => {
    const t = { ...baseTrack };
    const prisma = makePrisma(t);
    const r = await loudnormaliseExistingTrack(prisma as unknown as never, "trk1", {
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
      headImpl: async () => true,
      putOriginalImpl: async () => undefined,
      putCanonicalImpl: async () => undefined,
      loudnormImpl: async () => { throw new Error("ffmpeg blew up"); },
      cfPurgeImpl: async () => ({ skipped: "no_creds" }),
    });
    assert.equal("error" in r, true);
    if ("error" in r) assert.match(r.error, /ffmpeg blew up/);
    const captured = prisma._captured();
    assert.equal(captured, null, "Track row should not be updated on loudnorm failure");
  });
});
