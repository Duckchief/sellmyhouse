-- Add seller_cdd_record_id and counterparty_cdd_record_id FKs to transactions (H5: CDD audit trail)
ALTER TABLE "transactions"
  ADD COLUMN "seller_cdd_record_id" TEXT,
  ADD COLUMN "counterparty_cdd_record_id" TEXT;

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_seller_cdd_record_id_fkey"
  FOREIGN KEY ("seller_cdd_record_id") REFERENCES "cdd_records"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_counterparty_cdd_record_id_fkey"
  FOREIGN KEY ("counterparty_cdd_record_id") REFERENCES "cdd_records"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
