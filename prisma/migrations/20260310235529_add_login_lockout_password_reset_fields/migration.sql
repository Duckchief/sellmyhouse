-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "login_locked_until" TIMESTAMP(3),
ADD COLUMN     "password_reset_expiry" TIMESTAMP(3),
ADD COLUMN     "password_reset_token" TEXT;

-- AlterTable
ALTER TABLE "sellers" ADD COLUMN     "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "login_locked_until" TIMESTAMP(3),
ADD COLUMN     "password_reset_expiry" TIMESTAMP(3),
ADD COLUMN     "password_reset_token" TEXT;
