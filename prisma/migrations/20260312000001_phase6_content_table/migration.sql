-- Phase 6: Content & Referrals schema changes (part 2)
-- Must run after 20260312000000 is committed so pending_submission enum value is available

-- Step 2: Alter testimonials table to use new enum value and add token fields
ALTER TABLE "testimonials"
  ADD COLUMN "submission_token" TEXT,
  ADD COLUMN "token_expires_at" TIMESTAMP(3),
  ALTER COLUMN "content" DROP NOT NULL,
  ALTER COLUMN "rating" DROP NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'pending_submission';

-- Step 3: Add unique constraint on submission_token
CREATE UNIQUE INDEX "testimonials_submission_token_key" ON "testimonials"("submission_token");
