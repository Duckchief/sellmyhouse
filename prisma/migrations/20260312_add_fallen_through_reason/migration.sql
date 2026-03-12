-- Add fallenThroughReason to transactions table
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "fallen_through_reason" TEXT;
