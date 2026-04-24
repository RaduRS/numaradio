-- CreateEnum
CREATE TYPE "AutoHostMode" AS ENUM ('auto', 'forced_on', 'forced_off');

-- AlterTable
ALTER TABLE "Station" DROP COLUMN "autoHostEnabled",
ADD COLUMN     "autoHostForcedBy" TEXT,
ADD COLUMN     "autoHostForcedUntil" TIMESTAMP(3),
ADD COLUMN     "autoHostMode" "AutoHostMode" NOT NULL DEFAULT 'auto';
