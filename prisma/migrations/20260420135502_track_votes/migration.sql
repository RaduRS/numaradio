-- CreateTable
CREATE TABLE "TrackVote" (
    "trackId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackVote_pkey" PRIMARY KEY ("trackId","sessionId")
);

-- CreateIndex
CREATE INDEX "TrackVote_trackId_value_idx" ON "TrackVote"("trackId", "value");

-- AddForeignKey
ALTER TABLE "TrackVote" ADD CONSTRAINT "TrackVote_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
