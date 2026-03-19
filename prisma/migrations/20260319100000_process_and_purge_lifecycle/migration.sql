-- Step 1: Add anonymised_at to transactions
ALTER TABLE "transactions" ADD COLUMN "anonymised_at" TIMESTAMPTZ;

-- Step 2: Add new values to DeletionTargetType enum
ALTER TYPE "DeletionTargetType" ADD VALUE IF NOT EXISTS 'nric_data';
ALTER TYPE "DeletionTargetType" ADD VALUE IF NOT EXISTS 'listing';
ALTER TYPE "DeletionTargetType" ADD VALUE IF NOT EXISTS 'financial_data';
ALTER TYPE "DeletionTargetType" ADD VALUE IF NOT EXISTS 'sensitive_documents';

-- Step 3: Recreate DeletionRequestStatus enum without 'blocked'
-- First migrate any existing 'blocked' rows to 'flagged'
UPDATE "data_deletion_requests" SET "status" = 'flagged' WHERE "status" = 'blocked';

-- Create new enum type
CREATE TYPE "DeletionRequestStatus_new" AS ENUM ('flagged', 'pending_review', 'approved', 'executed', 'rejected');

-- Alter column to use new type (via text cast)
ALTER TABLE "data_deletion_requests"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "DeletionRequestStatus_new" USING ("status"::text::"DeletionRequestStatus_new"),
  ALTER COLUMN "status" SET DEFAULT 'flagged';

-- Drop old type and rename new one
DROP TYPE "DeletionRequestStatus";
ALTER TYPE "DeletionRequestStatus_new" RENAME TO "DeletionRequestStatus";
