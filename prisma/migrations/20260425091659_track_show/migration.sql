-- CreateEnum
CREATE TYPE "ShowBlock" AS ENUM ('night_shift', 'morning_room', 'daylight_channel', 'prime_hours');

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "show" "ShowBlock";

-- CreateIndex
CREATE INDEX "Track_stationId_show_trackStatus_airingPolicy_idx" ON "Track"("stationId", "show", "trackStatus", "airingPolicy");
