import { test } from "node:test";
import assert from "node:assert/strict";
import { Client as PgClient } from "pg";
import "../../../lib/load-env.ts";
import { NotifyListener, parseNotifyPayload } from "./notify-listener.ts";
import { ShiftMemory } from "./shift-memory.ts";

test("NotifyListener round-trip: NOTIFY → onEvent → ShiftMemory.record", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL not set");
    return;
  }

  // Check if this is a pooled connection (dev setup). Neon pooler doesn't support LISTEN/NOTIFY.
  if (process.env.DATABASE_URL.includes("pooler")) {
    t.skip("DATABASE_URL uses pooled connection (Neon pooler doesn't support LISTEN/NOTIFY)");
    return;
  }

  const mem = new ShiftMemory();
  let eventReceived: boolean = false;
  const listener = new NotifyListener({
    connectionString: process.env.DATABASE_URL,
    onEvent: (ev) => {
      eventReceived = true;
      mem.record(ev);
    },
  });
  await listener.start();

  // Wait briefly to ensure LISTEN is registered
  await new Promise((r) => setTimeout(r, 200));

  // Emit via a second client (mirrors how the Next.js side will emit)
  const emitter = new PgClient({ connectionString: process.env.DATABASE_URL });
  await emitter.connect();
  const payload = {
    type: "shoutout_aired",
    id: `integ-${Date.now()}`,
    handle: "test",
    originalText: "round trip",
    airedAt: Date.now(),
  };
  const payloadStr = JSON.stringify(payload);

  // Verify the payload parses correctly
  const parsed = parseNotifyPayload(payloadStr);
  assert.ok(parsed, `payload should parse, got: ${parsed}`);

  await emitter.query(`SELECT pg_notify('lena_event', $1)`, [payloadStr]);
  await emitter.end();

  // Wait for the message to flow through
  await new Promise((r) => setTimeout(r, 500));

  const view = mem.view(Date.now());
  const found = view.events.find((e) => e.id === payload.id);
  assert.ok(eventReceived, "onEvent callback should have been called");
  assert.ok(found, `expected NOTIFY payload to land in ShiftMemory, events: ${JSON.stringify(view.events)}`);
  await listener.stop();
});
