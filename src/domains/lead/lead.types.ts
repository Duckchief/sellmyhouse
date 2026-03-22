export type LeadSource = 'website' | 'tiktok' | 'instagram' | 'referral' | 'walkin' | 'other';

export interface LeadInput {
  name: string;
  email: string;
  countryCode: string;
  nationalNumber: string;
  phone: string; // E.164 format, constructed by router
  consentService: boolean;
  consentMarketing: boolean;
  leadSource: LeadSource;
  honeypot?: string;
  formLoadedAt?: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface LeadResult {
  sellerId: string;
}
