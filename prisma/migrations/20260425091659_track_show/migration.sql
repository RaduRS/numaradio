-- CreateEnum
CREATE TYPE "ShowBlock" AS ENUM ('night_shift', 'morning_room', 'daylight_channel', 'prime_hours');

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "show" "ShowBlock";

-- CreateIndex
CREATE INDEX "Track_stationId_show_trackStatus_airingPolicy_idx" ON "Track"("stationId", "show", "trackStatus", "airingPolicy");

-- ─── Heuristic backfill ─────────────────────────────────────────────
UPDATE "Track" SET "show" = 'night_shift'
 WHERE "show" IS NULL
   AND ("bpm" IS NULL OR "bpm" < 95)
   AND "mood" IN ('Calm', 'Dreamy', 'Mellow', 'Dark', 'Melancholic');

UPDATE "Track" SET "show" = 'morning_room'
 WHERE "show" IS NULL
   AND ("bpm" IS NULL OR "bpm" BETWEEN 95 AND 115)
   AND "mood" IN ('Bright', 'Summer', 'Uplifting', 'Romantic');

UPDATE "Track" SET "show" = 'prime_hours'
 WHERE "show" IS NULL
   AND ("bpm" IS NULL OR "bpm" > 115)
   AND "mood" IN ('Energetic', 'Hype', 'Groovy');

UPDATE "Track" SET "show" = 'daylight_channel'
 WHERE "show" IS NULL
   AND ("bpm" IS NULL OR "bpm" BETWEEN 105 AND 125)
   AND "genre" ILIKE ANY (ARRAY['NuDisco', 'Disco', 'Funk', 'House', 'FunkyHouse', 'Lofi', 'Lo-fi']);

UPDATE "Track" SET "show" = 'night_shift'
 WHERE "show" IS NULL
   AND "genre" ILIKE ANY (ARRAY['Ambient', 'Lofi', 'Lo-fi', 'Downtempo']);

UPDATE "Track" SET "show" = 'prime_hours'
 WHERE "show" IS NULL
   AND "genre" ILIKE ANY (ARRAY['DnB', 'Drum and Bass', 'Techno', 'Trance']);

UPDATE "Track" SET "show" = 'night_shift'
 WHERE "show" IS NULL AND "bpm" IS NOT NULL AND "bpm" < 90;

UPDATE "Track" SET "show" = 'morning_room'
 WHERE "show" IS NULL AND "bpm" IS NOT NULL AND "bpm" BETWEEN 90 AND 110;

UPDATE "Track" SET "show" = 'prime_hours'
 WHERE "show" IS NULL AND "bpm" IS NOT NULL AND "bpm" > 125;

UPDATE "Track" SET "show" = 'daylight_channel' WHERE "show" IS NULL;
