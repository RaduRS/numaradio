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
    const stderr = '{ "input_i" : -10.0, "input_tp" : -1.0, "input_lra" : 5.0, "input_thresh" : -20.0, "target_offset" : 4.0 }\nmore noise\n{ "input_i" : -20.0, "input_tp" : -2.0, "input_lra" : 8.0, "input_thresh" : -30.0, "target_offset" : 6.0 }';
    const r = parseLoudnormStderr(stderr);
    assert.notEqual(r, null);
    if (!r) return;
    assert.equal(r.input_i, -20.0);
  });
});
