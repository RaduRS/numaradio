import fs from "node:fs/promises";
import path from "node:path";

export interface WriteIpcMessageInput {
  dir: string;
  shoutoutId: string;
  chatJid: string;
  text: string;
  /**
   * If set, forwarded to NanoClaw to control whether the message is
   * persisted in the agent's SQLite context. Omit to use NanoClaw's
   * default (persist iff target chat is a registered agent group).
   */
  persistInContext?: boolean;
  /**
   * If set, becomes the `sender_name` on the persisted row. Useful for
   * audit ("Dashboard" vs. a future "Autochatter", etc.).
   */
  senderName?: string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export async function writeIpcMessage(input: WriteIpcMessageInput): Promise<void> {
  const { dir, shoutoutId, chatJid, text, persistInContext, senderName } = input;
  if (!ID_PATTERN.test(shoutoutId)) {
    throw new Error(`invalid shoutout id: ${shoutoutId}`);
  }
  const finalPath = path.join(dir, `held-${shoutoutId}.json`);
  const tmpPath = `${finalPath}.tmp`;
  const payload: Record<string, unknown> = { type: "message", chatJid, text };
  if (persistInContext !== undefined) payload.persistInContext = persistInContext;
  if (senderName !== undefined) payload.senderName = senderName;
  await fs.writeFile(tmpPath, JSON.stringify(payload), "utf8");
  await fs.rename(tmpPath, finalPath);
}
