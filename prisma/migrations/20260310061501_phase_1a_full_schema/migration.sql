-- CreateEnum
CREATE TYPE "AgentRole" AS ENUM ('admin', 'agent');

-- CreateEnum
CREATE TYPE "SellerStatus" AS ENUM ('lead', 'engaged', 'active', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "NotificationPreference" AS ENUM ('whatsapp_and_email', 'email_only');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('website', 'tiktok', 'instagram', 'referral', 'walkin', 'other');

-- CreateEnum
CREATE TYPE "BuyerStatus" AS ENUM ('lead', 'active', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('draft', 'listed', 'offer_received', 'under_option', 'completing', 'completed', 'withdrawn');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('draft', 'pending_review', 'approved', 'live', 'paused', 'closed');

-- CreateEnum
CREATE TYPE "PortalName" AS ENUM ('propertyguru', 'ninety_nine_co', 'srx', 'other');

-- CreateEnum
CREATE TYPE "PortalListingStatus" AS ENUM ('ready', 'posted', 'expired');

-- CreateEnum
CREATE TYPE "ViewerType" AS ENUM ('buyer', 'agent');

-- CreateEnum
CREATE TYPE "ViewingStatus" AS ENUM ('pending_otp', 'scheduled', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "SlotType" AS ENUM ('single', 'group');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('available', 'booked', 'full', 'cancelled');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('pending', 'countered', 'accepted', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('option_issued', 'option_exercised', 'completing', 'completed', 'fallen_through');

-- CreateEnum
CREATE TYPE "OtpStatus" AS ENUM ('prepared', 'sent_to_seller', 'signed_by_seller', 'returned', 'issued_to_buyer', 'exercised', 'expired');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('pending_upload', 'uploaded', 'sent_to_client', 'paid');

-- CreateEnum
CREATE TYPE "AgreementType" AS ENUM ('non_exclusive', 'exclusive');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('draft', 'sent_to_seller', 'signed', 'active', 'terminated', 'expired');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('standard', 'enhanced');

-- CreateEnum
CREATE TYPE "SubjectType" AS ENUM ('seller', 'buyer', 'counterparty');

-- CreateEnum
CREATE TYPE "ConsentSubjectType" AS ENUM ('seller', 'buyer');

-- CreateEnum
CREATE TYPE "RecipientType" AS ENUM ('seller', 'agent');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('whatsapp', 'email', 'in_app');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sent', 'delivered', 'failed', 'read');

-- CreateEnum
CREATE TYPE "VideoCategory" AS ENUM ('photography', 'forms', 'process', 'financial');

-- CreateEnum
CREATE TYPE "HdbSource" AS ENUM ('csv_seed', 'datagov_sync');

-- CreateEnum
CREATE TYPE "HdbSyncStatus" AS ENUM ('success', 'failed');

-- CreateEnum
CREATE TYPE "TestimonialStatus" AS ENUM ('pending_review', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('link_generated', 'clicked', 'lead_created', 'transaction_completed');

-- CreateEnum
CREATE TYPE "CaseFlagType" AS ENUM ('deceased_estate', 'divorce', 'mop_not_met', 'eip_restriction', 'pr_quota', 'bank_loan', 'court_order', 'other');

-- CreateEnum
CREATE TYPE "CaseFlagStatus" AS ENUM ('identified', 'in_progress', 'resolved', 'out_of_scope');

-- CreateEnum
CREATE TYPE "DeletionTargetType" AS ENUM ('lead', 'transaction', 'cdd_documents', 'consent_record');

-- CreateEnum
CREATE TYPE "DeletionRequestStatus" AS ENUM ('flagged', 'pending_review', 'approved', 'executed', 'rejected');

-- CreateEnum
CREATE TYPE "CorrectionRequestStatus" AS ENUM ('pending', 'in_progress', 'completed', 'rejected');

-- CreateEnum
CREATE TYPE "MarketContentStatus" AS ENUM ('ai_generated', 'pending_review', 'approved', 'rejected', 'published');

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "cea_reg_no" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AgentRole" NOT NULL DEFAULT 'agent',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "two_factor_secret" TEXT,
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_factor_backup_codes" JSONB,
    "failed_two_factor_attempts" INTEGER NOT NULL DEFAULT 0,
    "two_factor_locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sellers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "password_hash" TEXT,
    "agent_id" TEXT,
    "status" "SellerStatus" NOT NULL DEFAULT 'lead',
    "notification_preference" "NotificationPreference" NOT NULL DEFAULT 'whatsapp_and_email',
    "consent_service" BOOLEAN NOT NULL DEFAULT false,
    "consent_marketing" BOOLEAN NOT NULL DEFAULT false,
    "consent_timestamp" TIMESTAMP(3),
    "consent_withdrawn_at" TIMESTAMP(3),
    "lead_source" "LeadSource",
    "two_factor_secret" TEXT,
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_factor_backup_codes" JSONB,
    "failed_two_factor_attempts" INTEGER NOT NULL DEFAULT 0,
    "two_factor_locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "password_hash" TEXT,
    "agent_id" TEXT,
    "status" "BuyerStatus" NOT NULL DEFAULT 'lead',
    "consent_service" BOOLEAN NOT NULL DEFAULT false,
    "consent_marketing" BOOLEAN NOT NULL DEFAULT false,
    "consent_timestamp" TIMESTAMP(3),
    "consent_withdrawn_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "town" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "block" TEXT NOT NULL,
    "flat_type" TEXT NOT NULL,
    "storey_range" TEXT NOT NULL,
    "floor_area_sqm" DOUBLE PRECISION NOT NULL,
    "flat_model" TEXT NOT NULL,
    "lease_commence_date" INTEGER NOT NULL,
    "remaining_lease" TEXT,
    "asking_price" DECIMAL(12,2),
    "price_history" JSONB DEFAULT '[]',
    "status" "PropertyStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "description_approved_by_agent_id" TEXT,
    "description_approved_at" TIMESTAMP(3),
    "photos" JSONB DEFAULT '[]',
    "photos_approved_by_agent_id" TEXT,
    "photos_approved_at" TIMESTAMP(3),
    "status" "ListingStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_listings" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "portal_name" "PortalName" NOT NULL,
    "portal_ready_content" JSONB,
    "posted_manually_at" TIMESTAMP(3),
    "portal_listing_url" TEXT,
    "status" "PortalListingStatus" NOT NULL DEFAULT 'ready',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verified_viewers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phone_verified_at" TIMESTAMP(3),
    "viewer_type" "ViewerType" NOT NULL,
    "agent_name" TEXT,
    "agent_cea_reg" TEXT,
    "agent_agency_name" TEXT,
    "consent_service" BOOLEAN NOT NULL DEFAULT false,
    "total_bookings" INTEGER NOT NULL DEFAULT 0,
    "last_booking_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verified_viewers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "viewing_slots" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 15,
    "slot_type" "SlotType" NOT NULL DEFAULT 'single',
    "max_viewers" INTEGER NOT NULL DEFAULT 1,
    "current_bookings" INTEGER NOT NULL DEFAULT 0,
    "status" "SlotStatus" NOT NULL DEFAULT 'available',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "viewing_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "viewings" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "viewing_slot_id" TEXT NOT NULL,
    "verified_viewer_id" TEXT NOT NULL,
    "cancel_token" TEXT NOT NULL,
    "status" "ViewingStatus" NOT NULL DEFAULT 'pending_otp',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "feedback" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "viewings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "buyer_name" TEXT NOT NULL,
    "buyer_phone" TEXT NOT NULL,
    "buyer_agent_name" TEXT,
    "buyer_agent_cea_reg" TEXT,
    "is_co_broke" BOOLEAN NOT NULL DEFAULT false,
    "offer_amount" DECIMAL(12,2) NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "parent_offer_id" TEXT,
    "counter_amount" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "buyer_id" TEXT,
    "agreed_price" DECIMAL(12,2) NOT NULL,
    "option_fee" DECIMAL(12,2),
    "option_date" TIMESTAMP(3),
    "exercise_deadline" TIMESTAMP(3),
    "exercise_date" TIMESTAMP(3),
    "completion_date" TIMESTAMP(3),
    "status" "TransactionStatus" NOT NULL DEFAULT 'option_issued',
    "hdb_application_status" TEXT,
    "hdb_appointment_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otps" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "hdb_serial_number" TEXT NOT NULL,
    "status" "OtpStatus" NOT NULL DEFAULT 'prepared',
    "scanned_copy_path" TEXT,
    "scanned_copy_deleted_at" TIMESTAMP(3),
    "agent_reviewed_at" TIMESTAMP(3),
    "agent_review_notes" TEXT,
    "prepared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_at" TIMESTAMP(3),
    "exercised_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_invoices" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "invoice_file_path" TEXT,
    "invoice_deleted_at" TIMESTAMP(3),
    "invoice_number" TEXT,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 1499,
    "gst_amount" DECIMAL(12,2) NOT NULL DEFAULT 134.91,
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 1633.91,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'pending_upload',
    "uploaded_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "sent_via" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estate_agency_agreements" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "agreement_type" "AgreementType" NOT NULL DEFAULT 'non_exclusive',
    "form_type" TEXT NOT NULL DEFAULT 'CEA Form 1',
    "commission_amount" DECIMAL(12,2) NOT NULL DEFAULT 1499,
    "commission_gst_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "co_broking_allowed" BOOLEAN NOT NULL DEFAULT true,
    "co_broking_terms" TEXT NOT NULL DEFAULT 'Co-broking welcomed. Commission is not shared. Buyer''s agent is paid by their own client.',
    "signed_at" TIMESTAMP(3),
    "signed_copy_path" TEXT,
    "signed_copy_deleted_at" TIMESTAMP(3),
    "video_call_confirmed_at" TIMESTAMP(3),
    "video_call_notes" TEXT,
    "expiry_date" TIMESTAMP(3),
    "status" "AgreementStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estate_agency_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_reports" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "report_data" JSONB NOT NULL,
    "ai_narrative" TEXT,
    "ai_provider" TEXT,
    "ai_model" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_agent_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "approved_at" TIMESTAMP(3),
    "sent_to_seller_at" TIMESTAMP(3),
    "sent_via" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cdd_records" (
    "id" TEXT NOT NULL,
    "subject_type" "SubjectType" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "nric_last4" TEXT NOT NULL,
    "date_of_birth" TIMESTAMP(3),
    "nationality" TEXT,
    "occupation" TEXT,
    "risk_level" "RiskLevel" NOT NULL DEFAULT 'standard',
    "identity_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_by_agent_id" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "documents" JSONB DEFAULT '[]',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cdd_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "subject_type" "ConsentSubjectType" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "purpose_service" BOOLEAN NOT NULL DEFAULT false,
    "purpose_marketing" BOOLEAN NOT NULL DEFAULT false,
    "consent_given_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consent_withdrawn_at" TIMESTAMP(3),
    "withdrawal_channel" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipient_type" "RecipientType" NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "template_name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "whatsapp_message_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_tutorials" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "youtube_url" TEXT NOT NULL,
    "category" "VideoCategory" NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_tutorials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hdb_transactions" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "town" TEXT NOT NULL,
    "flat_type" TEXT NOT NULL,
    "block" TEXT NOT NULL,
    "street_name" TEXT NOT NULL,
    "storey_range" TEXT NOT NULL,
    "floor_area_sqm" DOUBLE PRECISION NOT NULL,
    "flat_model" TEXT NOT NULL,
    "lease_commence_date" INTEGER NOT NULL,
    "remaining_lease" TEXT,
    "resale_price" DECIMAL(12,2) NOT NULL,
    "source" "HdbSource" NOT NULL DEFAULT 'csv_seed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hdb_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hdb_data_syncs" (
    "id" TEXT NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "records_added" INTEGER NOT NULL,
    "records_total" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "status" "HdbSyncStatus" NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hdb_data_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonials" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "seller_name" TEXT NOT NULL,
    "seller_town" TEXT NOT NULL,
    "status" "TestimonialStatus" NOT NULL DEFAULT 'pending_review',
    "approved_by_agent_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "display_on_website" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "referrer_seller_id" TEXT NOT NULL,
    "referral_code" TEXT NOT NULL,
    "referred_name" TEXT,
    "referred_phone" TEXT,
    "referred_seller_id" TEXT,
    "status" "ReferralStatus" NOT NULL DEFAULT 'link_generated',
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "converted_at" TIMESTAMP(3),

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_flags" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "flag_type" "CaseFlagType" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "CaseFlagStatus" NOT NULL DEFAULT 'identified',
    "guidance_provided" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_deletion_requests" (
    "id" TEXT NOT NULL,
    "target_type" "DeletionTargetType" NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT,
    "retention_rule" TEXT,
    "flagged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_agent_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "executed_at" TIMESTAMP(3),
    "status" "DeletionRequestStatus" NOT NULL DEFAULT 'flagged',
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_correction_requests" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "field_name" TEXT NOT NULL,
    "current_value" TEXT,
    "requested_value" TEXT NOT NULL,
    "reason" TEXT,
    "status" "CorrectionRequestStatus" NOT NULL DEFAULT 'pending',
    "processed_by_agent_id" TEXT,
    "processed_at" TIMESTAMP(3),
    "process_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_correction_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_contents" (
    "id" TEXT NOT NULL,
    "town" TEXT NOT NULL,
    "flat_type" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "raw_data" JSONB NOT NULL,
    "ai_narrative" TEXT,
    "ai_provider" TEXT,
    "ai_model" TEXT,
    "status" "MarketContentStatus" NOT NULL DEFAULT 'ai_generated',
    "tiktok_format" TEXT,
    "instagram_format" TEXT,
    "linkedin_format" TEXT,
    "approved_by_agent_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_contents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_email_key" ON "agents"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_email_key" ON "sellers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_phone_key" ON "sellers"("phone");

-- CreateIndex
CREATE INDEX "sellers_agent_id_status_idx" ON "sellers"("agent_id", "status");

-- CreateIndex
CREATE INDEX "sellers_lead_source_idx" ON "sellers"("lead_source");

-- CreateIndex
CREATE UNIQUE INDEX "buyers_email_key" ON "buyers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "buyers_phone_key" ON "buyers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "verified_viewers_phone_key" ON "verified_viewers"("phone");

-- CreateIndex
CREATE INDEX "viewing_slots_property_id_date_status_idx" ON "viewing_slots"("property_id", "date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "viewings_cancel_token_key" ON "viewings"("cancel_token");

-- CreateIndex
CREATE INDEX "viewings_property_id_scheduled_at_idx" ON "viewings"("property_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "offers_property_id_status_idx" ON "offers"("property_id", "status");

-- CreateIndex
CREATE INDEX "transactions_seller_id_status_idx" ON "transactions"("seller_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "otps_transaction_id_key" ON "otps"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "commission_invoices_transaction_id_key" ON "commission_invoices"("transaction_id");

-- CreateIndex
CREATE INDEX "notifications_recipient_type_recipient_id_status_idx" ON "notifications"("recipient_type", "recipient_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "video_tutorials_slug_key" ON "video_tutorials"("slug");

-- CreateIndex
CREATE INDEX "hdb_transactions_town_flat_type_month_idx" ON "hdb_transactions"("town", "flat_type", "month");

-- CreateIndex
CREATE UNIQUE INDEX "testimonials_transaction_id_key" ON "testimonials"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referral_code_key" ON "referrals"("referral_code");

-- CreateIndex
CREATE INDEX "data_deletion_requests_status_idx" ON "data_deletion_requests"("status");

-- CreateIndex
CREATE INDEX "data_deletion_requests_target_type_target_id_idx" ON "data_deletion_requests"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "market_contents_status_idx" ON "market_contents"("status");

-- CreateIndex
CREATE INDEX "market_contents_town_flat_type_idx" ON "market_contents"("town", "flat_type");

-- AddForeignKey
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_description_approved_by_agent_id_fkey" FOREIGN KEY ("description_approved_by_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_photos_approved_by_agent_id_fkey" FOREIGN KEY ("photos_approved_by_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_listings" ADD CONSTRAINT "portal_listings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewing_slots" ADD CONSTRAINT "viewing_slots_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_viewing_slot_id_fkey" FOREIGN KEY ("viewing_slot_id") REFERENCES "viewing_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_verified_viewer_id_fkey" FOREIGN KEY ("verified_viewer_id") REFERENCES "verified_viewers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_parent_offer_id_fkey" FOREIGN KEY ("parent_offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otps" ADD CONSTRAINT "otps_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_invoices" ADD CONSTRAINT "commission_invoices_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estate_agency_agreements" ADD CONSTRAINT "estate_agency_agreements_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estate_agency_agreements" ADD CONSTRAINT "estate_agency_agreements_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_reports" ADD CONSTRAINT "financial_reports_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_reports" ADD CONSTRAINT "financial_reports_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_reports" ADD CONSTRAINT "financial_reports_reviewed_by_agent_id_fkey" FOREIGN KEY ("reviewed_by_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cdd_records" ADD CONSTRAINT "cdd_records_verified_by_agent_id_fkey" FOREIGN KEY ("verified_by_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_approved_by_agent_id_fkey" FOREIGN KEY ("approved_by_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_seller_id_fkey" FOREIGN KEY ("referrer_seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_seller_id_fkey" FOREIGN KEY ("referred_seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_flags" ADD CONSTRAINT "case_flags_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_deletion_requests" ADD CONSTRAINT "data_deletion_requests_reviewed_by_agent_id_fkey" FOREIGN KEY ("reviewed_by_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_correction_requests" ADD CONSTRAINT "data_correction_requests_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_correction_requests" ADD CONSTRAINT "data_correction_requests_processed_by_agent_id_fkey" FOREIGN KEY ("processed_by_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_contents" ADD CONSTRAINT "market_contents_approved_by_agent_id_fkey" FOREIGN KEY ("approved_by_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
