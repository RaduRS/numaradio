-- AlterTable
ALTER TABLE "Station" ADD COLUMN     "worldAsideForcedBy" TEXT,
ADD COLUMN     "worldAsideForcedUntil" TIMESTAMP(3),
ADD COLUMN     "worldAsideMode" "AutoHostMode" NOT NULL DEFAULT 'auto';
