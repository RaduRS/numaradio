-- AlterTable
ALTER TABLE "Station" ADD COLUMN     "youtubeChatPollMs" INTEGER NOT NULL DEFAULT 90000;

-- CreateTable
CREATE TABLE "YoutubeQuotaUsage" (
    "date" DATE NOT NULL,
    "unitsUsed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YoutubeQuotaUsage_pkey" PRIMARY KEY ("date")
);
