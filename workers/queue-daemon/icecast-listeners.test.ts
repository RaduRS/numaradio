import { test } from "node:test";
import assert from "node:assert/strict";
import { parseListenerCount } from "./icecast-listeners.ts";

test("parses single-source listener count for /stream", () => {
  const raw = {
    icestats: {
      source: { listenurl: "http://host:8000/stream", listeners: 7 },
    },
  };
  assert.equal(parseListenerCount(raw, "/stream"), 7);
});

test("parses array-source listener count for /stream", () => {
  const raw = {
    icestats: {
      source: [
        { listenurl: "http://host:8000/backup", listeners: 1 },
        { listenurl: "http://host:8000/stream", listeners: 9 },
      ],
    },
  };
  assert.equal(parseListenerCount(raw, "/stream"), 9);
});

test("returns null when wanted mount is not present", () => {
  const raw = {
    icestats: {
      source: { listenurl: "http://host:8000/other", listeners: 3 },
    },
  };
  assert.equal(parseListenerCount(raw, "/stream"), null);
});

test("returns null when source is missing (no one broadcasting)", () => {
  assert.equal(parseListenerCount({ icestats: {} }, "/stream"), null);
});

test("returns null when listeners field is not a number", () => {
  const raw = {
    icestats: {
      source: { listenurl: "http://host:8000/stream", listeners: "lots" },
    },
  };
  assert.equal(parseListenerCount(raw, "/stream"), null);
});

test("returns null when raw is not an object", () => {
  assert.equal(parseListenerCount(null, "/stream"), null);
  assert.equal(parseListenerCount("nope", "/stream"), null);
});
