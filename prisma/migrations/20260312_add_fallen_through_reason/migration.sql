-- Add fallenThroughReason to transactions table
ALTER TABLE "transactions" ADD COLUMN "fallen_through_reason" TEXT;
