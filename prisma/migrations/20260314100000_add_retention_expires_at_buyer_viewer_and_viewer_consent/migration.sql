-- AlterEnum
ALTER TYPE "ConsentSubjectType" ADD VALUE 'viewer';

-- AlterTable
ALTER TABLE "buyers" ADD COLUMN     "retention_expires_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "consent_records" ADD COLUMN     "viewer_id" TEXT;

-- AlterTable
ALTER TABLE "verified_viewers" ADD COLUMN     "retention_expires_at" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_viewer_id_fkey" FOREIGN KEY ("viewer_id") REFERENCES "verified_viewers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
