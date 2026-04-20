-- CreateTable
CREATE TABLE "SiteVisitor" (
    "sessionId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteVisitor_pkey" PRIMARY KEY ("sessionId")
);

-- CreateIndex
CREATE INDEX "SiteVisitor_lastSeenAt_idx" ON "SiteVisitor"("lastSeenAt");
