-- CreateEnum
CREATE TYPE "FinancialReportStatus" AS ENUM ('draft', 'ai_generated', 'pending_review', 'approved', 'rejected', 'sent');

-- AlterTable
ALTER TABLE "financial_reports" ADD COLUMN     "status" "FinancialReportStatus" NOT NULL DEFAULT 'draft';

-- CreateTable
CREATE TABLE "weekly_updates" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "week_of" TIMESTAMP(3) NOT NULL,
    "content" TEXT,
    "ai_narrative" TEXT,
    "ai_provider" TEXT,
    "ai_model" TEXT,
    "status" "FinancialReportStatus" NOT NULL DEFAULT 'draft',
    "reviewed_by_agent_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "approved_at" TIMESTAMP(3),
    "sent_to_seller_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_checklists" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "status" "FinancialReportStatus" NOT NULL DEFAULT 'draft',
    "reviewed_by_agent_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_checklists_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "weekly_updates" ADD CONSTRAINT "weekly_updates_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_updates" ADD CONSTRAINT "weekly_updates_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_updates" ADD CONSTRAINT "weekly_updates_reviewed_by_agent_id_fkey" FOREIGN KEY ("reviewed_by_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_checklists" ADD CONSTRAINT "document_checklists_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_checklists" ADD CONSTRAINT "document_checklists_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_checklists" ADD CONSTRAINT "document_checklists_reviewed_by_agent_id_fkey" FOREIGN KEY ("reviewed_by_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
