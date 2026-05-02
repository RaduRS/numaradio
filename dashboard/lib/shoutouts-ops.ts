import type { Pool } from "pg";

export type ApproveCode =
  | "not_found"
  | "already_aired"
  | "not_held"
  | "generate_failed";
export type RejectCode = "not_found" | "already_aired" | "not_held";

export interface GenerateShoutoutResult {
  trackId: string;
  sourceUrl: string;
  queueItemId: string;
  durationHintSeconds?: number;
  /** Final text Lena actually spoke — post-humanize + post-radioHost
   *  transform. The approve path persists this as broadcastText so
   *  the operator audit reflects what listeners heard, not the raw
   *  listener input. Optional for back-compat with older callers. */
  spokenText?: string;
}

export interface GenerateShoutoutInput {
  text: string;
  shoutoutRowId: string;
  requesterName?: string;
  pool: Pool;
}

export type GenerateShoutoutFn = (
  input: GenerateShoutoutInput,
) => Promise<GenerateShoutoutResult>;

export interface ApproveInput {
  id: string;
  operator: string;
  pool: Pool;
  generate: GenerateShoutoutFn;
}

export interface RejectInput {
  id: string;
  operator: string;
  pool: Pool;
  reasonHint?: string;
}

export type ApproveResult =
  | { ok: true; trackId: string; queueItemId: string }
  | { ok: false; code: ApproveCode; error?: string };

export type RejectResult =
  | { ok: true }
  | { ok: false; code: RejectCode };

async function classifyMissInto(
  pool: Pool,
  id: string,
): Promise<"not_found" | "already_aired" | "not_held"> {
  const { rows } = await pool.query<{
    deliveryStatus: string;
    moderationStatus: string;
  }>(
    `SELECT "deliveryStatus", "moderationStatus" FROM "Shoutout" WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (rows.length === 0) return "not_found";
  if (rows[0].deliveryStatus === "aired") return "already_aired";
  // After the approve-revives-blocked change, the only remaining
  // path that lands here is a row that's failed/pending/etc — call
  // it not_held since that's the closest existing label.
  return "not_held";
}

export async function approveShoutout(input: ApproveInput): Promise<ApproveResult> {
  const { id, operator, pool, generate } = input;
  // Approve covers two flows: held → allowed (the original moderation
  // flow) AND blocked → allowed (operator overrides a NanoClaw or
  // moderator block). The only hard guard is "hasn't already aired"
  // because re-airing duplicates audio. The previous moderationReason
  // is preserved by prefixing the new one — the audit trail tells you
  // it was revived from a block, not just held.
  const reserved = await pool.query<{
    id: string;
    rawText: string;
    cleanText: string | null;
    requesterName: string | null;
  }>(
    `UPDATE "Shoutout"
        SET "moderationStatus" = 'allowed',
            "moderationReason" = CASE
              WHEN "moderationStatus" = 'blocked'
                THEN $2 || ' revived_from_blocked prior=' || COALESCE("moderationReason", '')
              ELSE $2
            END,
            "deliveryStatus"   = 'pending',
            "updatedAt"        = NOW()
      WHERE id = $1
        AND "moderationStatus" IN ('held', 'blocked')
        AND "deliveryStatus"   != 'aired'
      RETURNING id, "rawText", "cleanText", "requesterName"`,
    [id, `approved_by:${operator}`],
  );

  if (reserved.rowCount === 0) {
    const code = await classifyMissInto(pool, id);
    return { ok: false, code };
  }

  const row = reserved.rows[0];
  const text = (row.cleanText ?? row.rawText).trim();

  try {
    const gen = await generate({
      text,
      shoutoutRowId: id,
      requesterName: row.requesterName ?? undefined,
      pool,
    });
    // The shoutout is already on Liquidsoap's overlay queue at this
    // point — gen() has pushed it. If this final UPDATE fails for a
    // transient reason, the row stays at 'pending' but the audio
    // will still air. The shoutout-ended Liquidsoap callback flips
    // deliveryStatus to 'aired' as a backstop, so the worst outcome
    // is a brief stale 'pending' on the operator dashboard. Retry
    // once with a small backoff to make that even less likely.
    try {
      await pool.query(
        `UPDATE "Shoutout"
            SET "deliveryStatus"    = 'aired',
                "linkedQueueItemId" = $2,
                "broadcastText"     = $3,
                "updatedAt"         = NOW()
          WHERE id = $1`,
        // Use the spoken text Lena actually aired (post-humanize +
        // post-radio-host transform), not the listener's raw input.
        // Falls back to input only if generateShoutout didn't return
        // spokenText (defensive — current implementation always does).
        [id, gen.queueItemId, (gen.spokenText ?? text).slice(0, 500)],
      );
    } catch (e) {
      console.warn(
        `[shoutouts-ops] post-generate UPDATE failed for ${id}, retrying once: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      await new Promise((r) => setTimeout(r, 250));
      await pool.query(
        `UPDATE "Shoutout"
            SET "deliveryStatus"    = 'aired',
                "linkedQueueItemId" = $2,
                "broadcastText"     = $3,
                "updatedAt"         = NOW()
          WHERE id = $1`,
        // Use the spoken text Lena actually aired (post-humanize +
        // post-radio-host transform), not the listener's raw input.
        // Falls back to input only if generateShoutout didn't return
        // spokenText (defensive — current implementation always does).
        [id, gen.queueItemId, (gen.spokenText ?? text).slice(0, 500)],
      );
    }
    return { ok: true, trackId: gen.trackId, queueItemId: gen.queueItemId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "generate_failed";
    await pool.query(
      `UPDATE "Shoutout"
          SET "deliveryStatus"   = 'failed',
              "moderationReason" = $2,
              "updatedAt"        = NOW()
        WHERE id = $1`,
      [id, msg.slice(0, 200)],
    );
    return { ok: false, code: "generate_failed", error: msg };
  }
}

export async function rejectShoutout(input: RejectInput): Promise<RejectResult> {
  const { id, operator, pool, reasonHint } = input;
  const clipped = reasonHint ? reasonHint.slice(0, 200) : undefined;
  const reason = clipped
    ? `rejected_by:${operator} reason=${clipped}`
    : `rejected_by:${operator}`;

  const res = await pool.query(
    `UPDATE "Shoutout"
        SET "moderationStatus" = 'blocked',
            "deliveryStatus"   = 'blocked',
            "moderationReason" = $2,
            "updatedAt"        = NOW()
      WHERE id = $1
        AND "moderationStatus" = 'held'`,
    [id, reason],
  );

  if (res.rowCount === 0) {
    const code = await classifyMissInto(pool, id);
    return { ok: false, code };
  }
  return { ok: true };
}
