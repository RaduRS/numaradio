-- P1 audit migration:
--   1. Convert Shoutout.deliveryStatus String → DeliveryStatus enum
--      (was a freeform String; typo would silently disappear from
--      operator queue queries)
--   2. Add four hot-path indexes that were doing seq-scans:
--        Shoutout(ipHash, createdAt)        — booth submit rate-limit
--        Shoutout(fingerprintHash)          — yt-chat idempotency
--        PlayHistory(trackId)               — delete-aired-shoutout
--        QueueItem(trackId)                 — delete-aired-shoutout
--        Track(stationId, title)            — track-started fallback

-- Existing rows in Shoutout.deliveryStatus use these values:
--   pending, moderating, held, aired, failed, blocked.
-- The defensive UPDATE below normalises any unexpected legacy value
-- (capitalisation, typo) to 'failed' so the type cast can't fail
-- mid-migration.
UPDATE "Shoutout"
   SET "deliveryStatus" = 'failed'
 WHERE "deliveryStatus" NOT IN ('pending', 'moderating', 'held', 'aired', 'failed', 'blocked');

CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'moderating', 'held', 'aired', 'failed', 'blocked');

-- ALTER COLUMN TYPE rewrites the column data and automatically
-- reformats the existing index Shoutout_moderationStatus_deliveryStatus_createdAt_idx
-- against the new type — no need to DROP/CREATE that index manually.
ALTER TABLE "Shoutout" ALTER COLUMN "deliveryStatus" DROP DEFAULT;
ALTER TABLE "Shoutout"
  ALTER COLUMN "deliveryStatus"
  TYPE "DeliveryStatus"
  USING ("deliveryStatus"::text::"DeliveryStatus");
ALTER TABLE "Shoutout" ALTER COLUMN "deliveryStatus" SET DEFAULT 'pending';
ALTER TABLE "Shoutout" ALTER COLUMN "deliveryStatus" SET NOT NULL;

-- Hot-path indexes
CREATE INDEX "Shoutout_ipHash_createdAt_idx" ON "Shoutout"("ipHash", "createdAt");
CREATE INDEX "Shoutout_fingerprintHash_idx" ON "Shoutout"("fingerprintHash");
CREATE INDEX "PlayHistory_trackId_idx" ON "PlayHistory"("trackId");
CREATE INDEX "QueueItem_trackId_idx" ON "QueueItem"("trackId");
CREATE INDEX "Track_stationId_title_idx" ON "Track"("stationId", "title");
