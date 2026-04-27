-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('pending', 'approved', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "SubmissionAiringPreference" AS ENUM ('one_off', 'permanent');

-- CreateTable
CREATE TABLE "MusicSubmission" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "audioStorageKey" TEXT NOT NULL,
    "artworkStorageKey" TEXT,
    "artworkSource" TEXT,
    "durationSeconds" INTEGER,
    "airingPreference" "SubmissionAiringPreference" NOT NULL DEFAULT 'one_off',
    "status" "SubmissionStatus" NOT NULL DEFAULT 'pending',
    "vouched" BOOLEAN NOT NULL DEFAULT false,
    "rejectReason" TEXT,
    "trackId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "MusicSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MusicSubmission_status_createdAt_idx" ON "MusicSubmission"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MusicSubmission_email_status_idx" ON "MusicSubmission"("email", "status");

-- AddForeignKey
ALTER TABLE "MusicSubmission" ADD CONSTRAINT "MusicSubmission_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicSubmission" ADD CONSTRAINT "MusicSubmission_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
