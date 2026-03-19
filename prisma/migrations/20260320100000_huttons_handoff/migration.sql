-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "huttons_submitted_at" TIMESTAMP(3),
ADD COLUMN "huttons_submitted_by_agent_id" TEXT;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_huttons_submitted_by_agent_id_fkey" FOREIGN KEY ("huttons_submitted_by_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
