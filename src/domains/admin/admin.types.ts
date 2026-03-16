// src/domains/admin/admin.types.ts

import type { TimelineMilestone } from '@/domains/seller/seller.types';
import type { NotificationHistoryItem } from '@/domains/agent/agent.types';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  ceaRegNo: string;
  role: 'agent' | 'admin';
  isActive: boolean;
  activeSellersCount: number;
  completedCount: number;
  createdAt: Date;
}

export interface AgentCreateInput {
  name: string;
  email: string;
  phone: string;
  ceaRegNo: string;
}

export interface HdbDataStatus {
  totalRecords: number;
  dateRange: { earliest: string; latest: string } | null;
  lastSync: HdbSyncRecord | null;
  recentSyncs: HdbSyncRecord[];
}

export interface HdbSyncRecord {
  id: string;
  syncedAt: Date;
  recordsAdded: number;
  recordsTotal: number;
  source: string;
  status: string;
  error: string | null;
  createdAt: Date;
}

export interface SettingGroup {
  label: string;
  settings: SettingWithMeta[];
}

export interface SettingWithMeta {
  key: string;
  value: string;
  description: string;
  updatedAt: Date;
}

export interface AnalyticsData {
  revenue: {
    totalRevenue: number;
    completedCount: number;
    pipelineValue: number;
    activeTransactions: number;
    commissionPerTransaction: number;
    pendingInvoices: number;
  };
  funnel: Record<string, number>;
  timeToClose: {
    averageDays: number;
    count: number;
    byFlatType: Record<string, { averageDays: number; count: number }>;
  };
  leadSources: Record<string, { total: number; conversionRate: number }>;
  viewings: {
    totalViewings: number;
    completed: number;
    noShowRate: number;
    cancellationRate: number;
  };
  referrals: {
    totalLinks: number;
    totalClicks: number;
    leadsCreated: number;
    transactionsCompleted: number;
    conversionRate: number;
    topReferrers: Array<{ name: string; clicks: number; status: string }>;
  };
}

export interface AnalyticsFilter {
  dateFrom?: string;
  dateTo?: string;
}

export interface NotificationFilter {
  channel?: 'whatsapp' | 'email' | 'in_app';
  status?: 'pending' | 'sent' | 'delivered' | 'failed' | 'read';
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}

export interface AuditLogFilter {
  action?: string;
  entityType?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}

export interface ReviewItem {
  type: 'listing' | 'report';
  sellerId: string | undefined;
  sellerName: string | undefined;
  property: string;
  submittedAt: Date;
  reviewUrl: string;
}

export interface LeadListResult {
  leads: Array<{
    id: string;
    name: string;
    phone: string | null;
    town: string | null;
    leadSource: string | null;
    createdAt: Date;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminLeadQueueResult {
  unassigned: LeadListResult;
  all: Array<{
    id: string;
    name: string;
    phone: string | null;
    town: string | null;
    leadSource: string | null;
    createdAt: Date;
  }>;
}

export interface AdminPipelineSeller {
  id: string;
  name: string;
  phone: string | null;
  town: string | null;
  agentName: string | null;
  askingPrice: number | null;
  status: string;
}

export interface AdminPipelineStage {
  status: string;
  count: number;
  sellers: AdminPipelineSeller[];
}

export interface AdminPipelineResult {
  stages: AdminPipelineStage[];
  totalSellers: number;
}

export interface AdminSellerDetail {
  seller: {
    id: string;
    name: string;
    email: string | null;
    phone: string;
    status: string;
    notificationPreference: string;
    createdAt: Date;
  };
  property: {
    block: string;
    street: string;
    town: string;
    flatType: string;
    floorAreaSqm: number;
    storeyRange: string;
    askingPrice: number | null;
  } | null;
  agent: {
    id: string;
    name: string;
    ceaRegNo: string;
    phone: string | null;
  } | null;
  transaction: {
    id: string;
    status: string;
    offerId: string | null;
    agreedPrice: number;
    hdbApplicationStatus: string;
    otpStatus: string | null;
    createdAt: Date;
  } | null;
  compliance: {
    cdd: {
      riskLevel: string;
      identityVerified: boolean;
      verifiedAt: Date | null;
      createdAt: Date;
    } | null;
    consentCount: number;
    hasWithdrawal: boolean;
  };
  auditLog: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    details: unknown;
    createdAt: Date;
  }>;
  milestones: TimelineMilestone[];
  notifications: NotificationHistoryItem[];
}
