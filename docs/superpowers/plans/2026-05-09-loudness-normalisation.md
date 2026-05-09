# Loudness Normalisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalise every music track on Numa Radio to -14 LUFS via two-pass ffmpeg loudnorm at ingest time, with a Liquidsoap master safety net + Cloudflare cache purge + Postgres-polled trigger for Vercel-side submission approvals.

**Architecture:** New `lib/loudnorm.ts` wraps two-pass ffmpeg (measure → linear-mode apply). Inline at song-worker + ingest-seed (Orion-side ingestion). Schema gains 3 nullable Float fields on `Track` — NULL implicitly means "pending". Queue daemon polls `WHERE loudnessLufs IS NULL` every 60s for Vercel-created rows. Same shared helper drives the daemon poller AND the one-shot backfill script. Liquidsoap `normalize` + `limit` operators after `smooth_add` catch outliers.

**Tech Stack:** TypeScript (`tsx`), Node 22 native test runner (`node --test --experimental-strip-types`), Prisma (Postgres), AWS S3 SDK (B2), ffmpeg/ffprobe via `child_process.spawn` (codebase convention — never `exec*`), Liquidsoap 2.2.x.

**Spec:** `docs/superpowers/specs/2026-05-09-loudness-normalisation-design.md`

---

## File Structure

**Create:**
- `lib/loudnorm.ts` — pure two-pass ffmpeg helper, JSON parser
- `lib/loudnorm.test.ts` — unit tests (parser fixtures, no ffmpeg)
- `lib/loudnorm.integration.test.ts` — real ffmpeg on a fixture MP3
- `lib/loudnormalise-existing-track.ts` — shared helper (load → loudnorm → upload original → overwrite canonical → update row → CF purge)
- `lib/loudnormalise-existing-track.test.ts` — mocked unit tests
- `lib/cf-purge.ts` — small wrapper for Cloudflare cache purge API
- `lib/cf-purge.test.ts`
- `scripts/backfill-track-loudness.ts` — operator one-shot CLI
- `workers/queue-daemon/loudnorm-poller.ts` — daemon tick module
- `workers/queue-daemon/loudnorm-poller.test.ts`
- `prisma/migrations/<timestamp>_add_track_loudness/migration.sql`
- `lib/test-fixtures/loudnorm-pass1.txt` — captured ffmpeg stderr (pass 1)
- `lib/test-fixtures/loudnorm-pass2.txt` — captured ffmpeg stderr (pass 2)
- `lib/test-fixtures/pink-noise-5s.mp3` — small fixture audio (~50 KB)

**Modify:**
- `prisma/schema.prisma` — add 3 fields to `Track` model
- `workers/song-worker/pipeline.ts` — wedge loudnorm before B2 upload (line ~263)
- `scripts/ingest-seed.ts` — wedge loudnorm before B2 upload
- `workers/queue-daemon/index.ts` — start the loudnorm poller
- `liquidsoap/numa.liq` — insert master `normalize` + `limit` between line 279 and 297
- `docs/HANDOFF.md` — operator deploy note + remove reference to parked TODO
- `TODO.md` — remove the "Loudness normalisation across the catalogue" parked entry

---

## Task 1: Schema migration + Prisma model fields

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<auto-timestamp>_add_track_loudness/migration.sql`

- [ ] **Step 1: Edit `prisma/schema.prisma`** — find the `model Track {` block and add three nullable Float fields. Place them grouped together near the bottom of the model's scalar fields (before `@@index` lines).

```prisma
model Track {
  // ... existing fields ...

  // Loudness measurements set by lib/loudnorm.ts at ingest time, or
  // backfilled by scripts/backfill-track-loudness.ts /
  // workers/queue-daemon/loudnorm-poller.ts. NULL = not yet
  // normalised (the implicit pending signal for the daemon poller).
  loudnessLufs            Float?
  loudnessTruePeakDbtp    Float?
  loudnessSourceLufs      Float?

  // ... existing @@index lines ...
}
```

- [ ] **Step 2: Generate migration**

Run: `npx prisma migrate dev --name add_track_loudness --create-only`
Expected: prints `Created migration: prisma/migrations/<timestamp>_add_track_loudness/`

- [ ] **Step 3: Verify the generated SQL is exactly the additive ALTER TABLEs we expect** (no other column changes — guard against the 2026-05-05 incident where an unrelated schema change shipped accidentally)

Run: `cat prisma/migrations/*_add_track_loudness/migration.sql`

Expected output (column order may vary):

```sql
-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "loudnessLufs" DOUBLE PRECISION,
ADD COLUMN     "loudnessSourceLufs" DOUBLE PRECISION,
ADD COLUMN     "loudnessTruePeakDbtp" DOUBLE PRECISION;
```

If anything other than three `ADD COLUMN` lines appears: STOP, investigate, do not proceed.

- [ ] **Step 4: Apply locally**

Run: `npx prisma migrate dev`
Expected: `Database is now in sync with your schema.` Prisma client regenerated.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add Track.loudnessLufs/loudnessTruePeakDbtp/loudnessSourceLufs"
```

---

## Task 2: `lib/cf-purge.ts` — Cloudflare cache purge wrapper

**Files:**
- Create: `lib/cf-purge.ts`
- Create: `lib/cf-purge.test.ts`

- [ ] **Step 1: Write the failing tests** at `lib/cf-purge.test.ts`

```ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { purgeCloudflareCache } from "./cf-purge.ts";

describe("purgeCloudflareCache", () => {
  test("returns { skipped: 'no_creds' } when CF_API_TOKEN missing", async () => {
    const r = await purgeCloudflareCache(["https://numaradio.com/x.mp3"], {
      apiToken: "",
      zoneId: "z123",
      fetchImpl: async () => new Response("", { status: 200 }),
    });
    assert.deepEqual(r, { skipped: "no_creds" });
  });

  test("returns { skipped: 'no_creds' } when CF_ZONE_ID missing", async () => {
    const r = await purgeCloudflareCache(["https://numaradio.com/x.mp3"], {
      apiToken: "tok",
      zoneId: "",
      fetchImpl: async () => new Response("", { status: 200 }),
    });
    assert.deepEqual(r, { skipped: "no_creds" });
  });

  test("returns { skipped: 'empty_urls' } when given no URLs", async () => {
    const r = await purgeCloudflareCache([], {
      apiToken: "tok",
      zoneId: "z123",
      fetchImpl: async () => new Response("", { status: 200 }),
    });
    assert.deepEqual(r, { skipped: "empty_urls" });
  });

  test("returns { ok: true } on 200 from CF API", async () => {
    let calledUrl = "";
    let calledBody = "";
    const r = await purgeCloudflareCache(["https://numaradio.com/x.mp3"], {
      apiToken: "tok",
      zoneId: "z123",
      fetchImpl: async (url, init) => {
        calledUrl = String(url);
        calledBody = String(init?.body ?? "");
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      },
    });
    assert.deepEqual(r, { ok: true });
    assert.equal(calledUrl, "https://api.cloudflare.com/client/v4/zones/z123/purge_cache");
    assert.equal(calledBody, JSON.stringify({ files: ["https://numaradio.com/x.mp3"] }));
  });

  test("returns { error: ... } on non-200 (caller logs, doesn't throw)", async () => {
    const r = await purgeCloudflareCache(["https://numaradio.com/x.mp3"], {
      apiToken: "tok",
      zoneId: "z123",
      fetchImpl: async () => new Response("forbidden", { status: 403 }),
    });
    assert.equal("error" in r, true);
    if ("error" in r) assert.match(r.error, /403/);
  });

  test("returns { error: ... } on fetch throw", async () => {
    const r = await purgeCloudflareCache(["https://numaradio.com/x.mp3"], {
      apiToken: "tok",
      zoneId: "z123",
      fetchImpl: async () => { throw new Error("network down"); },
    });
    assert.equal("error" in r, true);
    if ("error" in r) assert.match(r.error, /network down/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --grep "purgeCloudflareCache"`
Expected: All 6 tests FAIL with "Cannot find module './cf-purge.ts'"

- [ ] **Step 3: Implement** at `lib/cf-purge.ts`

```ts
// Cloudflare cache purge wrapper — best-effort. Caller logs the result
// and continues regardless. Kept fetch-injectable so unit tests don't
// hit the real CF API.

export type CfPurgeResult =
  | { ok: true }
  | { skipped: "no_creds" | "empty_urls" }
  | { error: string };

export interface CfPurgeOpts {
  apiToken?: string;
  zoneId?: string;
  fetchImpl?: typeof fetch;
}

export async function purgeCloudflareCache(
  urls: string[],
  opts: CfPurgeOpts = {},
): Promise<CfPurgeResult> {
  const apiToken = opts.apiToken ?? process.env.CF_API_TOKEN ?? "";
  const zoneId = opts.zoneId ?? process.env.CF_ZONE_ID ?? "";
  const fetchImpl = opts.fetchImpl ?? fetch;

  if (!apiToken || !zoneId) return { skipped: "no_creds" };
  if (urls.length === 0) return { skipped: "empty_urls" };

  try {
    const res = await fetchImpl(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ files: urls }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { error: `CF purge HTTP ${res.status}: ${body.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (err) {
    return { error: String(err instanceof Error ? err.message : err) };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --grep "purgeCloudflareCache"`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/cf-purge.ts lib/cf-purge.test.ts
git commit -m "feat(loudnorm): add lib/cf-purge.ts wrapper"
```

---

## Task 3: `lib/loudnorm.ts` — capture stderr fixtures + parser tests

**Files:**
- Create: `lib/test-fixtures/loudnorm-pass1.txt`
- Create: `lib/test-fixtures/loudnorm-pass2.txt`
- Create: `lib/test-fixtures/pink-noise-5s.mp3`
- Create: `lib/loudnorm.test.ts` (parser tests only — integration test is Task 5)

**Why fixtures first:** The parser is the trickiest part — ffmpeg prints lots of noise around the JSON block. We need real fixtures so the test exercises the actual format ffmpeg emits.

- [ ] **Step 1: Generate the fixture MP3** (5-second pink noise — small, deterministic, no copyright)

Run:

```bash
mkdir -p lib/test-fixtures
ffmpeg -hide_banner -f lavfi -i "anoisesrc=color=pink:duration=5" \
  -c:a libmp3lame -b:a 192k -ar 44100 -ac 2 \
  lib/test-fixtures/pink-noise-5s.mp3
ls -la lib/test-fixtures/pink-noise-5s.mp3
```

Expected: file ~120 KB.

- [ ] **Step 2: Capture pass 1 stderr against the fixture**

Run:

```bash
ffmpeg -hide_banner -i lib/test-fixtures/pink-noise-5s.mp3 \
  -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json \
  -f null - 2> lib/test-fixtures/loudnorm-pass1.txt
tail -20 lib/test-fixtures/loudnorm-pass1.txt
```

Expected: a JSON block at the end with `input_i`, `input_tp`, `input_lra`, `input_thresh`, `target_offset`.

- [ ] **Step 3: Capture pass 2 stderr** (any sentinel measured values — we only need the format, not real measurements)

Run:

```bash
ffmpeg -hide_banner -i lib/test-fixtures/pink-noise-5s.mp3 \
  -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=-23:measured_TP=-2:measured_LRA=7:measured_thresh=-34:offset=0:linear=true:print_format=json" \
  -c:a libmp3lame -b:a 192k -f mp3 /dev/null 2> lib/test-fixtures/loudnorm-pass2.txt
tail -20 lib/test-fixtures/loudnorm-pass2.txt
```

Expected: a JSON block at the end including `output_i`, `output_tp` keys.

- [ ] **Step 4: Write the failing parser tests** at `lib/loudnorm.test.ts`

```ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLoudnormStderr } from "./loudnorm.ts";

const PASS1 = readFileSync(new URL("./test-fixtures/loudnorm-pass1.txt", import.meta.url), "utf8");
const PASS2 = readFileSync(new URL("./test-fixtures/loudnorm-pass2.txt", import.meta.url), "utf8");

describe("parseLoudnormStderr", () => {
  test("parses pass 1 stderr — input_i / input_tp / input_lra / input_thresh / target_offset", () => {
    const r = parseLoudnormStderr(PASS1);
    assert.notEqual(r, null);
    if (!r) return;
    assert.equal(typeof r.input_i, "number");
    assert.equal(typeof r.input_tp, "number");
    assert.equal(typeof r.input_lra, "number");
    assert.equal(typeof r.input_thresh, "number");
    assert.equal(typeof r.target_offset, "number");
  });

  test("parses pass 2 stderr — output_i / output_tp", () => {
    const r = parseLoudnormStderr(PASS2);
    assert.notEqual(r, null);
    if (!r) return;
    assert.equal(typeof r.output_i, "number");
    assert.equal(typeof r.output_tp, "number");
  });

  test("returns null when no JSON block present", () => {
    assert.equal(parseLoudnormStderr("ffmpeg version 6.x\nbuilt with..."), null);
  });

  test("returns null on malformed JSON inside braces", () => {
    assert.equal(parseLoudnormStderr("noise\n{not valid json}\nmore noise"), null);
  });

  test("picks the LAST JSON block when multiple present", () => {
    // ffmpeg sometimes emits earlier diagnostic JSON; we always want
    // the loudnorm output, which is last.
    const stderr = '{ "input_i" : -10.0, "input_tp" : -1.0, "input_lra" : 5.0, "input_thresh" : -20.0, "target_offset" : 4.0 }\nmore noise\n{ "input_i" : -20.0, "input_tp" : -2.0, "input_lra" : 8.0, "input_thresh" : -30.0, "target_offset" : 6.0 }';
    const r = parseLoudnormStderr(stderr);
    assert.notEqual(r, null);
    if (!r) return;
    assert.equal(r.input_i, -20.0);
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npm test -- --grep "parseLoudnormStderr"`
Expected: All 5 tests FAIL with "Cannot find module './loudnorm.ts'"

- [ ] **Step 6: Implement just the parser** at `lib/loudnorm.ts` (full module comes in Task 4)

```ts
// Two-pass ffmpeg loudnorm wrapper. Normalises an MP3 buffer to the
// EBU R128 / streaming-default loudness target (-14 LUFS by default,
// matching Spotify/YouTube/TikTok). Mirrors the spawn pattern from
// lib/sanitize-mp3-audio-only.ts. Streams stdin/stdout — never disk.
//
// Failure mode: any spawn / parse / exit failure throws. Callers should
// catch and fall back to the raw input buffer (so a listener never gets
// blocked on a loudnorm hiccup). Track.loudnessLufs stays NULL and the
// queue-daemon poller picks it up later.

import { spawn } from "node:child_process";

export interface LoudnormJsonPass1 {
  input_i: number;
  input_tp: number;
  input_lra: number;
  input_thresh: number;
  target_offset: number;
}

export interface LoudnormJsonPass2 {
  input_i: number;
  input_tp: number;
  input_lra: number;
  input_thresh: number;
  output_i: number;
  output_tp: number;
  output_lra: number;
  output_thresh: number;
  normalization_type: string;
  target_offset: number;
}

export type LoudnormJson = LoudnormJsonPass1 | Partial<LoudnormJsonPass2>;

/**
 * Extract the LAST JSON object from ffmpeg loudnorm stderr. Returns
 * null on no-block / malformed-JSON.
 */
export function parseLoudnormStderr(stderr: string): LoudnormJson | null {
  // ffmpeg's loudnorm prints lots of diagnostic lines, then a JSON
  // object as the final non-blank chunk of output. We scan from the
  // end for the last `{ ... }` block.
  const lastClose = stderr.lastIndexOf("}");
  if (lastClose === -1) return null;
  // Walk back to the matching `{` by depth counting.
  let depth = 0;
  let openIdx = -1;
  for (let i = lastClose; i >= 0; i--) {
    const ch = stderr[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      depth--;
      if (depth === 0) { openIdx = i; break; }
    }
  }
  if (openIdx === -1) return null;
  const candidate = stderr.slice(openIdx, lastClose + 1);
  try {
    const obj = JSON.parse(candidate);
    // Coerce string numbers ffmpeg sometimes emits as `"input_i" : "-23.45"`.
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === "string" && !isNaN(parseFloat(obj[k]))) {
        obj[k] = parseFloat(obj[k]);
      }
    }
    return obj as LoudnormJson;
  } catch {
    return null;
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- --grep "parseLoudnormStderr"`
Expected: All 5 tests PASS

- [ ] **Step 8: Commit**

```bash
git add lib/loudnorm.ts lib/loudnorm.test.ts lib/test-fixtures/
git commit -m "feat(loudnorm): add stderr parser + fixtures"
```

---

## Task 4: `lib/loudnorm.ts` — full `loudnormalise()` two-pass wrapper

**Files:**
- Modify: `lib/loudnorm.ts` (add the spawn wrapper functions + public API)

- [ ] **Step 1: Append the public API + helpers** to `lib/loudnorm.ts`

```ts
// ─── Public API ─────────────────────────────────────────────────────

export interface LoudnessMeasurement {
  inputI: number;        // pre-correction integrated LUFS
  inputTp: number;       // pre-correction true peak dBTP
  inputLra: number;      // pre-correction loudness range LU
  outputI: number;       // post-correction integrated LUFS (target ± 0.5)
  outputTp: number;      // post-correction true peak dBTP
}

export interface LoudnormResult {
  buffer: Buffer;
  measurement: LoudnessMeasurement;
}

export interface LoudnormOptions {
  /** Target integrated loudness in LUFS. Default -14. */
  targetI?: number;
  /** Target true peak in dBTP. Default -1. */
  targetTp?: number;
  /** Target loudness range in LU. Default 11. */
  targetLra?: number;
  /** Output MP3 bitrate (kbps). Default 192 — matches Icecast. */
  bitrateKbps?: number;
}

const DEFAULTS = {
  targetI: -14,
  targetTp: -1,
  targetLra: 11,
  bitrateKbps: 192,
};

/**
 * Normalise an MP3 buffer to a loudness target via two-pass ffmpeg
 * loudnorm. Throws on ffmpeg / parse failure — caller should catch
 * and fall back to the raw input.
 */
export async function loudnormalise(
  input: Buffer,
  opts: LoudnormOptions = {},
): Promise<LoudnormResult> {
  const o = { ...DEFAULTS, ...opts };

  // Pass 1: measure
  const pass1Stderr = await spawnLoudnormPass1(input, o);
  const m1 = parseLoudnormStderr(pass1Stderr);
  if (!m1 || typeof m1.input_i !== "number") {
    throw new Error(`loudnorm pass1 parse failed; stderr tail: ${pass1Stderr.slice(-200)}`);
  }
  const pass1 = m1 as LoudnormJsonPass1;

  // Pass 2: apply (linear, single-gain)
  const { stdout: pass2Buf, stderr: pass2Stderr } = await spawnLoudnormPass2(input, o, pass1);
  const m2 = parseLoudnormStderr(pass2Stderr);
  if (!m2 || typeof (m2 as LoudnormJsonPass2).output_i !== "number") {
    throw new Error(`loudnorm pass2 parse failed; stderr tail: ${pass2Stderr.slice(-200)}`);
  }
  const pass2 = m2 as LoudnormJsonPass2;

  return {
    buffer: pass2Buf,
    measurement: {
      inputI: pass1.input_i,
      inputTp: pass1.input_tp,
      inputLra: pass1.input_lra,
      outputI: pass2.output_i,
      outputTp: pass2.output_tp,
    },
  };
}

// ─── Internal: spawn helpers ────────────────────────────────────────

function spawnLoudnormPass1(
  input: Buffer,
  o: typeof DEFAULTS,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner",
      "-i", "pipe:0",
      "-af", `loudnorm=I=${o.targetI}:TP=${o.targetTp}:LRA=${o.targetLra}:print_format=json`,
      "-f", "null", "-",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    ff.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
    ff.stdout.on("data", () => undefined); // drain — null muxer still emits
    ff.on("error", (err) => reject(new Error(`ffmpeg pass1 spawn failed: ${err.message}`)));
    ff.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg pass1 exit ${code}: ${stderr.slice(-200)}`));
        return;
      }
      resolve(stderr);
    });
    ff.stdin.on("error", () => undefined); // EPIPE expected if ffmpeg closes early
    ff.stdin.end(input);
  });
}

function spawnLoudnormPass2(
  input: Buffer,
  o: typeof DEFAULTS,
  m: LoudnormJsonPass1,
): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const filter = [
      `loudnorm=I=${o.targetI}:TP=${o.targetTp}:LRA=${o.targetLra}`,
      `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}`,
      `measured_thresh=${m.input_thresh}:offset=${m.target_offset}`,
      `linear=true:print_format=json`,
    ].join(":");
    const ff = spawn("ffmpeg", [
      "-hide_banner",
      "-i", "pipe:0",
      "-af", filter,
      "-c:a", "libmp3lame",
      "-b:a", `${o.bitrateKbps}k`,
      "-f", "mp3",
      "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    ff.stdout.on("data", (c: Buffer) => chunks.push(c));
    ff.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
    ff.on("error", (err) => reject(new Error(`ffmpeg pass2 spawn failed: ${err.message}`)));
    ff.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg pass2 exit ${code}: ${stderr.slice(-200)}`));
        return;
      }
      resolve({ stdout: Buffer.concat(chunks), stderr });
    });
    ff.stdin.on("error", () => undefined);
    ff.stdin.end(input);
  });
}
```

- [ ] **Step 2: Run all loudnorm tests** (parser tests should still pass; no new tests yet)

Run: `npm test -- --grep "parseLoudnormStderr"`
Expected: 5 PASS

- [ ] **Step 3: Commit**

```bash
git add lib/loudnorm.ts
git commit -m "feat(loudnorm): add loudnormalise() two-pass wrapper"
```

---

## Task 5: `lib/loudnorm.integration.test.ts` — real ffmpeg test

**Files:**
- Create: `lib/loudnorm.integration.test.ts`

**Why separate:** Real ffmpeg invocation is too slow + environment-dependent for the unit test bundle. Skips automatically if `ffmpeg` not in PATH. Uses `spawn` (codebase convention — never `exec*`) for the presence check.

- [ ] **Step 1: Write the integration test**

```ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loudnormalise } from "./loudnorm.ts";

// Skip the entire suite if ffmpeg isn't available — keeps Vercel
// preview-branch CI happy while still running on Orion + dev boxes.
// Uses spawnSync (arg array, no shell) per codebase convention —
// never exec*.
function ffmpegPresent(): boolean {
  const r = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  return r.status === 0;
}

describe("loudnormalise (integration)", { skip: !ffmpegPresent() }, () => {
  const fixturePath = new URL("./test-fixtures/pink-noise-5s.mp3", import.meta.url);

  test("normalises pink noise fixture to within ±0.6 LUFS of -14", async () => {
    if (!existsSync(fixturePath)) {
      assert.fail("missing fixture lib/test-fixtures/pink-noise-5s.mp3 — generate via Task 3 step 1");
    }
    const input = readFileSync(fixturePath);
    const result = await loudnormalise(input);

    // Output should be a valid MP3 (non-empty, starts with ID3 or a valid frame header).
    assert.ok(result.buffer.length > 0, "output buffer is empty");

    // Output integrated loudness should land near target. Loudnorm
    // linear mode is deterministic to ~0.1-0.5 LUFS depending on
    // material; allow ±0.6 to keep the test stable across ffmpeg
    // versions.
    assert.ok(
      Math.abs(result.measurement.outputI - (-14)) < 0.6,
      `outputI = ${result.measurement.outputI}, expected within ±0.6 of -14`,
    );

    // True peak should respect the -1 dBTP ceiling.
    assert.ok(
      result.measurement.outputTp <= -0.5,
      `outputTp = ${result.measurement.outputTp}, expected ≤ -0.5`,
    );

    // Source measurement should be populated.
    assert.equal(typeof result.measurement.inputI, "number");
  });

  test("respects custom targetI", async () => {
    const input = readFileSync(fixturePath);
    const result = await loudnormalise(input, { targetI: -16 });
    assert.ok(
      Math.abs(result.measurement.outputI - (-16)) < 0.6,
      `outputI = ${result.measurement.outputI}, expected within ±0.6 of -16`,
    );
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- --grep "loudnormalise"`
Expected: 2 PASS (or both skipped if no ffmpeg).

- [ ] **Step 3: Commit**

```bash
git add lib/loudnorm.integration.test.ts
git commit -m "test(loudnorm): integration test with real ffmpeg"
```

---

## Task 6: `lib/loudnormalise-existing-track.ts` — shared helper

**Files:**
- Create: `lib/loudnormalise-existing-track.ts`
- Create: `lib/loudnormalise-existing-track.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --grep "loudnormaliseExistingTrack"`
Expected: All 7 tests FAIL with "Cannot find module"

- [ ] **Step 3: Implement** at `lib/loudnormalise-existing-track.ts`

```ts
// Shared helper used by both:
//   - workers/queue-daemon/loudnorm-poller.ts (60s tick)
//   - scripts/backfill-track-loudness.ts (operator one-shot)
//
// Loads a Track + its audio_stream asset, runs lib/loudnorm, preserves
// the original at tracks-original/<id>.mp3, overwrites the canonical
// B2 key with the normalised buffer, updates the Track row, and best-
// effort purges Cloudflare cache for the public URL.
//
// All side-effecting calls are injectable (fetch / S3 head / S3 put /
// loudnorm / CF purge) so unit tests don't touch the network.

import type { PrismaClient } from "@prisma/client";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { loudnormalise as defaultLoudnormalise, type LoudnessMeasurement } from "./loudnorm.ts";
import { purgeCloudflareCache, type CfPurgeResult } from "./cf-purge.ts";

export type SkipReason = "voice" | "already_done" | "missing_asset" | "not_found";

export type LoudnormaliseTrackResult =
  | { skipped: SkipReason }
  | { ok: true; measurement: LoudnessMeasurement }
  | { error: string };

export interface LoudnormaliseTrackDeps {
  fetchImpl?: (url: string) => Promise<Response>;
  headImpl?: (key: string) => Promise<boolean>;
  putOriginalImpl?: (key: string, body: Buffer) => Promise<void>;
  putCanonicalImpl?: (key: string, body: Buffer) => Promise<void>;
  loudnormImpl?: typeof defaultLoudnormalise;
  cfPurgeImpl?: (urls: string[]) => Promise<CfPurgeResult>;
}

const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (_s3) return _s3;
  _s3 = new S3Client({
    region: process.env.B2_REGION,
    endpoint: process.env.B2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.B2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.B2_SECRET_ACCESS_KEY ?? "",
    },
  });
  return _s3;
}

function bucket(): string {
  const b = process.env.B2_BUCKET_NAME;
  if (!b) throw new Error("B2_BUCKET_NAME not set");
  return b;
}

async function defaultHead(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function defaultPut(key: string, body: Buffer): Promise<void> {
  await s3().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    Body: body,
    ContentType: "audio/mpeg",
    CacheControl: IMMUTABLE_CACHE_CONTROL,
  }));
}

function isVoiceTrack(t: { sourceType: string; airingPolicy: string; title: string }): boolean {
  return t.sourceType === "external_import"
    && t.airingPolicy === "request_only"
    && t.title.startsWith("Shoutout");
}

export async function loudnormaliseExistingTrack(
  prisma: PrismaClient,
  trackId: string,
  deps: LoudnormaliseTrackDeps = {},
): Promise<LoudnormaliseTrackResult> {
  const fetchImpl = deps.fetchImpl ?? ((u: string) => fetch(u, { signal: AbortSignal.timeout(30_000) }));
  const headImpl = deps.headImpl ?? defaultHead;
  const putOriginalImpl = deps.putOriginalImpl ?? defaultPut;
  const putCanonicalImpl = deps.putCanonicalImpl ?? defaultPut;
  const loudnormImpl = deps.loudnormImpl ?? defaultLoudnormalise;
  const cfPurgeImpl = deps.cfPurgeImpl ?? purgeCloudflareCache;

  const track = await prisma.track.findUnique({
    where: { id: trackId },
    include: { assets: true },
  }) as unknown as {
    id: string;
    title: string;
    sourceType: string;
    airingPolicy: string;
    loudnessLufs: number | null;
    assets: { assetType: string; storageKey: string; publicUrl: string }[];
  } | null;

  if (!track) return { skipped: "not_found" };
  if (track.loudnessLufs !== null) return { skipped: "already_done" };
  if (isVoiceTrack(track)) return { skipped: "voice" };

  const audioAsset = track.assets.find((a) => a.assetType === "audio_stream");
  if (!audioAsset) return { skipped: "missing_asset" };

  // Download canonical audio (CDN-cached path, fast).
  const res = await fetchImpl(audioAsset.publicUrl);
  if (!res.ok) return { error: `audio fetch HTTP ${res.status}` };
  const buf = Buffer.from(await res.arrayBuffer());

  // Preserve original (idempotent — HEAD first).
  const originalKey = `tracks-original/${track.id}.mp3`;
  const originalPresent = await headImpl(originalKey);
  if (!originalPresent) {
    try { await putOriginalImpl(originalKey, buf); }
    catch (err) {
      // Best-effort: log and continue. Better to ship the normalisation
      // than to block the whole pipeline on a backup-copy upload error.
      console.warn(`[loudnorm-track] original preserve failed for ${track.id}: ${String(err)}`);
    }
  }

  // Run loudnorm.
  let result: { buffer: Buffer; measurement: LoudnessMeasurement };
  try {
    result = await loudnormImpl(buf);
  } catch (err) {
    return { error: String(err instanceof Error ? err.message : err) };
  }

  // Overwrite canonical key.
  try {
    await putCanonicalImpl(audioAsset.storageKey, result.buffer);
  } catch (err) {
    return { error: `canonical upload failed: ${String(err instanceof Error ? err.message : err)}` };
  }

  // Update Track row.
  await prisma.track.update({
    where: { id: track.id },
    data: {
      loudnessLufs: result.measurement.outputI,
      loudnessTruePeakDbtp: result.measurement.outputTp,
      loudnessSourceLufs: result.measurement.inputI,
    },
  });

  // Best-effort CF purge.
  const purge = await cfPurgeImpl([audioAsset.publicUrl]);
  if ("error" in purge) {
    console.warn(`[loudnorm-track] CF purge failed for ${audioAsset.publicUrl}: ${purge.error}`);
  }

  return { ok: true, measurement: result.measurement };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --grep "loudnormaliseExistingTrack"`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/loudnormalise-existing-track.ts lib/loudnormalise-existing-track.test.ts
git commit -m "feat(loudnorm): add shared loudnormaliseExistingTrack helper"
```

---

## Task 7: Wedge inline loudnorm into `workers/song-worker/pipeline.ts`

**Files:**
- Modify: `workers/song-worker/pipeline.ts` (around line 263, after `audioBytes = Buffer.from(...)`)

- [ ] **Step 1: Add import** near the top of `workers/song-worker/pipeline.ts`

Find the existing import block (lines 1-14). Add:

```ts
import { loudnormalise } from "../../lib/loudnorm.ts";
```

- [ ] **Step 2: Wedge loudnorm call** between line 263 (`const audioBytes = Buffer.from(await audioRes.arrayBuffer());`) and line 280 (`const trackId = randomUUID();`).

Find this block:

```ts
  const audioBytes = Buffer.from(await audioRes.arrayBuffer());

  // Frame-accurate probe via lib/probe-duration.ts ...
```

Replace with:

```ts
  const rawAudioBytes = Buffer.from(await audioRes.arrayBuffer());

  // Loudness-normalise to -14 LUFS at ingest. Falls back to raw audio
  // on any ffmpeg / parse failure — Track.loudnessLufs stays NULL and
  // the queue-daemon poller picks it up later. Listener never blocked.
  let audioBytes = rawAudioBytes;
  let loudness: { inputI: number; outputI: number; outputTp: number } | null = null;
  try {
    const ln = await loudnormalise(rawAudioBytes);
    audioBytes = ln.buffer;
    loudness = {
      inputI: ln.measurement.inputI,
      outputI: ln.measurement.outputI,
      outputTp: ln.measurement.outputTp,
    };
    console.log(`[song-worker] loudnorm ${job.id}: ${ln.measurement.inputI.toFixed(1)} → ${ln.measurement.outputI.toFixed(1)} LUFS`);
  } catch (err) {
    console.warn(`[song-worker] loudnorm failed for ${job.id}, using raw audio: ${String(err)}`);
  }

  // Frame-accurate probe via lib/probe-duration.ts ...
```

- [ ] **Step 3: Preserve the original to `tracks-original/`** — add this immediately before the canonical upload (`const audioUrl = await uploadToB2(audioKey, ...)` around line 284):

```ts
  // Preserve the original (pre-loudnorm) bytes. Best-effort — log on
  // failure but don't block the canonical ingest. Skipped if we
  // fell back to raw above (loudness === null).
  if (loudness) {
    const originalKey = `tracks-original/${trackId}.mp3`;
    try {
      await uploadToB2(originalKey, rawAudioBytes, "audio/mpeg");
    } catch (err) {
      console.warn(`[song-worker] original preserve failed for ${trackId}: ${String(err)}`);
    }
  }
```

- [ ] **Step 4: Pass loudness fields into `prisma.track.create`** — find the `data: { ... assets: { create: ... } }` block (around line 304-340) and add loudness fields next to `durationSeconds`:

```ts
      durationSeconds,
      loudnessLufs: loudness?.outputI ?? null,
      loudnessTruePeakDbtp: loudness?.outputTp ?? null,
      loudnessSourceLufs: loudness?.inputI ?? null,
      assets: {
        // ... existing ...
      },
```

- [ ] **Step 5: Run existing song-worker tests to make sure nothing regressed**

Run: `npm test -- --grep "song-worker"`
Expected: All existing tests PASS (we didn't add new ones for the wedge — the loudnorm helper itself is tested in Task 4).

- [ ] **Step 6: Commit**

```bash
git add workers/song-worker/pipeline.ts
git commit -m "feat(song-worker): inline loudnorm before B2 upload"
```

---

## Task 8: Wedge inline loudnorm into `scripts/ingest-seed.ts`

**Files:**
- Modify: `scripts/ingest-seed.ts`

- [ ] **Step 1: Read current state** of `scripts/ingest-seed.ts` to find the audio-buffer + B2 upload step.

Run: `grep -n "Buffer\|uploadToB2\|PutObjectCommand\|sanitize" scripts/ingest-seed.ts`

Identify where the script reads the seed file into a Buffer (likely via `fs.readFileSync` or `fs.promises.readFile`) and where it uploads to B2.

- [ ] **Step 2: Add imports** to `scripts/ingest-seed.ts` at the top of the existing import block:

```ts
import { loudnormalise } from "../lib/loudnorm.ts";
import { sanitizeMp3AudioOnly } from "../lib/sanitize-mp3-audio-only.ts";
```

(The sanitize import may already be there — only add if missing.)

- [ ] **Step 3: Wedge sanitize+loudnorm** between buffer-read and B2 upload. Use this pattern (substitute exact variable names from the file):

```ts
// Suno-generated MP3s sometimes embed an MJPEG cover-art video stream
// that breaks Liquidsoap's content-type check. Strip it first.
const sanitised = await sanitizeMp3AudioOnly(rawBuffer);
let audioBuffer = sanitised.buffer;
if (sanitised.changed) {
  console.log(`[ingest-seed] stripped video stream from ${filename} (-${sanitised.bytesRemoved} bytes)`);
}

// Loudness-normalise to -14 LUFS. Fall back to sanitised raw on
// failure — the daemon poller backfills NULL rows later.
let loudness: { inputI: number; outputI: number; outputTp: number } | null = null;
try {
  const ln = await loudnormalise(audioBuffer);
  audioBuffer = ln.buffer;
  loudness = {
    inputI: ln.measurement.inputI,
    outputI: ln.measurement.outputI,
    outputTp: ln.measurement.outputTp,
  };
  console.log(`[ingest-seed] loudnorm ${filename}: ${ln.measurement.inputI.toFixed(1)} → ${ln.measurement.outputI.toFixed(1)} LUFS`);
} catch (err) {
  console.warn(`[ingest-seed] loudnorm failed for ${filename}, using raw: ${String(err)}`);
}
```

- [ ] **Step 4: Preserve original** (only if loudnorm succeeded) — add right before the canonical upload:

```ts
if (loudness) {
  const originalKey = `tracks-original/${trackId}.mp3`;
  try {
    await uploadToB2(originalKey, rawBuffer, "audio/mpeg");
  } catch (err) {
    console.warn(`[ingest-seed] original preserve failed for ${trackId}: ${String(err)}`);
  }
}
```

(Use whatever S3 / B2 upload helper the existing script uses — match the pattern.)

- [ ] **Step 5: Add loudness fields** to the `prisma.track.create({ data: ... })` call:

```ts
data: {
  // ... existing ...
  loudnessLufs: loudness?.outputI ?? null,
  loudnessTruePeakDbtp: loudness?.outputTp ?? null,
  loudnessSourceLufs: loudness?.inputI ?? null,
  // ...
}
```

- [ ] **Step 6: Run any existing ingest-seed tests** (likely none, but verify)

Run: `npm test 2>&1 | tail -20`
Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
git add scripts/ingest-seed.ts
git commit -m "feat(ingest-seed): inline sanitize + loudnorm before B2 upload"
```

---

## Task 9: `workers/queue-daemon/loudnorm-poller.ts` — daemon tick module

**Files:**
- Create: `workers/queue-daemon/loudnorm-poller.ts`
- Create: `workers/queue-daemon/loudnorm-poller.test.ts`
- Modify: `workers/queue-daemon/index.ts` (start the poller alongside existing ticks)

- [ ] **Step 1: Write the failing tests** at `workers/queue-daemon/loudnorm-poller.test.ts`

```ts
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
    // Must request loudnessLufs IS NULL
    assert.equal(capturedWhere.loudnessLufs, null);
    // Must exclude voice via NOT clause
    assert.ok(Array.isArray(capturedWhere.NOT) || typeof capturedWhere.NOT === "object", "expected a NOT clause excluding voice");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --grep "runLoudnormTick"`
Expected: 5 tests FAIL with "Cannot find module"

- [ ] **Step 3: Implement** at `workers/queue-daemon/loudnorm-poller.ts`

```ts
// Loudness backfill poller — runs as a tick in the queue daemon.
// Each tick picks one Track with loudnessLufs IS NULL (excluding voice
// content) and runs lib/loudnormalise-existing-track on it. Catches:
//   - artist submission approvals (created by the Vercel approve route
//     with loudnessLufs=NULL since Vercel can't run ffmpeg)
//   - any track the inline ingest path failed on (raw fallback)
//   - the existing 130-track catalogue, on a leisurely 60s/track cadence
//
// Reuses lib/loudnormalise-existing-track so the backfill script and
// the daemon are guaranteed to behave identically.

import type { PrismaClient } from "@prisma/client";
import {
  loudnormaliseExistingTrack,
  type LoudnormaliseTrackResult,
  type LoudnormaliseTrackDeps,
} from "../../lib/loudnormalise-existing-track.ts";

export interface LoudnormPollerOpts {
  intervalMs?: number;
  processImpl?: (
    prisma: PrismaClient,
    trackId: string,
    deps?: LoudnormaliseTrackDeps,
  ) => Promise<LoudnormaliseTrackResult>;
}

export type TickResult = "idle" | "processed" | "skipped" | "failed";

/**
 * Run one tick of the loudnorm poller. Picks the oldest Track with
 * loudnessLufs IS NULL (excluding voice content) and processes it.
 * Returns "idle" when no work is pending.
 */
export async function runLoudnormTick(
  prisma: PrismaClient,
  opts: LoudnormPollerOpts = {},
): Promise<TickResult> {
  const process = opts.processImpl ?? loudnormaliseExistingTrack;

  const candidate = await prisma.track.findFirst({
    where: {
      loudnessLufs: null,
      // Exclude voice content — the helper would skip it anyway, but
      // pre-filtering in SQL avoids loading a row just to discard it.
      NOT: {
        AND: [
          { sourceType: "external_import" },
          { airingPolicy: "request_only" },
          { title: { startsWith: "Shoutout" } },
        ],
      },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true },
  });

  if (!candidate) return "idle";

  const result = await process(prisma, candidate.id);

  if ("ok" in result) {
    console.log(
      `[loudnorm-poller] processed ${candidate.id} "${candidate.title}" ${result.measurement.inputI.toFixed(1)} → ${result.measurement.outputI.toFixed(1)} LUFS`,
    );
    return "processed";
  }
  if ("skipped" in result) {
    console.log(`[loudnorm-poller] skipped:${result.skipped} ${candidate.id}`);
    return "skipped";
  }
  console.warn(`[loudnorm-poller] failed ${candidate.id}: ${result.error}`);
  return "failed";
}

/**
 * Start the poller as a long-running interval. Returns a stop fn.
 */
export function startLoudnormPoller(
  prisma: PrismaClient,
  opts: LoudnormPollerOpts = {},
): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? 60_000;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      await runLoudnormTick(prisma, opts);
    } catch (err) {
      // Defensive: runLoudnormTick swallows helper errors, so a throw
      // here would mean a bug in the poller itself. Log and continue —
      // never let a poller exception take the daemon down.
      console.error(`[loudnorm-poller] tick threw: ${String(err)}`);
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  // Fire first tick after one interval (gives the rest of the daemon
  // time to settle on startup).
  timer = setTimeout(tick, intervalMs);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --grep "runLoudnormTick"`
Expected: 5 tests PASS

- [ ] **Step 5: Wire into `workers/queue-daemon/index.ts`** — find where other long-running tick loops are started (likely near the bottom of the file). Add:

```ts
import { startLoudnormPoller } from "./loudnorm-poller.ts";

// ... near where other pollers are started ...
const loudnormPoller = startLoudnormPoller(prisma);

// ... and in the shutdown handler (if one exists) ...
process.on("SIGTERM", () => {
  loudnormPoller.stop();
  // ... existing shutdown ...
});
```

If the daemon doesn't use SIGTERM today, just start the poller. systemd will SIGKILL on stop — OK for a polling background loop.

- [ ] **Step 6: Run the daemon test suite**

Run: `npm test -- workers/queue-daemon/`
Expected: existing tests PASS, plus the 5 new poller tests.

- [ ] **Step 7: Commit**

```bash
git add workers/queue-daemon/loudnorm-poller.ts workers/queue-daemon/loudnorm-poller.test.ts workers/queue-daemon/index.ts
git commit -m "feat(queue-daemon): poll WHERE loudnessLufs IS NULL every 60s"
```

---

## Task 10: `scripts/backfill-track-loudness.ts` — operator one-shot CLI

**Files:**
- Create: `scripts/backfill-track-loudness.ts`
- Modify: `package.json`

- [ ] **Step 1: Implement the CLI**

```ts
#!/usr/bin/env tsx
// Backfill loudness measurements + normalised audio for every Track
// row that doesn't have loudnessLufs yet. Idempotent — re-run anytime;
// already-normalised rows are skipped via the WHERE clause.
//
// Usage:
//   npx tsx scripts/backfill-track-loudness.ts             # dry-run (default)
//   npx tsx scripts/backfill-track-loudness.ts --apply     # actually run
//   npx tsx scripts/backfill-track-loudness.ts --apply --limit 5
//
// Recommended invocation on Orion (off-peak, defer to broadcast):
//   nice -n 19 npx tsx scripts/backfill-track-loudness.ts --apply
//
// Estimated cost: ~5s of CPU per track. ~130 tracks ≈ 11 minutes.

import "../lib/load-env.ts";
import { PrismaClient } from "@prisma/client";
import { loudnormaliseExistingTrack } from "../lib/loudnormalise-existing-track.ts";

interface Args {
  apply: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--dry-run") args.apply = false;
    else if (a === "--limit") {
      const next = argv[i + 1];
      const n = next ? parseInt(next, 10) : NaN;
      if (Number.isFinite(n) && n > 0) { args.limit = n; i++; }
      else { console.error(`--limit requires a positive integer, got: ${next}`); process.exit(2); }
    } else {
      console.error(`Unknown arg: ${a}`);
      console.error("Usage: tsx scripts/backfill-track-loudness.ts [--apply] [--limit N]");
      process.exit(2);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  // Pre-filter the same way the daemon poller does — exclude voice.
  const where = {
    loudnessLufs: null,
    NOT: {
      AND: [
        { sourceType: "external_import" },
        { airingPolicy: "request_only" },
        { title: { startsWith: "Shoutout" } },
      ],
    },
  } as const;

  const candidates = await prisma.track.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, sourceType: true },
    ...(args.limit ? { take: args.limit } : {}),
  });

  console.log(`[backfill] ${candidates.length} candidate track(s) — apply=${args.apply}`);
  if (!args.apply) {
    for (const t of candidates) {
      console.log(`  would process: ${t.id} (${t.sourceType}) "${t.title}"`);
    }
    console.log(`[backfill] dry-run only. Re-run with --apply to actually normalise.`);
    await prisma.$disconnect();
    return;
  }

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (const t of candidates) {
    const result = await loudnormaliseExistingTrack(prisma, t.id);
    if ("ok" in result) {
      processed++;
      const m = result.measurement;
      const delta = m.outputI - m.inputI;
      const sign = delta >= 0 ? "+" : "";
      console.log(
        `[backfill] ${t.id} "${t.title}" ${m.inputI.toFixed(1)} → ${m.outputI.toFixed(1)} LUFS (delta ${sign}${delta.toFixed(1)})`,
      );
    } else if ("skipped" in result) {
      skipped++;
      console.log(`[backfill skip:${result.skipped}] ${t.id}`);
    } else {
      failed++;
      console.warn(`[backfill fail] ${t.id} "${t.title}": ${result.error}`);
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[backfill] done in ${elapsedSec}s — processed=${processed} skipped=${skipped} failed=${failed}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(`[backfill] fatal: ${String(err)}`);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke test the CLI in dry-run mode** (against local dev DB if available, or against Neon if local DB is empty — read-only query)

Run: `npx tsx scripts/backfill-track-loudness.ts`
Expected: prints `[backfill] N candidate track(s) — apply=false` and lists a sample.

- [ ] **Step 3: Smoke test --limit + --apply against ONE row** (only if a local dev DB with a real track is available, otherwise skip and rely on operator's prod test)

Run: `npx tsx scripts/backfill-track-loudness.ts --apply --limit 1`
Expected: processes one track, prints loudness measurement.

- [ ] **Step 4: Add npm script** to `package.json` (find the `"scripts"` block):

```json
"backfill:loudness": "tsx scripts/backfill-track-loudness.ts",
```

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-track-loudness.ts package.json
git commit -m "feat(scripts): add backfill-track-loudness CLI"
```

---

## Task 11: Liquidsoap master safety net

**Files:**
- Modify: `liquidsoap/numa.liq` (insert between line 279 and line 297)

- [ ] **Step 1: Edit `liquidsoap/numa.liq`** — find the existing block:

```liquidsoap
source = smooth_add(
  duration=0.5,
  p=0.3,
  normal=music_bed,
  special=voice
)

log.important(
  "[numa] pipeline ready: api=" ^ api_url ^
```

Insert the new block between the `smooth_add` close and `log.important`:

```liquidsoap
source = smooth_add(
  duration=0.5,
  p=0.3,
  normal=music_bed,
  special=voice
)

# ─── Master safety net (post-ingest-loudnorm backstop) ─────────────
# Every music track is normalised to -14 LUFS at ingest via
# lib/loudnorm.ts. This is the backstop for outliers (a track that
# slipped past the ingest path, voice content that doesn't go through
# loudnorm, a future audio source). Gain envelope is intentionally
# tight (max +6 / min -12 dB) so we don't pump on already-normalised
# content — only catch real outliers.
source = normalize(target=-14., window=1., gain_max=6., gain_min=-12., source)

# Brick-wall to prevent any clipping reaching Icecast. Voice already
# has its own limit() at line 267; this is the master.
source = limit(threshold=-1., source)

log.important(
  "[numa] pipeline ready: api=" ^ api_url ^
```

- [ ] **Step 2: Validate Liquidsoap syntax locally if possible**

Run (only if `liquidsoap` is in PATH on the dev machine):

```bash
liquidsoap --check liquidsoap/numa.liq
```

Expected: `Type checking liquidsoap/numa.liq` followed by no errors.

If liquidsoap not present locally: skip — operator will catch it on `systemctl restart numa-liquidsoap` (the rollback escape hatch at the bottom of the file is the safety valve).

- [ ] **Step 3: Commit**

```bash
git add liquidsoap/numa.liq
git commit -m "feat(liquidsoap): add master normalize + limit safety net"
```

---

## Task 12: Update `docs/HANDOFF.md` + remove parked TODO entry

**Files:**
- Modify: `docs/HANDOFF.md` (add a new section at the top)
- Modify: `TODO.md` (remove the "Loudness normalisation across the catalogue" parked entry)

- [ ] **Step 1: Add a HANDOFF section** at the top (above the existing 2026-05-05 audit section):

```markdown
## 2026-05-09 — Catalogue loudness normalisation — CODE READY, NEEDS DEPLOY

Every music track now normalises to -14 LUFS at ingest (matches Spotify
/ YouTube Music / TikTok). Two-pass ffmpeg loudnorm in
`lib/loudnorm.ts`. Wedged into `workers/song-worker/pipeline.ts` (live
listener songs) and `scripts/ingest-seed.ts` (operator manual drops).
Vercel-side approvals (no ffmpeg) get picked up by a new 60s queue-
daemon poller that runs `loudnormaliseExistingTrack` against
`WHERE loudnessLufs IS NULL`. Originals preserved at
`tracks-original/<id>.mp3` in B2.

**Liquidsoap master safety net:** `normalize(target=-14, gain_max=6,
gain_min=-12)` + `limit(-1.)` after the smooth_add catches any
outliers (tight envelope so it doesn't pump on already-normalised
content). Voice content (Lena chatter, shoutouts) is intentionally
NOT ingest-normalised — it runs on Vercel, no ffmpeg available; the
master limiter catches it.

**Spec:** `docs/superpowers/specs/2026-05-09-loudness-normalisation-design.md`
**Plan:** `docs/superpowers/plans/2026-05-09-loudness-normalisation.md`

### Operator deploy steps

1. Pull on Orion: `cd ~/saas/numaradio && git pull`
2. Apply schema migration: `npx prisma migrate deploy`
3. (Optional) Add CF cache-purge creds to `/etc/numa/env`:
   ```
   CF_API_TOKEN=<token with Zone.Cache Purge>
   CF_ZONE_ID=<numaradio.com zone>
   ```
   Skip → catalogue updates without immediate CF purge (eventually
   consistent via CF TTL — fine for non-urgent backfill).
4. Restart song-worker (inline loudnorm): `sudo systemctl restart
   numa-song-worker` (needs password — not in passwordless sudoers).
5. Restart queue-daemon (60s poller): `sudo systemctl restart
   numa-queue-daemon` (passwordless).
6. Restart Liquidsoap (master safety net): `sudo systemctl restart
   numa-liquidsoap` (passwordless).
7. Verify: approve a submission. Watch `journalctl --user -u
   numa-queue-daemon -f | grep loudnorm`. Within 60s:
   `[loudnorm-poller] processed <id> ...`.

**Existing 130-track catalogue:** the daemon poller will normalise the
backlog at 1/min (≈2.2 hr to clear). Or run the one-shot off-peak:

```
cd ~/saas/numaradio
nice -n 19 npx tsx scripts/backfill-track-loudness.ts --dry-run
nice -n 19 npx tsx scripts/backfill-track-loudness.ts --apply
```

~5s/track × 130 ≈ 11 min.

---

```

- [ ] **Step 2: Remove the parked TODO entry** — open `TODO.md` and delete the entire "## Loudness normalisation across the catalogue" section (from the `## Loudness…` heading through the closing `---` separator before the next heading or end of file).

- [ ] **Step 3: Commit**

```bash
git add docs/HANDOFF.md TODO.md
git commit -m "docs: handoff note + clear parked TODO for loudness work"
```

---

## Task 13: Final integration smoke test (manual)

**Files:** none — manual verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass — at least the existing baseline (~436 root) plus the new ones from this PR (~24 added across loudnorm, helper, poller, cf-purge).

- [ ] **Step 2: Type-check the build**

Run: `npx next build`
Expected: clean — no type errors.

- [ ] **Step 3: Verify the Vercel-side approve route still type-checks** (it doesn't change, but the schema gains new fields)

Run: `npx next build 2>&1 | grep -i error`
Expected: no output.

- [ ] **Step 4: Final commit if there's a generated file change**

Run: `git status`
If anything new appeared from the build:

```bash
git add <generated-files>
git commit -m "chore: rebuild generated artifacts after loudness migration"
```

---

## Self-review checklist (run after writing the plan above)

**Spec coverage:**
- [x] `lib/loudnorm.ts` — Tasks 3 + 4
- [x] `lib/loudnormalise-existing-track.ts` — Task 6
- [x] `lib/cf-purge.ts` — Task 2
- [x] Schema migration — Task 1
- [x] `scripts/backfill-track-loudness.ts` — Task 10
- [x] `workers/queue-daemon/loudnorm-poller.ts` — Task 9
- [x] song-worker wedge — Task 7
- [x] ingest-seed wedge — Task 8
- [x] Liquidsoap edit — Task 11
- [x] HANDOFF + TODO cleanup — Task 12
- [x] Integration smoke — Task 13

**Type consistency:**
- `LoudnessMeasurement` (5 fields: inputI, inputTp, inputLra, outputI, outputTp) defined in Task 4, used in Tasks 6, 7, 8, 9, 10. ✓
- `LoudnormResult` defined in Task 4, never re-defined. ✓
- `LoudnormaliseTrackResult` + `LoudnormaliseTrackDeps` defined in Task 6, used by Task 9. ✓
- Helper called `loudnormaliseExistingTrack` consistently across Tasks 6, 9, 10. ✓
- CF purge function called `purgeCloudflareCache` consistently in Tasks 2 + 6. ✓
- Tick fn called `runLoudnormTick`; long-running loop fn called `startLoudnormPoller`. Both defined in Task 9, second used in Task 9 step 5. ✓

**Placeholder scan:** no TBDs; every code step contains complete code; every test step shows the test; every command step shows the exact command + expected output. The only "fill in" is in Task 8 step 3 ("substitute exact variable names from the file") because we haven't read ingest-seed.ts in detail yet — the pattern is fully spelled out, the variable rename is mechanical.

**Codebase convention compliance:** all subprocess invocations use `child_process.spawn` / `spawnSync` with arg arrays (no `exec*`). Test framework is Node 22 native (`node --test --experimental-strip-types`). Imports use explicit `.ts` extensions. Functional null/result-on-error style (no exceptions for predictable failures).
