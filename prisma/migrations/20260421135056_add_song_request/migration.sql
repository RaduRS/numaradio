-- CreateTable
CREATE TABLE "SongRequest" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "originalArtistName" TEXT,
    "isInstrumental" BOOLEAN NOT NULL DEFAULT false,
    "lyricsFallback" BOOLEAN NOT NULL DEFAULT false,
    "moderationStatus" TEXT NOT NULL,
    "moderationReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "errorMessage" TEXT,
    "miniMaxTaskId" TEXT,
    "titleGenerated" TEXT,
    "artworkPrompt" TEXT,
    "lyricsGenerated" TEXT,
    "trackId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SongRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SongRequest_status_createdAt_idx" ON "SongRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SongRequest_ipHash_createdAt_idx" ON "SongRequest"("ipHash", "createdAt");

-- AddForeignKey
ALTER TABLE "SongRequest" ADD CONSTRAINT "SongRequest_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongRequest" ADD CONSTRAINT "SongRequest_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
