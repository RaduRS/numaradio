import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runLoudnormTick } from "./loudnorm-poller.ts";

interface FakePrisma {
  track: {
    findFirst: (args: unknown) => Promise<{ id: string; title: string } | null>;
  };
}

describe("runLoudnormTick", () => {
  test("idle: returns 'idle' when no pending rows", async () => {
    const prisma: FakePrisma = {
      track: { findFirst: async () => null },
    };
    let called = false;
    const result = await runLoudnormTick(prisma as unknown as never, {
      processImpl: async () => { called = true; return { ok: true, measurement: { inputI: -10, inputTp: -1, inputLra: 5, outputI: -14, outputTp: -1 } }; },
    });
    assert.equal(result, "idle");
    assert.equal(called, false);
  });

  test("processes oldest pending track and returns 'processed'", async () => {
    const prisma: FakePrisma = {
      track: { findFirst: async () => ({ id: "trk1", title: "Pending Song" }) },
    };
    let processedId = "";
    const result = await runLoudnormTick(prisma as unknown as never, {
      processImpl: async (_p, id) => {
        processedId = id;
        return { ok: true, measurement: { inputI: -10.0, inputTp: -1.0, inputLra: 5.0, outputI: -14.0, outputTp: -1.0 } };
      },
    });
    assert.equal(result, "processed");
    assert.equal(processedId, "trk1");
  });

  test("returns 'skipped' when helper says skipped", async () => {
    const prisma: FakePrisma = {
      track: { findFirst: async () => ({ id: "trk1", title: "Pending Song" }) },
    };
    const result = await runLoudnormTick(prisma as unknown as never, {
      processImpl: async () => ({ skipped: "voice" }),
    });
    assert.equal(result, "skipped");
  });

  test("returns 'failed' when helper errors, does not throw", async () => {
    const prisma: FakePrisma = {
      track: { findFirst: async () => ({ id: "trk1", title: "Pending Song" }) },
    };
    const result = await runLoudnormTick(prisma as unknown as never, {
      processImpl: async () => ({ error: "ffmpeg crashed" }),
    });
    assert.equal(result, "failed");
  });

  test("filters voice tracks in the SQL query (sourceType + airingPolicy + title)", async () => {
    let capturedWhere: Record<string, unknown> | null = null;
    const prisma: FakePrisma = {
      track: {
        findFirst: async (args) => {
          capturedWhere = (args as { where?: Record<string, unknown> }).where ?? null;
          return null;
        },
      },
    };
    await runLoudnormTick(prisma as unknown as never, { processImpl: async () => ({ skipped: "voice" }) });
    assert.notEqual(capturedWhere, null);
    if (!capturedWhere) return;
    assert.equal(capturedWhere.loudnessLufs, null);
    assert.ok(Array.isArray(capturedWhere.NOT) || typeof capturedWhere.NOT === "object", "expected a NOT clause excluding voice");
  });
});
