-- Partial unique index: prevents two accepted offers on the same property (M3: race condition)
CREATE UNIQUE INDEX IF NOT EXISTS offers_one_accepted_per_property
ON offers (property_id)
WHERE status = 'accepted';
