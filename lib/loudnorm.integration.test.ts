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

    // Output should be a valid MP3 (non-empty).
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
