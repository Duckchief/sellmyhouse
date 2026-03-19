import { PrismaClient } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';

const SETTINGS = [
  { key: 'commission_amount', value: '1499', description: 'Fixed commission amount in SGD' },
  { key: 'gst_rate', value: '0.09', description: 'GST rate applied to commission' },
  { key: 'ai_provider', value: 'anthropic', description: 'Active AI provider (anthropic, openai, google)' },
  { key: 'ai_model', value: 'claude-sonnet-4-20250514', description: 'Active AI model identifier' },
  { key: 'ai_fallback_provider', value: '', description: 'Fallback AI provider if primary fails. Empty = no fallback. Values: anthropic, openai, google' },
  { key: 'ai_retry_count', value: '1', description: 'Number of retries on AI provider failure before fallback' },
  { key: 'ai_retry_delay_ms', value: '2000', description: 'Delay in ms between AI retries' },
  { key: 'platform_name', value: 'SellMyHomeNow.sg', description: 'Platform display name' },
  { key: 'agency_name', value: 'Huttons Asia Pte Ltd', description: 'Agency name for CEA compliance' },
  { key: 'agency_licence', value: 'L3008899K', description: 'CEA agency licence number' },
  { key: 'support_email', value: 'support@sellmyhomenow.sg', description: 'Platform support email' },
  { key: 'support_phone', value: '+6591234567', description: 'Platform support phone (placeholder)' },
  { key: 'offer_ai_analysis_enabled', value: 'true', description: 'Enable AI narrative generation on offer creation' },
  { key: 'otp_exercise_days', value: '21', description: 'Calendar days from OTP issuance to exercise deadline' },
  { key: 'market_content_schedule', value: '0 8 * * 1', description: 'Cron schedule for weekly market content job (Monday 8am SGT)' },
  { key: 'post_completion_testimonial_delay_days', value: '7', description: 'Days after transaction completion to send testimonial request' },
  { key: 'post_completion_referral_delay_days', value: '14', description: 'Days after transaction completion to send referral link' },
  { key: 'lead_retention_months', value: '12', description: 'Months of inactivity before a lead (no transaction) is flagged for deletion' },
  { key: 'sensitive_doc_retention_days', value: '7', description: 'Days post-completion before NRIC, CDD docs, OTP scans, and invoices are auto-deleted (Tier 1)' },
  { key: 'financial_data_retention_days', value: '7', description: 'Days post-completion before financial data (offer amounts, agreed price) is auto-redacted (Tier 2)' },
  { key: 'transaction_anonymisation_days', value: '30', description: 'Days post-completion before seller PII and transaction metadata are anonymised (Tier 3)' },
  { key: 'consent_post_withdrawal_retention_years', value: '1', description: 'Years after consent withdrawal before the consent record is flagged for deletion' },
  { key: 'listing_retention_months', value: '6', description: 'Months after a listing is closed before it is flagged for deletion' },
  { key: 'seller_inactive_alert_days', value: '14', description: 'Days of inactivity before agent alert is sent' },
  { key: 'maintenance_mode', value: 'false', description: 'Set to true to show the maintenance page to sellers and public visitors' },
  { key: 'maintenance_message', value: '', description: 'Optional custom message displayed on the maintenance page' },
  { key: 'maintenance_eta', value: '', description: 'Optional estimated return time shown on the maintenance page (ISO 8601 datetime)' },
];

export async function seedSystemSettings(prisma: PrismaClient): Promise<void> {
  console.log('Seeding system settings...');

  for (const setting of SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value, description: setting.description },
      create: { id: createId(), ...setting },
    });
  }

  console.log(`System settings seeded: ${SETTINGS.length} entries`);
}
