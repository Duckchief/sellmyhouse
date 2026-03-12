// src/domains/compliance/compliance.types.ts

export type DncChannel = 'whatsapp' | 'phone' | 'email';
export type MessageType = 'service' | 'marketing';

export interface DncAllowedResult {
  allowed: boolean;
  reason?: string;
}

export type ConsentType = 'service' | 'marketing';

export interface WithdrawConsentInput {
  sellerId: string;
  type: ConsentType;
  channel: string; // 'web' | 'email' | 'whatsapp' | 'phone' | 'in_person'
  ipAddress?: string;
  userAgent?: string;
}

export interface ConsentWithdrawalResult {
  consentRecordId: string;
  deletionRequestId?: string; // set if service consent withdrawn
  deletionBlocked: boolean;   // true if AML/CFT prevents deletion
  retentionRule?: string;
}

export interface ConsentRecord {
  id: string;
  subjectType: string;
  subjectId: string;
  purposeService: boolean;
  purposeMarketing: boolean;
  consentGivenAt: Date;
  consentWithdrawnAt: Date | null;
  withdrawalChannel: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface DataDeletionRequest {
  id: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  retentionRule: string | null;
  flaggedAt: Date;
  reviewedByAgentId: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  executedAt: Date | null;
  status: string;
  details: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}
