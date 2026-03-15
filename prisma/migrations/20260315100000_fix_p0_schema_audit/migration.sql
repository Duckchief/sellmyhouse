-- AlterTable: set existing NULL hdb_application_status to default before making NOT NULL
UPDATE "transactions" SET "hdb_application_status" = 'not_started' WHERE "hdb_application_status" IS NULL;

-- AlterTable
ALTER TABLE "otps" ADD COLUMN     "agent_reviewed_by_agent_id" TEXT;

-- AlterTable
ALTER TABLE "transactions" ALTER COLUMN "hdb_application_status" SET NOT NULL,
ALTER COLUMN "hdb_application_status" SET DEFAULT 'not_started';

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_hdb_app_submitted_by_agent_id_fkey" FOREIGN KEY ("hdb_app_submitted_by_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otps" ADD CONSTRAINT "otps_agent_reviewed_by_agent_id_fkey" FOREIGN KEY ("agent_reviewed_by_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
