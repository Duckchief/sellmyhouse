-- Add wrapped encryption key fields for OTP scans (M6) and commission invoices (L6)
-- Existing files without a wrappedKey will be served via legacy plaintext path.

ALTER TABLE "otps"
  ADD COLUMN "scanned_copy_wrapped_key_seller"   TEXT,
  ADD COLUMN "scanned_copy_wrapped_key_returned" TEXT;

ALTER TABLE "commission_invoices"
  ADD COLUMN "invoice_wrapped_key" TEXT;
