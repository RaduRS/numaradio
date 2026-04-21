import fs from "node:fs/promises";
import path from "node:path";

export interface WriteIpcMessageInput {
  dir: string;
  shoutoutId: string;
  chatJid: string;
  text: string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export async function writeIpcMessage(input: WriteIpcMessageInput): Promise<void> {
  const { dir, shoutoutId, chatJid, text } = input;
  if (!ID_PATTERN.test(shoutoutId)) {
    throw new Error(`invalid shoutout id: ${shoutoutId}`);
  }
  const finalPath = path.join(dir, `held-${shoutoutId}.json`);
  const tmpPath = `${finalPath}.tmp`;
  const payload = JSON.stringify({ type: "message", chatJid, text });
  await fs.writeFile(tmpPath, payload, "utf8");
  await fs.rename(tmpPath, finalPath);
}
