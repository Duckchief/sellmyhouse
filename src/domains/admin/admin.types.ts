// src/domains/admin/admin.types.ts

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
