import { test } from "node:test";
import assert from "node:assert/strict";
import { radioHostTransform } from "./radio-host.ts";

test("strips lone trailing close-quote line instead of slapping period after it", () => {
  const input = `Anonymous writes: "This one's going out to Sawyers Son.\nPlay anything from Sawyers Son.\nI think they're my new favourite.\n"`;
  const out = radioHostTransform(input);
  assert.ok(!out.endsWith('".'), `expected no '".' tail, got: ${JSON.stringify(out)}`);
  assert.ok(!out.includes('\n"'), `expected no lone-quote line, got: ${JSON.stringify(out)}`);
});

test("tucks period inside trailing close-quote instead of appending after", () => {
  const out = radioHostTransform(`She said "hello there"`);
  assert.ok(!/".$/.test(out), `expected period inside quote, got: ${JSON.stringify(out)}`);
  assert.ok(/."$/.test(out), `expected ."$ ending, got: ${JSON.stringify(out)}`);
});

test("does not double-wrap numa radio when listener already quoted it", () => {
  const out = radioHostTransform(`Shoutout to "Numa Radio" for the flyest jams`);
  assert.equal((out.match(/"Numa Radio"/g) ?? []).length, 1, `expected exactly one quoted "Numa Radio", got: ${JSON.stringify(out)}`);
  assert.ok(!out.includes('""Numa Radio""'), `expected no double-quote stutter, got: ${JSON.stringify(out)}`);
});

test("still wraps unquoted numa radio for prosody", () => {
  const out = radioHostTransform(`You're listening to numa radio tonight`);
  assert.ok(out.includes('"Numa Radio"'), `expected branded wrap, got: ${JSON.stringify(out)}`);
});

test("empty input stays empty (no spurious period)", () => {
  assert.equal(radioHostTransform(""), "");
  assert.equal(radioHostTransform('"'), "");
  assert.equal(radioHostTransform('"  "'), "");
});
