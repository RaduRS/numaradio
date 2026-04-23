import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeIpcMessage } from "./ipc-writer.ts";

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "ipc-writer-test-"));
}

test("writeIpcMessage writes the expected JSON shape to <dir>/held-<id>.json", async () => {
  const dir = await tmpDir();
  try {
    await writeIpcMessage({
      dir,
      shoutoutId: "abc123",
      chatJid: "555",
      text: "hello",
    });
    const body = await fs.readFile(path.join(dir, "held-abc123.json"), "utf8");
    const parsed = JSON.parse(body);
    assert.deepEqual(parsed, {
      type: "message",
      chatJid: "555",
      text: "hello",
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("writeIpcMessage overwrites an existing file atomically (no .tmp left behind)", async () => {
  const dir = await tmpDir();
  try {
    await writeIpcMessage({ dir, shoutoutId: "x", chatJid: "1", text: "a" });
    await writeIpcMessage({ dir, shoutoutId: "x", chatJid: "1", text: "b" });
    const files = await fs.readdir(dir);
    assert.deepEqual(files.sort(), ["held-x.json"]);
    const parsed = JSON.parse(
      await fs.readFile(path.join(dir, "held-x.json"), "utf8"),
    );
    assert.equal(parsed.text, "b");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("writeIpcMessage rejects when the target directory does not exist", async () => {
  await assert.rejects(
    () =>
      writeIpcMessage({
        dir: "/nonexistent/does/not/exist",
        shoutoutId: "x",
        chatJid: "1",
        text: "a",
      }),
    /ENOENT/,
  );
});

test("writeIpcMessage rejects ids that contain path separators", async () => {
  const dir = await tmpDir();
  try {
    await assert.rejects(
      () =>
        writeIpcMessage({
          dir,
          shoutoutId: "../escape",
          chatJid: "1",
          text: "a",
        }),
      /invalid shoutout id/i,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("writeIpcMessage forwards persistInContext and senderName when set", async () => {
  const dir = await tmpDir();
  try {
    await writeIpcMessage({
      dir,
      shoutoutId: "held-xyz",
      chatJid: "tg:555",
      text: "Held shoutout awaiting your call",
      persistInContext: true,
      senderName: "Dashboard",
    });
    const parsed = JSON.parse(
      await fs.readFile(path.join(dir, "held-held-xyz.json"), "utf8"),
    );
    assert.deepEqual(parsed, {
      type: "message",
      chatJid: "tg:555",
      text: "Held shoutout awaiting your call",
      persistInContext: true,
      senderName: "Dashboard",
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("writeIpcMessage omits optional fields when not set (backward compat)", async () => {
  const dir = await tmpDir();
  try {
    await writeIpcMessage({
      dir,
      shoutoutId: "compat",
      chatJid: "tg:1",
      text: "plain",
    });
    const parsed = JSON.parse(
      await fs.readFile(path.join(dir, "held-compat.json"), "utf8"),
    );
    assert.deepEqual(parsed, {
      type: "message",
      chatJid: "tg:1",
      text: "plain",
    });
    assert.equal("persistInContext" in parsed, false);
    assert.equal("senderName" in parsed, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
