-- DB Audit Stage 3: Additional indexes, missing updatedAt fields, AiAnalysisStatus enum

-- CreateEnum
CREATE TYPE "AiAnalysisStatus" AS ENUM ('generated', 'reviewed', 'shared');

-- AlterTable: Add updatedAt to Viewing
ALTER TABLE "viewings" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: Add updatedAt to FinancialReport
ALTER TABLE "financial_reports" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: Convert Offer.ai_analysis_status from text to enum
ALTER TABLE "offers" ALTER COLUMN "ai_analysis_status" TYPE "AiAnalysisStatus" USING "ai_analysis_status"::"AiAnalysisStatus";

-- CreateIndex: Seller token lookups
CREATE INDEX "sellers_password_reset_token_idx" ON "sellers"("password_reset_token");
CREATE INDEX "sellers_email_verification_token_idx" ON "sellers"("email_verification_token");

-- CreateIndex: Notification
CREATE INDEX "notifications_whatsapp_message_id_idx" ON "notifications"("whatsapp_message_id");
CREATE INDEX "notifications_template_name_recipient_id_idx" ON "notifications"("template_name", "recipient_id");

-- CreateIndex: CaseFlag
CREATE INDEX "case_flags_seller_id_status_idx" ON "case_flags"("seller_id", "status");

-- CreateIndex: DataCorrectionRequest
CREATE INDEX "data_correction_requests_seller_id_idx" ON "data_correction_requests"("seller_id");
CREATE INDEX "data_correction_requests_status_idx" ON "data_correction_requests"("status");

-- CreateIndex: FinancialReport
CREATE INDEX "financial_reports_seller_id_property_id_idx" ON "financial_reports"("seller_id", "property_id");

-- CreateIndex: Offer
CREATE INDEX "offers_retention_expires_at_idx" ON "offers"("retention_expires_at");

-- CreateIndex: ConsentRecord
CREATE INDEX "consent_records_seller_id_idx" ON "consent_records"("seller_id");

-- CreateIndex: EstateAgencyAgreement
CREATE INDEX "estate_agency_agreements_seller_id_status_idx" ON "estate_agency_agreements"("seller_id", "status");

-- CreateIndex: Viewing
CREATE INDEX "viewings_status_scheduled_at_idx" ON "viewings"("status", "scheduled_at");
