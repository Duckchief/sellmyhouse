-- Make buyer_name and buyer_phone nullable for PDPA offer PII anonymisation job
-- AlterTable
ALTER TABLE "offers" ALTER COLUMN "buyer_name" DROP NOT NULL,
ALTER COLUMN "buyer_phone" DROP NOT NULL;
