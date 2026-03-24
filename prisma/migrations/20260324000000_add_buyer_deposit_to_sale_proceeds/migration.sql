ALTER TABLE "public"."sale_proceeds"
  ADD COLUMN "buyer_deposit" DECIMAL(12,2) NOT NULL DEFAULT 0;
