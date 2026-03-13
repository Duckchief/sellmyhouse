-- CreateEnum
CREATE TYPE "HdbApplicationStatus" AS ENUM ('not_started', 'application_submitted', 'approval_in_principle', 'approval_granted', 'resale_checklist_submitted', 'hdb_appointment_booked', 'completed');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "hdb_app_approved_at" TIMESTAMP(3),
ADD COLUMN     "hdb_app_submitted_at" TIMESTAMP(3),
ADD COLUMN     "hdb_app_submitted_by_agent_id" TEXT,
DROP COLUMN "hdb_application_status",
ADD COLUMN     "hdb_application_status" "HdbApplicationStatus";
