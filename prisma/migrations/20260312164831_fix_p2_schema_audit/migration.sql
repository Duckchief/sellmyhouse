-- AlterTable
ALTER TABLE "commission_invoices" ALTER COLUMN "amount" DROP DEFAULT,
ALTER COLUMN "gst_amount" DROP DEFAULT,
ALTER COLUMN "total_amount" DROP DEFAULT;

-- AlterTable
ALTER TABLE "financial_reports" ADD COLUMN     "disclaimer_acknowledged_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sellers" ADD COLUMN     "consultation_completed_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "cdd_records_subject_type_subject_id_idx" ON "cdd_records"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "financial_reports_seller_id_status_idx" ON "financial_reports"("seller_id", "status");

-- CreateIndex
CREATE INDEX "properties_seller_id_status_idx" ON "properties"("seller_id", "status");

-- CreateIndex
CREATE INDEX "transactions_property_id_idx" ON "transactions"("property_id");

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");
