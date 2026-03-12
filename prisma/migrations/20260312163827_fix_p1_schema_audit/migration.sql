/*
  Warnings:

  - The `status` column on the `document_checklists` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `weekly_updates` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "WeeklyUpdateStatus" AS ENUM ('draft', 'ai_generated', 'pending_review', 'approved', 'rejected', 'sent');

-- CreateEnum
CREATE TYPE "DocumentChecklistStatus" AS ENUM ('draft', 'pending_review', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "document_checklists" DROP COLUMN "status",
ADD COLUMN     "status" "DocumentChecklistStatus" NOT NULL DEFAULT 'draft';

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "ai_description" TEXT,
ADD COLUMN     "ai_description_generated_at" TIMESTAMP(3),
ADD COLUMN     "ai_description_model" TEXT,
ADD COLUMN     "ai_description_provider" TEXT,
ADD COLUMN     "ai_description_status" TEXT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "estate_agency_agreement_id" TEXT;

-- AlterTable
ALTER TABLE "weekly_updates" DROP COLUMN "status",
ADD COLUMN     "status" "WeeklyUpdateStatus" NOT NULL DEFAULT 'draft';

-- CreateIndex
CREATE INDEX "document_checklists_status_idx" ON "document_checklists"("status");

-- CreateIndex
CREATE INDEX "document_checklists_seller_id_status_idx" ON "document_checklists"("seller_id", "status");

-- CreateIndex
CREATE INDEX "listings_property_id_status_idx" ON "listings"("property_id", "status");

-- CreateIndex
CREATE INDEX "weekly_updates_status_idx" ON "weekly_updates"("status");

-- CreateIndex
CREATE INDEX "weekly_updates_seller_id_status_idx" ON "weekly_updates"("seller_id", "status");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_estate_agency_agreement_id_fkey" FOREIGN KEY ("estate_agency_agreement_id") REFERENCES "estate_agency_agreements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
