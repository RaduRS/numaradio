import { test } from "node:test";
import assert from "node:assert/strict";
import { isProducerReplyEnabled } from "./feature-flag.ts";

test("isProducerReplyEnabled returns true when env='on'", () => assert.equal(isProducerReplyEnabled({ LENA_PRODUCER_REPLY: "on" }), true));
test("isProducerReplyEnabled returns false when unset", () => assert.equal(isProducerReplyEnabled({}), false));
test("isProducerReplyEnabled returns false when env='off'", () => assert.equal(isProducerReplyEnabled({ LENA_PRODUCER_REPLY: "off" }), false));
