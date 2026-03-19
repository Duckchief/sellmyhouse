ALTER TABLE "sellers" ADD COLUMN "email_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sellers" ADD COLUMN "email_verification_token" TEXT;
ALTER TABLE "sellers" ADD COLUMN "email_verification_expiry" TIMESTAMP(3);
