// Sends one approve + one reject email to a test recipient with mock
// data so the operator can eyeball the templates before exposing them
// to real artists.
//
// Usage:
//   RESEND_API_KEY=re_xxx npx tsx scripts/test-send-submission-emails.ts <recipient@example.com>
//
// Both templates get sent, ~1s apart. Look for delivery + formatting
// in the recipient inbox and Resend dashboard logs.

import "../lib/load-env";
import { sendSubmissionApprovedEmail } from "../lib/email/submission-approved";
import { sendSubmissionRejectedEmail } from "../lib/email/submission-rejected";

async function main() {
  const to = process.argv[2];
  if (!to || !to.includes("@")) {
    console.error("Usage: tsx scripts/test-send-submission-emails.ts <recipient@example.com>");
    process.exit(1);
  }
  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not set in env. Add to .env.local or pass inline.");
    process.exit(1);
  }

  console.log(`→ approve email to ${to}`);
  const approve = await sendSubmissionApprovedEmail({
    email: to,
    artistName: "Test Artist",
    trackTitle: "Midnight Static",
    durationSeconds: 207,
    airingPreference: "permanent",
  });
  console.log("  result:", approve);

  await new Promise((r) => setTimeout(r, 1000));

  console.log(`→ reject email to ${to}`);
  const reject = await sendSubmissionRejectedEmail({
    email: to,
    artistName: "Test Artist",
    trackTitle: "Test Demo",
    durationSeconds: 134,
    airingPreference: "one_off",
    submittedAt: new Date(Date.now() - 86_400_000),
    reason: "Audio quality not radio-ready (mastering, distortion, low bitrate). Notes: clip on the chorus is loud enough to register as distortion on most playback systems.",
  });
  console.log("  result:", reject);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
