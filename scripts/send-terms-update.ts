import "../lib/load-env";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { sendTermsUpdateEmail } from "../lib/email/terms-update";

const EVENT_TYPE = "terms_update_notice_sent";
const SOURCE_TYPE = "music_submission";

interface Args {
  apply: boolean;
  toOverride: string | null;
}

function parseArgs(argv: string[]): Args {
  let apply = false;
  let toOverride: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--dry-run") apply = false;
    else if (a === "--to") {
      toOverride = argv[++i] ?? null;
      if (!toOverride) throw new Error("--to requires an email");
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  return { apply, toOverride };
}

async function loadRecipients(toOverride: string | null) {
  const rows = await prisma.musicSubmission.findMany({
    where: { status: "approved" },
    select: { artistName: true, email: true },
    orderBy: { createdAt: "asc" },
  });

  // Dedupe on email; keep the FIRST artistName seen (oldest submission).
  const unique = new Map<string, string>();
  for (const r of rows) {
    const email = r.email.trim().toLowerCase();
    if (!email) continue;
    if (!unique.has(email)) unique.set(email, r.artistName);
  }

  if (toOverride) {
    const lower = toOverride.trim().toLowerCase();
    const name = unique.get(lower) ?? "there";
    return [{ email: lower, artistName: name }];
  }

  return Array.from(unique, ([email, artistName]) => ({ email, artistName }));
}

async function loadAlreadyNotified(): Promise<Set<string>> {
  const rows = await prisma.systemEvent.findMany({
    where: { eventType: EVENT_TYPE, sourceType: SOURCE_TYPE },
    select: { sourceId: true },
  });
  return new Set(rows.map((r) => r.sourceId));
}

async function recordSent(email: string, artistName: string, resendId: string | undefined) {
  await prisma.systemEvent.create({
    data: {
      eventType: EVENT_TYPE,
      sourceType: SOURCE_TYPE,
      sourceId: email,
      payloadJson: {
        artistName,
        resendId: resendId ?? null,
      } as unknown as Prisma.InputJsonObject,
      processedAt: new Date(),
    },
  });
}

async function recordBatchAudit(summary: {
  totalSent: number;
  totalFailed: number;
  totalSkipped: number;
  recipients: { email: string; artistName: string; ok: boolean; reason?: string }[];
  toOverride: string | null;
}) {
  await prisma.systemEvent.create({
    data: {
      eventType: "terms_update_batch_run",
      sourceType: "script",
      sourceId: `send-terms-update:${new Date().toISOString()}`,
      payloadJson: summary as unknown as Prisma.InputJsonObject,
      processedAt: new Date(),
    },
  });
}

async function main() {
  const { apply, toOverride } = parseArgs(process.argv.slice(2));

  const recipients = await loadRecipients(toOverride);
  const alreadyNotified = await loadAlreadyNotified();
  const pending = recipients.filter((r) => !alreadyNotified.has(r.email));
  const skipped = recipients.length - pending.length;

  console.log("=".repeat(64));
  console.log(`Mode:           ${apply ? "APPLY (sending)" : "DRY-RUN (no sends)"}`);
  if (toOverride) console.log(`--to override:  ${toOverride}`);
  console.log(`Unique approved artists: ${recipients.length}`);
  console.log(`Already notified (skip): ${skipped}`);
  console.log(`To send this run:        ${pending.length}`);
  console.log("=".repeat(64));
  for (const r of pending) console.log(`  ${r.artistName} <${r.email}>`);
  console.log("=".repeat(64));

  if (!apply) {
    console.log("Dry-run complete. Re-run with --apply to send.");
    await prisma.$disconnect();
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY missing — refusing to --apply.");
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const log: { email: string; artistName: string; ok: boolean; reason?: string }[] = [];
  let totalSent = 0;
  let totalFailed = 0;

  for (const r of pending) {
    const res = await sendTermsUpdateEmail({ email: r.email, artistName: r.artistName });
    if (res.ok) {
      totalSent++;
      log.push({ email: r.email, artistName: r.artistName, ok: true });
      console.log(`[ok]   ${r.email} · ${r.artistName} · id=${res.id ?? "?"}`);
      await recordSent(r.email, r.artistName, res.id);
    } else {
      totalFailed++;
      const reason = res.skipped ? "skipped_no_api_key" : (res.error ?? "unknown");
      log.push({ email: r.email, artistName: r.artistName, ok: false, reason });
      console.log(`[fail] ${r.email} · ${r.artistName} · ${reason}`);
    }
    // Polite spacing — Resend free tier caps at 2/sec.
    await new Promise((r) => setTimeout(r, 600));
  }

  await recordBatchAudit({
    totalSent,
    totalFailed,
    totalSkipped: skipped,
    recipients: log,
    toOverride,
  });

  console.log("=".repeat(64));
  console.log(`Done. sent=${totalSent} failed=${totalFailed} skipped(prior)=${skipped}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
