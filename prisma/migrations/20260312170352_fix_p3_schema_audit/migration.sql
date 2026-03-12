-- AlterTable
ALTER TABLE "cdd_records" ADD COLUMN     "retention_expires_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "retention_expires_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sellers" ADD COLUMN     "retention_expires_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "verified_viewers" ADD COLUMN     "consent_ip_address" TEXT,
ADD COLUMN     "consent_timestamp" TIMESTAMP(3),
ADD COLUMN     "consent_user_agent" TEXT;
