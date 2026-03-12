-- Phase 6: Content & Referrals schema changes
-- Testimonial: add submission token fields, make content/rating nullable,
-- add pending_submission status, update default

-- Step 1: Add the new enum value (must commit before using it)
ALTER TYPE "TestimonialStatus" ADD VALUE 'pending_submission' BEFORE 'pending_review';
