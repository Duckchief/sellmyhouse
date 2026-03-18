-- Note: The approved_by_agent_id FK constraint retains its original name
-- "testimonials_approved_by_agent_id_fkey" in the live database. The Prisma
-- schema now uses the named relation "TestimonialApprovedBy", but Prisma does
-- not require the DB constraint name to match the relation name — this is
-- cosmetic drift only and does not affect runtime behaviour.
--
-- Note: seller_id and transaction_id ON DELETE behaviour changed from
-- RESTRICT to SET NULL (both fields are now nullable per this migration).

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('seller', 'buyer');

-- DropForeignKey
ALTER TABLE "testimonials" DROP CONSTRAINT "testimonials_seller_id_fkey";

-- DropForeignKey
ALTER TABLE "testimonials" DROP CONSTRAINT "testimonials_transaction_id_fkey";

-- AlterTable: add new columns as nullable first, then populate, then set NOT NULL
ALTER TABLE "testimonials"
ADD COLUMN     "buyer_id" TEXT,
ADD COLUMN     "client_name" TEXT,
ADD COLUMN     "client_town" TEXT,
ADD COLUMN     "client_type" "ClientType",
ADD COLUMN     "created_by_agent_id" TEXT,
ADD COLUMN     "is_manual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" TEXT,
ALTER COLUMN "seller_id" DROP NOT NULL,
ALTER COLUMN "transaction_id" DROP NOT NULL;

-- Populate client_name and client_town from existing seller_name / seller_town
UPDATE "testimonials" SET
  "client_name" = "seller_name",
  "client_town" = "seller_town";

-- Now drop the old columns and enforce NOT NULL
ALTER TABLE "testimonials"
DROP COLUMN "seller_name",
DROP COLUMN "seller_town",
ALTER COLUMN "client_name" SET NOT NULL,
ALTER COLUMN "client_town" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_created_by_agent_id_fkey" FOREIGN KEY ("created_by_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
