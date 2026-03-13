-- Partial unique index: each seller can only be referred once.
-- NULL values are excluded so referrals without a referred seller are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "referrals_unique_referred_seller"
ON "referrals" ("referred_seller_id")
WHERE "referred_seller_id" IS NOT NULL;
