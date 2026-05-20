// Draft email to submit artists — saves draft to /tmp/numa-farewell-email.txt
// Does NOT send. Review it, then run it for real with --send.
//
// Usage (from /home/marku/saas/numaradio):
//   npx tsx scripts/draft-goodbye-email.ts           # just save draft
//   npx tsx scripts/draft-goodbye-email.ts --send  # actually send

import "../lib/load-env";
import { writeFileSync } from "node:fs";
import { Resend } from "resend";
import { prisma } from "../lib/db";

const SEND = process.argv.includes("--send");
const FROM = "Numa Radio <hello@numaradio.com>";

const SUBJECT = "Numa Radio — Being Honest With You";

const BODY = `Hi [Artist Name],

I wanted to be transparent with you about where Numa Radio stands right now.

I built this from scratch — an AI-hosted radio station that I genuinely believed in, and still do. You were one of the artists who trusted it enough to submit your music, and that means a lot.

The honest situation is that the day-to-day running costs are significant, and without enough traction to sustain it, I am thinking that it might have come the time to close it down.

Either way, thank you for being part of something I think was genuinely ahead of its time.

— Numa Radio
https://numaradio.com`;

async function main() {
  const TEST_EMAILS = new Set([
    "test", "test@test.com", "fake@fake.com", "example@example.com",
  ]);

  const rows = await prisma.musicSubmission.findMany({
    select: { email: true },
    distinct: ["email"],
    where: {
      vouched: true,
    },
  });

  const emails = rows
    .map((r) => r.email)
    .filter((e) => e && !TEST_EMAILS.has(e.toLowerCase()));

  console.log(`Found ${emails.length} unique submitter emails\n`);

  if (SEND) {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      console.error("RESEND_API_KEY not set in .env.local");
      await prisma.$disconnect();
      process.exit(1);
    }
    const resend = new Resend(resendKey);
    let sent = 0;
    let failed = 0;
    for (const to of emails) {
      const firstName = to.split("@")[0].replace(/[.+_]/g, " ").replace(/\d+$/, "").trim();
      const personalized = BODY.replace("[Artist Name]", firstName || "there");
      const r = await resend.emails.send({
        from: FROM,
        to,
        subject: SUBJECT,
        text: personalized,
      });
      if (!r.error) {
        console.log(`  sent to ${to}`);
        sent++;
      } else {
        console.error(`  FAILED ${to}: ${r.error.message}`);
        failed++;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    console.log(`\nDone: ${sent} sent, ${failed} failed`);
  } else {
    const draftPath = "/tmp/numa-farewell-email.txt";
    const content = [
      `To: ${emails.join(", ")}`,
      `From: ${FROM}`,
      `Subject: ${SUBJECT}`,
      "",
      BODY,
    ].join("\n\n");
    writeFileSync(draftPath, content);
    console.log(`Draft saved to: ${draftPath}\n`);
    console.log(`Recipients (${emails.length}):`);
    emails.forEach((e) => console.log(" ", e));
  }

  await prisma.$disconnect();
}

main().catch(console.error);