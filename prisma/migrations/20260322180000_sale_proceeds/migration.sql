CREATE TABLE "public"."sale_proceeds" (
  "id" TEXT NOT NULL,
  "seller_id" TEXT NOT NULL,
  "selling_price" DECIMAL(12,2) NOT NULL,
  "outstanding_loan" DECIMAL(12,2) NOT NULL,
  "cpf_seller_1" DECIMAL(12,2) NOT NULL,
  "cpf_seller_2" DECIMAL(12,2),
  "cpf_seller_3" DECIMAL(12,2),
  "cpf_seller_4" DECIMAL(12,2),
  "resale_levy" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "other_deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "commission" DECIMAL(12,2) NOT NULL,
  "net_proceeds" DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sale_proceeds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sale_proceeds_seller_id_key" ON "public"."sale_proceeds"("seller_id");

ALTER TABLE "public"."sale_proceeds"
  ADD CONSTRAINT "sale_proceeds_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
