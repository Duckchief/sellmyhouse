import { FinancialReportStatus } from '@prisma/client';

export type EntityType =
  | 'financial_report'
  | 'listing_description'
  | 'listing_photos'
  | 'weekly_update'
  | 'market_content'
  | 'document_checklist';

export interface ReviewItem {
  id: string;
  entityType: EntityType;
  entityId: string;
  sellerId: string;
  sellerName: string;
  propertyAddress: string;
  currentStatus: FinancialReportStatus;
  submittedAt: Date;
  priority: number; // ms since submittedAt — higher = older = more urgent
}

export const ENTITY_TYPES: EntityType[] = [
  'financial_report',
  'listing_description',
  'listing_photos',
  'weekly_update',
  'market_content',
  'document_checklist',
];

export const REVIEW_TRANSITIONS: Record<FinancialReportStatus, FinancialReportStatus[]> = {
  draft: ['ai_generated'],
  ai_generated: ['pending_review'],
  pending_review: ['approved', 'rejected'],
  approved: ['sent'],
  rejected: ['ai_generated', 'pending_review'],
  sent: [],
};

export type ComplianceGate =
  | 'cdd_complete'
  | 'eaa_signed'
  | 'counterparty_cdd'
  | 'agent_otp_review';
