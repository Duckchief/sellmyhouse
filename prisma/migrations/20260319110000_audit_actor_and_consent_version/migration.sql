-- Finding #5: Add actorType and actorId to audit_logs
ALTER TABLE "audit_logs" ADD COLUMN "actor_type" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "actor_id" TEXT;

-- Finding #6: Add consent_version to consent_records (default "1.0" for existing records)
ALTER TABLE "consent_records" ADD COLUMN "consent_version" TEXT NOT NULL DEFAULT '1.0';
