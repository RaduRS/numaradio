// workers/queue-daemon/lena-producer/notify-listener.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNotifyPayload } from "./notify-listener.ts";

test("parseNotifyPayload returns the event when JSON is valid and shape matches", () => {
  const payload = JSON.stringify({
    type: "shoutout_aired",
    id: "s1",
    handle: "anna",
    originalText: "hi",
    airedAt: 1700000000000,
  });
  const ev = parseNotifyPayload(payload);
  assert.ok(ev);
  assert.equal(ev!.type, "shoutout_aired");
});

test("parseNotifyPayload returns null on invalid JSON", () => {
  assert.equal(parseNotifyPayload("not json"), null);
});

test("parseNotifyPayload returns null on missing required fields", () => {
  const payload = JSON.stringify({ type: "shoutout_aired" }); // missing fields
  assert.equal(parseNotifyPayload(payload), null);
});

test("parseNotifyPayload returns null on unknown event type", () => {
  const payload = JSON.stringify({ type: "made_up_event", id: "x", airedAt: 1 });
  assert.equal(parseNotifyPayload(payload), null);
});
