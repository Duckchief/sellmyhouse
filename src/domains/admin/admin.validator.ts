// src/domains/admin/admin.validator.ts
import { body, param } from 'express-validator';
import type { SettingKey } from '@/domains/shared/settings.types';

// Exhaustive validator map — TypeScript enforces every SettingKey has an entry.
// Adding a new SettingKey without adding a validator here is a compile error.
export const SETTING_VALIDATORS: Record<SettingKey, (v: string) => boolean> = {
  commission_amount: (v) => !isNaN(Number(v)) && Number(v) > 0,
  gst_rate: (v) => !isNaN(Number(v)) && Number(v) >= 0 && Number(v) < 1,
  display_price: (v) => !isNaN(Number(v)) && Number(v) > 0,
  otp_exercise_days: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  reminder_schedule: (v) => {
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) && a.every((n: unknown) => typeof n === 'number');
    } catch {
      return false;
    }
  },
  post_completion_thankyou_delay_days: (v) => Number.isInteger(Number(v)) && Number(v) >= 0,
  post_completion_testimonial_delay_days: (v) => Number.isInteger(Number(v)) && Number(v) >= 0,
  post_completion_buyer_followup_delay_days: (v) => Number.isInteger(Number(v)) && Number(v) >= 0,
  post_completion_referral_delay_days: (v) => Number.isInteger(Number(v)) && Number(v) >= 0,
  whatsapp_enabled: (v) => v === 'true' || v === 'false',
  email_enabled: (v) => v === 'true' || v === 'false',
  maintenance_mode: (v) => v === 'true' || v === 'false',
  hdb_sync_schedule: (v) => /^[\d*,\-/\s]+$/.test(v),
  lead_retention_months: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  sensitive_doc_retention_days: (v) =>
    Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 30,
  financial_data_retention_days: (v) =>
    Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 30,
  transaction_anonymisation_days: (v) =>
    Number.isInteger(Number(v)) && Number(v) >= 7 && Number(v) <= 90,
  ai_provider: (v) => ['anthropic', 'openai', 'google'].includes(v),
  ai_model: (v) => v.length > 0,
  ai_max_tokens: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  ai_temperature: (v) => !isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 2,
  viewing_slot_duration: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  viewing_max_group_size: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  market_content_schedule: (v) => /^([0-5]?\d) ([01]?\d|2[0-3]) \* \* ([0-6](,[0-6])*)$/.test(v),
  agency_name: (v) => v.length > 0,
  agency_licence: (v) => v.length > 0,
  offer_ai_analysis_enabled: (v) => v === 'true' || v === 'false',
  platform_name: (v) => v.length > 0,
  support_email: (v) => v.length > 0,
  support_phone: (v) => v.length > 0,
  listing_description_prompt: (v) => v.trim().length > 0,
  // Optional free-text settings — any value including empty string is valid
  maintenance_message: () => true,
  maintenance_eta: () => true,
  // default_agent_id — UUID or empty string to clear
  default_agent_id: () => true,
};

export const validateAgentCreate = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').trim().isEmail().normalizeEmail().withMessage('Valid email required'),
  body('phone').trim().notEmpty().withMessage('Phone is required'),
  body('ceaRegNo').trim().notEmpty().withMessage('CEA registration number is required'),
];

export const validateSettingUpdate = [
  param('key').trim().notEmpty().withMessage('Setting key is required'),
  body('value').exists().withMessage('Value is required'),
];

export const validateAssign = [
  body('agentId').trim().notEmpty().withMessage('Agent ID is required'),
];

export const validateBulkAssign = [
  body('sellerIds').trim().notEmpty().withMessage('Seller IDs are required'),
  body('agentId').trim().notEmpty().withMessage('Agent ID is required'),
];
