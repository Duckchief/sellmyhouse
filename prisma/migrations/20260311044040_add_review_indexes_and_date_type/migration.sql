-- AlterTable
ALTER TABLE "weekly_updates" ALTER COLUMN "week_of" SET DATA TYPE DATE;

-- CreateIndex
CREATE INDEX "document_checklists_status_idx" ON "document_checklists"("status");

-- CreateIndex
CREATE INDEX "document_checklists_seller_id_status_idx" ON "document_checklists"("seller_id", "status");

-- CreateIndex
CREATE INDEX "weekly_updates_status_idx" ON "weekly_updates"("status");

-- CreateIndex
CREATE INDEX "weekly_updates_seller_id_status_idx" ON "weekly_updates"("seller_id", "status");
