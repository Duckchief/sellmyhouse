export interface SettingRecord {
  id: string;
  key: string;
  value: string;
  description: string;
  updatedByAgentId: string | null;
  updatedAt: Date;
  createdAt: Date;
}

// Known setting keys for type safety
export const SETTING_KEYS = {
  COMMISSION_AMOUNT: 'commission_amount',
  GST_RATE: 'gst_rate',
  OTP_EXERCISE_DAYS: 'otp_exercise_days',
  LEAD_RETENTION_MONTHS: 'lead_retention_months',
  TRANSACTION_RETENTION_YEARS: 'transaction_retention_years',
  AI_PROVIDER: 'ai_provider',
  AI_MODEL: 'ai_model',
  AI_MAX_TOKENS: 'ai_max_tokens',
  AI_TEMPERATURE: 'ai_temperature',
  VIEWING_SLOT_DURATION: 'viewing_slot_duration',
  VIEWING_MAX_GROUP_SIZE: 'viewing_max_group_size',
  HDB_SYNC_SCHEDULE: 'hdb_sync_schedule',
  REMINDER_SCHEDULE: 'reminder_schedule',
  MARKET_CONTENT_SCHEDULE: 'market_content_schedule',
  WHATSAPP_ENABLED: 'whatsapp_enabled',
  EMAIL_ENABLED: 'email_enabled',
  MAINTENANCE_MODE: 'maintenance_mode',
  DISPLAY_PRICE: 'display_price',
  POST_COMPLETION_THANKYOU_DELAY_DAYS: 'post_completion_thankyou_delay_days',
  POST_COMPLETION_TESTIMONIAL_DELAY_DAYS: 'post_completion_testimonial_delay_days',
  POST_COMPLETION_BUYER_FOLLOWUP_DELAY_DAYS: 'post_completion_buyer_followup_delay_days',
  AGENCY_NAME: 'agency_name',
  AGENCY_LICENCE: 'agency_licence',
  OFFER_AI_ANALYSIS_ENABLED: 'offer_ai_analysis_enabled',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
