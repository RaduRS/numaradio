-- CreateEnum
CREATE TYPE "StationStatus" AS ENUM ('active', 'maintenance', 'paused');

-- CreateEnum
CREATE TYPE "TrackSourceType" AS ENUM ('suno_manual', 'minimax_request', 'external_import', 'internal_test');

-- CreateEnum
CREATE TYPE "TrackStatus" AS ENUM ('draft', 'processing', 'ready', 'queued', 'playing', 'played', 'held', 'archived', 'failed');

-- CreateEnum
CREATE TYPE "AiringPolicy" AS ENUM ('library', 'request_only', 'priority_request', 'hold');

-- CreateEnum
CREATE TYPE "SafetyStatus" AS ENUM ('pending', 'approved', 'blocked', 'needs_review');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('submitted', 'rate_limited', 'rejected_policy', 'queued', 'sanitizing', 'deduplicated', 'prompt_ready', 'generating_song', 'song_failed', 'generating_art', 'art_failed', 'assembling_track', 'ready_for_queue', 'queued_for_air', 'aired', 'expired');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('pending', 'allowed', 'rewritten', 'blocked', 'held');

-- CreateEnum
CREATE TYPE "QueueType" AS ENUM ('music', 'host_intro', 'host_outro', 'shoutout', 'station_id', 'weather', 'transition');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('planned', 'reserved', 'staged', 'playing', 'completed', 'skipped', 'cancelled', 'failed');

-- CreateEnum
CREATE TYPE "SegmentType" AS ENUM ('audio_track', 'audio_host', 'audio_id', 'audio_transition');

-- CreateEnum
CREATE TYPE "PlaybackStatus" AS ENUM ('planned', 'staged', 'started', 'completed', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "WorkflowType" AS ENUM ('request_generation', 'shoutout_preparation', 'track_ingest', 'queue_repair', 'host_generation', 'asset_cleanup');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('created', 'running', 'waiting_callback', 'retrying', 'completed', 'failed', 'aborted');

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "StationStatus" NOT NULL DEFAULT 'active',
    "streamUrl" TEXT,
    "defaultVoiceProfile" TEXT,
    "defaultArtStyle" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/London',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "sourceType" "TrackSourceType" NOT NULL,
    "sourceReference" TEXT,
    "title" TEXT NOT NULL,
    "artistDisplay" TEXT,
    "description" TEXT,
    "mood" TEXT,
    "genre" TEXT,
    "bpm" INTEGER,
    "durationSeconds" INTEGER,
    "language" TEXT,
    "lyricsSummary" TEXT,
    "promptSummary" TEXT,
    "provenanceJson" JSONB,
    "rightsPolicy" TEXT,
    "airingPolicy" "AiringPolicy" NOT NULL DEFAULT 'library',
    "safetyStatus" "SafetyStatus" NOT NULL DEFAULT 'pending',
    "trackStatus" "TrackStatus" NOT NULL DEFAULT 'draft',
    "primaryAudioAssetId" TEXT,
    "primaryArtAssetId" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackAsset" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'b2',
    "storageKey" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "mimeType" TEXT,
    "byteSize" INTEGER,
    "durationSeconds" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "publicRequestCode" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "cleanText" TEXT,
    "promptPayloadJson" JSONB,
    "requesterName" TEXT,
    "requesterLocation" TEXT,
    "fingerprintHash" TEXT,
    "ipHash" TEXT,
    "requestStatus" "RequestStatus" NOT NULL DEFAULT 'submitted',
    "priorityScore" INTEGER NOT NULL DEFAULT 0,
    "queuePositionEstimate" INTEGER,
    "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'pending',
    "moderationReason" TEXT,
    "dedupeKey" TEXT,
    "resultTrackId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "message" TEXT,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shoutout" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "cleanText" TEXT,
    "broadcastText" TEXT,
    "requesterName" TEXT,
    "fingerprintHash" TEXT,
    "ipHash" TEXT,
    "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'pending',
    "moderationReason" TEXT,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'pending',
    "linkedQueueItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shoutout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "voteType" TEXT NOT NULL,
    "fingerprintHash" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueItem" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "queueType" "QueueType" NOT NULL,
    "sourceObjectType" TEXT NOT NULL,
    "sourceObjectId" TEXT NOT NULL,
    "trackId" TEXT,
    "assetId" TEXT,
    "plannedStartAt" TIMESTAMP(3),
    "estimatedDurationSeconds" INTEGER,
    "priorityBand" TEXT NOT NULL DEFAULT 'normal',
    "queueStatus" "QueueStatus" NOT NULL DEFAULT 'planned',
    "positionIndex" INTEGER NOT NULL,
    "generationGroupId" TEXT,
    "reasonCode" TEXT,
    "insertedBy" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastSegment" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "queueItemId" TEXT NOT NULL,
    "segmentType" "SegmentType" NOT NULL,
    "assetId" TEXT NOT NULL,
    "segmentOrder" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "playbackStatus" "PlaybackStatus" NOT NULL DEFAULT 'planned',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NowPlaying" (
    "stationId" TEXT NOT NULL,
    "currentQueueItemId" TEXT,
    "currentSegmentId" TEXT,
    "currentTrackId" TEXT,
    "currentAssetId" TEXT,
    "startedAt" TIMESTAMP(3),
    "expectedEndAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NowPlaying_pkey" PRIMARY KEY ("stationId")
);

-- CreateTable
CREATE TABLE "PlayHistory" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "queueItemId" TEXT,
    "segmentId" TEXT,
    "trackId" TEXT,
    "segmentType" TEXT NOT NULL,
    "titleSnapshot" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "completedNormally" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationFlag" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "detailsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "workflowType" "WorkflowType" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "runStatus" "WorkflowStatus" NOT NULL DEFAULT 'created',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "payloadJson" JSONB,
    "resultJson" JSONB,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "SystemEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Station_slug_key" ON "Station"("slug");

-- CreateIndex
CREATE INDEX "Track_stationId_trackStatus_airingPolicy_idx" ON "Track"("stationId", "trackStatus", "airingPolicy");

-- CreateIndex
CREATE UNIQUE INDEX "TrackAsset_storageKey_key" ON "TrackAsset"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "Request_publicRequestCode_key" ON "Request"("publicRequestCode");

-- CreateIndex
CREATE INDEX "Request_requestStatus_submittedAt_idx" ON "Request"("requestStatus", "submittedAt");

-- CreateIndex
CREATE INDEX "Shoutout_moderationStatus_deliveryStatus_createdAt_idx" ON "Shoutout"("moderationStatus", "deliveryStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Vote_trackId_createdAt_idx" ON "Vote"("trackId", "createdAt");

-- CreateIndex
CREATE INDEX "QueueItem_stationId_queueStatus_positionIndex_idx" ON "QueueItem"("stationId", "queueStatus", "positionIndex");

-- CreateIndex
CREATE INDEX "BroadcastSegment_playbackStatus_createdAt_idx" ON "BroadcastSegment"("playbackStatus", "createdAt");

-- CreateIndex
CREATE INDEX "PlayHistory_stationId_startedAt_idx" ON "PlayHistory"("stationId", "startedAt");

-- CreateIndex
CREATE INDEX "ModerationFlag_sourceType_sourceId_idx" ON "ModerationFlag"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "WorkflowRun_runStatus_workflowType_startedAt_idx" ON "WorkflowRun"("runStatus", "workflowType", "startedAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_sourceType_sourceId_idx" ON "WorkflowRun"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "SystemEvent_eventType_processedAt_createdAt_idx" ON "SystemEvent"("eventType", "processedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackAsset" ADD CONSTRAINT "TrackAsset_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestEvent" ADD CONSTRAINT "RequestEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shoutout" ADD CONSTRAINT "Shoutout_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "TrackAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastSegment" ADD CONSTRAINT "BroadcastSegment_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastSegment" ADD CONSTRAINT "BroadcastSegment_queueItemId_fkey" FOREIGN KEY ("queueItemId") REFERENCES "QueueItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastSegment" ADD CONSTRAINT "BroadcastSegment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "TrackAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayHistory" ADD CONSTRAINT "PlayHistory_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayHistory" ADD CONSTRAINT "PlayHistory_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
