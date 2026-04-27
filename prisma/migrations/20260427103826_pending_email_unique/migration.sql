-- Partial unique index: at most one pending submission per email at any time.
-- Closes the findFirst→create race window in POST /api/submissions.
-- The route handles violations by catching Prisma error code P2002 and
-- returning the same 429 message the rate-limit check already returns.
CREATE UNIQUE INDEX "MusicSubmission_email_pending_unique"
  ON "MusicSubmission" (email)
  WHERE status = 'pending';
