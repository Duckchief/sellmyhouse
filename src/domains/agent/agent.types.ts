import type { SellerStatus, LeadSource } from '@prisma/client';

export interface PipelineSeller {
  id: string;
  name: string;
  phone: string;
  askingPrice: number;
  status: string;
}

export interface PipelineStage {
  status: SellerStatus;
  count: number;
  totalValue: number; // sum of asking prices (converted from Decimal at repo boundary)
  sellers: PipelineSeller[];
}

export interface ActivityItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: Date;
}

export interface PipelineOverview {
  stages: PipelineStage[];
  recentActivity: ActivityItem[];
  pendingReviewCount: number;
  unassignedLeadCount: number;
}

export interface SellerListFilter {
  agentId?: string;
  status?: SellerStatus;
  town?: string;
  dateFrom?: string;
  dateTo?: string;
  leadSource?: LeadSource;
  search?: string;
  page?: number;
  limit?: number;
}

export interface SellerListItem {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  status: SellerStatus;
  leadSource: LeadSource | null;
  createdAt: Date;
  property: {
    id: string;
    town: string;
    flatType: string;
    askingPrice: number | null;
    status: string;
    transactionStatus: string | null;
  } | null;
}

export interface SellerListResult {
  sellers: SellerListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface LeadQueueItem {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  emailVerified: boolean;
  leadSource: LeadSource | null;
  createdAt: Date;
  timeSinceCreation: number; // milliseconds
  welcomeNotificationSent: boolean;
  agentId: string | null;
}

export interface LeadQueueResult {
  unassigned: LeadQueueItem[];
  verified: LeadQueueItem[];
  unverified: LeadQueueItem[];
}

export interface SellerDetail {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  status: SellerStatus;
  leadSource: LeadSource | null;
  agentId: string | null;
  onboardingStep: number;
  consentService: boolean;
  consentMarketing: boolean;
  createdAt: Date;
  updatedAt: Date;
  property: {
    id: string;
    town: string;
    street: string;
    block: string;
    flatType: string;
    storeyRange: string;
    floorAreaSqm: number;
    flatModel: string;
    leaseCommenceDate: number;
    askingPrice: number | null;
    priceHistory: unknown;
    status: string;
    listing: {
      id: string;
      status: string;
      title: string | null;
      description: string | null;
    } | null;
  } | null;
}

export interface ComplianceStatus {
  cdd: {
    status: 'verified' | 'pending' | 'not_started';
    verifiedAt: Date | null;
    riskLevel: string | null;
    fullName: string | null;
    nricLast4: string | null;
  };
  eaa: {
    id: string | null;
    status: 'signed' | 'active' | 'sent_to_seller' | 'draft' | 'not_started';
    signedAt: Date | null;
    expiryDate: Date | null;
    explanationConfirmedAt: Date | null;
    explanationMethod: string | null;
  };
  consent: { service: boolean; marketing: boolean; withdrawnAt: Date | null };
  caseFlags: { id: string; flagType: string; status: string; description: string }[];
  counterpartyCdd: {
    status: 'verified' | 'not_started';
    verifiedAt: Date | null;
    transactionId: string | null;
    isCoBroke: boolean;
    buyerAgentName: string | null;
    buyerAgentCeaReg: string | null;
  } | null;
}

export interface NotificationHistoryItem {
  id: string;
  channel: string;
  templateName: string;
  content: string;
  status: string;
  sentAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

export interface NotificationHistoryResult {
  items: NotificationHistoryItem[];
  total: number;
  page: number;
  totalPages: number;
}
