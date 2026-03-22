-- CreateEnum
CREATE TYPE "SellingTimeline" AS ENUM ('one_to_three_months', 'three_to_six_months', 'just_thinking');

-- CreateEnum
CREATE TYPE "SellingReason" AS ENUM ('upgrading', 'downsizing', 'relocating', 'financial', 'investment', 'other');

-- AlterTable
ALTER TABLE "sellers" ADD COLUMN     "selling_reason" "SellingReason",
ADD COLUMN     "selling_reason_other" TEXT,
ADD COLUMN     "selling_timeline" "SellingTimeline";
