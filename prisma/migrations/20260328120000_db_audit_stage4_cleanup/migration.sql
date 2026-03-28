-- DB Audit Stage 4: Missing updatedAt fields, SellerDocument ID cleanup

-- AlterTable: Add updatedAt to ViewingSlot
ALTER TABLE "viewing_slots" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: Add updatedAt to Testimonial
ALTER TABLE "testimonials" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: Add updatedAt to Referral
ALTER TABLE "referrals" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: Remove default cuid() from SellerDocument (app generates cuid2 now)
ALTER TABLE "seller_documents" ALTER COLUMN "id" DROP DEFAULT;
