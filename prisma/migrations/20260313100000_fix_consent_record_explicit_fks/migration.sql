-- DropForeignKey
ALTER TABLE "consent_records" DROP CONSTRAINT "consent_records_subject_id_fkey";

-- AlterTable
ALTER TABLE "consent_records" ADD COLUMN     "buyer_id" TEXT,
ADD COLUMN     "seller_id" TEXT;

-- DataMigration: backfill explicit FK columns from legacy polymorphic columns
UPDATE "consent_records" SET "seller_id" = "subject_id" WHERE "subject_type" = 'seller';
UPDATE "consent_records" SET "buyer_id" = "subject_id" WHERE "subject_type" = 'buyer';

-- CreateIndex
CREATE INDEX "consent_records_subject_type_subject_id_idx" ON "consent_records"("subject_type", "subject_id");

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
