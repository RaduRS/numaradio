-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "loudnessLufs" DOUBLE PRECISION,
ADD COLUMN     "loudnessSourceLufs" DOUBLE PRECISION,
ADD COLUMN     "loudnessTruePeakDbtp" DOUBLE PRECISION;
