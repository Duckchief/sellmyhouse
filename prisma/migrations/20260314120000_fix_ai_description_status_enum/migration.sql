-- CreateEnum
CREATE TYPE "AiDescriptionStatus" AS ENUM ('pending', 'ai_generated', 'pending_review', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "listings" DROP COLUMN "ai_description_status",
ADD COLUMN     "ai_description_status" "AiDescriptionStatus";
