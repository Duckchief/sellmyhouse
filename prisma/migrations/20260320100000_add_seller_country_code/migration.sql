-- AlterTable
ALTER TABLE "sellers" ADD COLUMN     "country_code" TEXT NOT NULL DEFAULT '+65',
ADD COLUMN     "national_number" TEXT;

-- Backfill nationalNumber from phone for existing rows
UPDATE "sellers" SET "national_number" = "phone" WHERE "national_number" IS NULL;
