-- Add offer_id FK to transactions (H4: Transaction must be linked to accepted Offer)
ALTER TABLE "transactions"
  ADD COLUMN "offer_id" TEXT UNIQUE;

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_offer_id_fkey"
  FOREIGN KEY ("offer_id") REFERENCES "offers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
