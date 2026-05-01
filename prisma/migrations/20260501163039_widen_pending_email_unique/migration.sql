-- Widen the partial unique index to also cover 'uploading' submissions,
-- so two concurrent /api/submissions/init calls from the same email can
-- only ever produce one row (the loser hits P2002, which the route
-- handles by sweeping the stale row and retrying — same pattern the
-- old route used for 'pending'). Closes the TOCTOU window between the
-- findFirst stale-row check and the create.
DROP INDEX "MusicSubmission_email_pending_unique";
CREATE UNIQUE INDEX "MusicSubmission_email_pending_unique"
  ON "MusicSubmission" (email)
  WHERE status IN ('pending', 'uploading');
