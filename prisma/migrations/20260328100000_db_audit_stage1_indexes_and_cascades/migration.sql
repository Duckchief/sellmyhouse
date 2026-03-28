-- DB Audit Stage 1: Add missing indexes and cascade rules for PDPA deletion

-- DropForeignKey (to recreate with CASCADE/SET NULL)
ALTER TABLE "case_flags" DROP CONSTRAINT "case_flags_seller_id_fkey";
ALTER TABLE "commission_invoices" DROP CONSTRAINT "commission_invoices_transaction_id_fkey";
ALTER TABLE "data_correction_requests" DROP CONSTRAINT "data_correction_requests_seller_id_fkey";
ALTER TABLE "document_checklists" DROP CONSTRAINT "document_checklists_property_id_fkey";
ALTER TABLE "document_checklists" DROP CONSTRAINT "document_checklists_seller_id_fkey";
ALTER TABLE "estate_agency_agreements" DROP CONSTRAINT "estate_agency_agreements_seller_id_fkey";
ALTER TABLE "financial_reports" DROP CONSTRAINT "financial_reports_property_id_fkey";
ALTER TABLE "financial_reports" DROP CONSTRAINT "financial_reports_seller_id_fkey";
ALTER TABLE "listings" DROP CONSTRAINT "listings_property_id_fkey";
ALTER TABLE "offers" DROP CONSTRAINT "offers_property_id_fkey";
ALTER TABLE "otps" DROP CONSTRAINT "otps_transaction_id_fkey";
ALTER TABLE "portal_listings" DROP CONSTRAINT "portal_listings_listing_id_fkey";
ALTER TABLE "properties" DROP CONSTRAINT "properties_seller_id_fkey";
ALTER TABLE "recurring_schedules" DROP CONSTRAINT "recurring_schedules_property_id_fkey";
ALTER TABLE "referrals" DROP CONSTRAINT "referrals_referrer_seller_id_fkey";
ALTER TABLE "sale_proceeds" DROP CONSTRAINT "sale_proceeds_seller_id_fkey";
ALTER TABLE "seller_documents" DROP CONSTRAINT "seller_documents_seller_id_fkey";
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_property_id_fkey";
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_seller_id_fkey";
ALTER TABLE "viewing_slots" DROP CONSTRAINT "viewing_slots_property_id_fkey";
ALTER TABLE "viewings" DROP CONSTRAINT "viewings_property_id_fkey";
ALTER TABLE "viewings" DROP CONSTRAINT "viewings_viewing_slot_id_fkey";
ALTER TABLE "weekly_updates" DROP CONSTRAINT "weekly_updates_property_id_fkey";
ALTER TABLE "weekly_updates" DROP CONSTRAINT "weekly_updates_seller_id_fkey";

-- DB-S01: Replace Notification index to include channel column
DROP INDEX "notifications_recipient_type_recipient_id_status_idx";
CREATE INDEX "notifications_recipient_type_recipient_id_channel_status_idx" ON "notifications"("recipient_type", "recipient_id", "channel", "status");

-- DB-S18: Add composite index for compliance cron queries
CREATE INDEX "transactions_status_completion_date_idx" ON "transactions"("status", "completion_date");

-- DB-S10: Re-add foreign keys with CASCADE for PDPA hard-delete chain
ALTER TABLE "properties" ADD CONSTRAINT "properties_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_proceeds" ADD CONSTRAINT "sale_proceeds_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "listings" ADD CONSTRAINT "listings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_listings" ADD CONSTRAINT "portal_listings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "viewing_slots" ADD CONSTRAINT "viewing_slots_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_viewing_slot_id_fkey" FOREIGN KEY ("viewing_slot_id") REFERENCES "viewing_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "otps" ADD CONSTRAINT "otps_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_invoices" ADD CONSTRAINT "commission_invoices_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "estate_agency_agreements" ADD CONSTRAINT "estate_agency_agreements_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_reports" ADD CONSTRAINT "financial_reports_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_reports" ADD CONSTRAINT "financial_reports_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_seller_id_fkey" FOREIGN KEY ("referrer_seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_flags" ADD CONSTRAINT "case_flags_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_correction_requests" ADD CONSTRAINT "data_correction_requests_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "weekly_updates" ADD CONSTRAINT "weekly_updates_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "weekly_updates" ADD CONSTRAINT "weekly_updates_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_checklists" ADD CONSTRAINT "document_checklists_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_checklists" ADD CONSTRAINT "document_checklists_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seller_documents" ADD CONSTRAINT "seller_documents_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
