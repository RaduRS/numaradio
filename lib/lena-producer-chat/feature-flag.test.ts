import { test } from "node:test";
import assert from "node:assert/strict";
import { isProducerReplyEnabled, isRequestAutonomyEnabled } from "./feature-flag.ts";

test("isProducerReplyEnabled returns true when env='on'", () => assert.equal(isProducerReplyEnabled({ LENA_PRODUCER_REPLY: "on" }), true));
test("isProducerReplyEnabled returns false when unset", () => assert.equal(isProducerReplyEnabled({}), false));
test("isProducerReplyEnabled returns false when env='off'", () => assert.equal(isProducerReplyEnabled({ LENA_PRODUCER_REPLY: "off" }), false));

test("isRequestAutonomyEnabled returns true when env='on'", () => assert.equal(isRequestAutonomyEnabled({ LENA_REQUEST_AUTONOMY: "on" }), true));
test("isRequestAutonomyEnabled returns false when unset", () => assert.equal(isRequestAutonomyEnabled({}), false));
test("isRequestAutonomyEnabled returns false when env='off'", () => assert.equal(isRequestAutonomyEnabled({ LENA_REQUEST_AUTONOMY: "off" }), false));
