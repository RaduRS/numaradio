-- CreateTable
CREATE TABLE "Chatter" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "chatterType" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "script" TEXT NOT NULL,
    "audioUrl" TEXT,
    "airedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Chatter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Chatter_stationId_airedAt_idx" ON "Chatter"("stationId", "airedAt");

-- AddForeignKey
ALTER TABLE "Chatter" ADD CONSTRAINT "Chatter_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
