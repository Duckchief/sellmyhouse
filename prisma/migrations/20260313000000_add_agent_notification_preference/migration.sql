-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "notification_preference" "NotificationPreference" NOT NULL DEFAULT 'whatsapp_and_email';

-- CreateIndex
CREATE INDEX "hdb_transactions_town_flat_type_storey_range_month_idx" ON "hdb_transactions"("town", "flat_type", "storey_range", "month");
