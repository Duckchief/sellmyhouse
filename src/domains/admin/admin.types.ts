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
