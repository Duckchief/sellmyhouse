// src/domains/hdb/service.ts
import { Decimal } from '@prisma/client/runtime/library';
import { HdbRepository } from './repository';
import type { HdbTransactionFilters, HdbMarketReport } from './types';

export class HdbService {
  constructor(private readonly repo: HdbRepository = new HdbRepository()) {}

  async getTransactions(filters: HdbTransactionFilters) {
    return this.repo.findTransactions(filters);
  }

  async getDistinctTowns(): Promise<string[]> {
    return this.repo.getDistinctTowns();
  }

  async getDistinctFlatTypes(): Promise<string[]> {
    return this.repo.getDistinctFlatTypes();
  }

  async getDistinctFlatTypesByTown(town: string): Promise<string[]> {
    return this.repo.getDistinctFlatTypesByTown(town);
  }

  async getDistinctStoreyRanges(): Promise<string[]> {
    return this.repo.getDistinctStoreyRanges();
  }

  async getDistinctStoreyRangesByTownAndFlatType(
    town: string,
    flatType: string,
  ): Promise<string[]> {
    return this.repo.getDistinctStoreyRangesByTownAndFlatType(town, flatType);
  }

  async getPropertyInfo(block: string, street: string): Promise<{ leaseCommenceDate: number; town: string } | null> {
    return this.repo.findPropertyInfo(block, street);
  }

  async getRecentByTownAndFlatType(town: string, flatType: string, months = 12) {
    return this.repo.findRecentByTownAndFlatType(town, flatType, months);
  }

  async getPaginatedTransactions(
    params: { town: string; flatType: string; storeyRange?: string; months?: number },
    page: number,
    pageSize: number,
  ): Promise<{
    transactions: Awaited<ReturnType<HdbRepository['getRecentTransactions']>>;
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const months = params.months ?? 24;
    const filters: HdbTransactionFilters = {
      town: params.town.toUpperCase(),
      flatType: params.flatType,
      storeyRange: params.storeyRange,
    };

    if (months > 0) {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      filters.fromMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;
    }

    const offset = (page - 1) * pageSize;
    const [transactions, total] = await Promise.all([
      this.repo.getRecentTransactions(filters, pageSize, offset),
      this.repo.countFilteredTransactions(filters),
    ]);

    return {
      transactions,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getMarketReport(params: {
    town: string;
    flatType: string;
    storeyRange?: string;
    months?: number;
  }): Promise<HdbMarketReport | null> {
    const months = params.months ?? 24;

    const filters: HdbTransactionFilters = {
      town: params.town.toUpperCase(),
      flatType: params.flatType,
      storeyRange: params.storeyRange,
    };

    if (months > 0) {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      filters.fromMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;
    }

    const [stats, recent] = await Promise.all([
      this.repo.getMarketReportStats(filters),
      this.repo.getRecentTransactions(filters, 5),
    ]);

    if (!stats) return null;

    return {
      town: params.town.toUpperCase(),
      flatType: params.flatType,
      storeyRange: params.storeyRange ?? 'All',
      months,
      count: stats.count,
      min: new Decimal(stats.min),
      max: new Decimal(stats.max),
      median: new Decimal(stats.median),
      avgPricePerSqm: stats.avgPricePerSqm,
      recentTransactions: recent,
    };
  }
}

// ─── Standalone exports for cross-domain module import pattern ───────────────

const _serviceInstance = new HdbService();

export async function getRecentByTownAndFlatType(town: string, flatType: string, months = 12) {
  return _serviceInstance.getRecentByTownAndFlatType(town, flatType, months);
}
