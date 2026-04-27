-- Add withdrawal lifecycle columns to MusicSubmission so the operator
-- can pull a track from rotation when an artist asks (per privacy
-- policy / GDPR-style right-to-withdraw), with audit trail.
ALTER TABLE "MusicSubmission" ADD COLUMN "withdrawnAt" TIMESTAMP(3);
ALTER TABLE "MusicSubmission" ADD COLUMN "withdrawnReason" TEXT;
