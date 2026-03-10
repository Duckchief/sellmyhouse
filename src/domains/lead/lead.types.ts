export type LeadSource = 'website' | 'tiktok' | 'instagram' | 'referral' | 'walkin' | 'other';

export interface LeadInput {
  name: string;
  phone: string;
  consentService: boolean;
  consentMarketing: boolean;
  leadSource: LeadSource;
  honeypot?: string; // hidden field — must be empty
  formLoadedAt?: number; // timestamp when form was loaded (ms)
  ipAddress?: string;
  userAgent?: string;
}

export interface LeadResult {
  sellerId: string;
}
