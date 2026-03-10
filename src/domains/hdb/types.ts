// src/domains/hdb/types.ts
import { Decimal } from '@prisma/client/runtime/library';

export interface HdbTransactionRecord {
  id: string;
  month: string;
  town: string;
  flatType: string;
  block: string;
  streetName: string;
  storeyRange: string;
  floorAreaSqm: number;
  flatModel: string;
  leaseCommenceDate: number;
  remainingLease: string | null;
  resalePrice: Decimal;
  source: 'csv_seed' | 'datagov_sync';
  createdAt: Date;
}

export interface HdbDataSyncRecord {
  id: string;
  syncedAt: Date;
  recordsAdded: number;
  recordsTotal: number;
  source: string;
  status: 'success' | 'failed';
  error: string | null;
  createdAt: Date;
}

export interface HdbTransactionFilters {
  town?: string;
  flatType?: string;
  fromMonth?: string;
  toMonth?: string;
  block?: string;
  streetName?: string;
  storeyRange?: string;
}

export interface HdbMarketReport {
  town: string;
  flatType: string;
  storeyRange: string;
  months: number;
  count: number;
  min: Decimal;
  max: Decimal;
  median: Decimal;
  avgPricePerSqm: number;
  recentTransactions: HdbTransactionRecord[];
}

export interface CsvRow {
  month: string;
  town: string;
  flat_type: string;
  block: string;
  street_name: string;
  storey_range: string;
  floor_area_sqm: string;
  flat_model: string;
  lease_commence_date: string;
  remaining_lease?: string;
  resale_price: string;
}
