-- CreateEnum
CREATE TYPE "VoiceProvider" AS ENUM ('deepgram', 'vertex');

-- AlterTable
ALTER TABLE "Station" ADD COLUMN     "voiceProvider" "VoiceProvider" NOT NULL DEFAULT 'deepgram';
