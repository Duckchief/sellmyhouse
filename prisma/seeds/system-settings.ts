import { PrismaClient } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';

const SETTINGS = [
  { key: 'commission_amount', value: '1499', description: 'Fixed commission amount in SGD' },
  { key: 'commission_gst_rate', value: '0.09', description: 'GST rate applied to commission' },
  { key: 'ai_provider', value: 'anthropic', description: 'Active AI provider (anthropic, openai, google)' },
  { key: 'ai_model', value: 'claude-sonnet-4-20250514', description: 'Active AI model identifier' },
  { key: 'platform_name', value: 'SellMyHomeNow.sg', description: 'Platform display name' },
  { key: 'agency_name', value: 'Huttons Asia Pte Ltd', description: 'Agency name for CEA compliance' },
  { key: 'agency_licence', value: 'L3008899K', description: 'CEA agency licence number' },
  { key: 'support_email', value: 'support@sellmyhomenow.sg', description: 'Platform support email' },
  { key: 'support_phone', value: '+6591234567', description: 'Platform support phone (placeholder)' },
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
