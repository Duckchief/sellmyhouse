/*
  Warnings:

  - You are about to drop the column `scanned_copy_path` on the `otps` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "otps" DROP COLUMN "scanned_copy_path",
ADD COLUMN     "scanned_copy_path_returned" TEXT,
ADD COLUMN     "scanned_copy_path_seller" TEXT;
