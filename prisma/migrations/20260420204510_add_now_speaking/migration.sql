-- CreateTable
CREATE TABLE "NowSpeaking" (
    "stationId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "expectedEndAt" TIMESTAMP(3) NOT NULL,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NowSpeaking_pkey" PRIMARY KEY ("stationId")
);
