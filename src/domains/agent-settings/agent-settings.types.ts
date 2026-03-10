export type AgentSettingKey =
  | 'whatsapp_phone_number_id'
  | 'whatsapp_api_token'
  | 'whatsapp_business_account_id'
  | 'smtp_host'
  | 'smtp_port'
  | 'smtp_user'
  | 'smtp_pass'
  | 'smtp_from_email'
  | 'smtp_from_name';

export const WHATSAPP_KEYS: AgentSettingKey[] = [
  'whatsapp_phone_number_id',
  'whatsapp_api_token',
  'whatsapp_business_account_id',
];

export const SMTP_KEYS: AgentSettingKey[] = [
  'smtp_host',
  'smtp_port',
  'smtp_user',
  'smtp_pass',
  'smtp_from_email',
  'smtp_from_name',
];

export interface AgentSettingsView {
  key: AgentSettingKey;
  maskedValue: string | null;
  updatedAt: Date | null;
}
