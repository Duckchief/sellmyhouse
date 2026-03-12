import { PrismaClient } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';

const SETTINGS = [
  { key: 'commission_amount', value: '1499', description: 'Fixed commission amount in SGD' },
  { key: 'gst_rate', value: '0.09', description: 'GST rate applied to commission' },
  { key: 'ai_provider', value: 'anthropic', description: 'Active AI provider (anthropic, openai, google)' },
  { key: 'ai_model', value: 'claude-sonnet-4-20250514', description: 'Active AI model identifier' },
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
