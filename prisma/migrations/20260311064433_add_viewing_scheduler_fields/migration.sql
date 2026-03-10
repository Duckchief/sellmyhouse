-- AlterEnum
ALTER TYPE "RecipientType" ADD VALUE 'viewer';

-- AlterTable: Add slug to properties
ALTER TABLE "properties" ADD COLUMN "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "properties_slug_key" ON "properties"("slug");

-- AlterTable: Add noShowCount to verified_viewers
ALTER TABLE "verified_viewers" ADD COLUMN "no_show_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: Add OTP and interest rating fields to viewings
ALTER TABLE "viewings" ADD COLUMN "interest_rating" INTEGER;
ALTER TABLE "viewings" ADD COLUMN "otp_hash" TEXT;
ALTER TABLE "viewings" ADD COLUMN "otp_expires_at" TIMESTAMP(3);
ALTER TABLE "viewings" ADD COLUMN "otp_attempts" INTEGER NOT NULL DEFAULT 0;
