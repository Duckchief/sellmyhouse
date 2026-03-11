-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "ai_analysis" TEXT,
ADD COLUMN     "ai_analysis_model" TEXT,
ADD COLUMN     "ai_analysis_provider" TEXT,
ADD COLUMN     "ai_analysis_status" TEXT;
