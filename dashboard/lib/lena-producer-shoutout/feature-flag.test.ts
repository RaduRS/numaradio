import { test } from "node:test";
import assert from "node:assert/strict";
import { isProducerShoutoutEnabled } from "./feature-flag.ts";

test("on/true/1 are truthy", () => {
  assert.equal(isProducerShoutoutEnabled({ LENA_PRODUCER_SHOUTOUT: "on" }), true);
  assert.equal(isProducerShoutoutEnabled({ LENA_PRODUCER_SHOUTOUT: "true" }), true);
  assert.equal(isProducerShoutoutEnabled({ LENA_PRODUCER_SHOUTOUT: "1" }), true);
});
test("unset/off are falsy", () => {
  assert.equal(isProducerShoutoutEnabled({}), false);
  assert.equal(isProducerShoutoutEnabled({ LENA_PRODUCER_SHOUTOUT: "off" }), false);
});
