// src/domains/hdb/service.ts
import { Decimal } from '@prisma/client/runtime/library';
import { MemoryCache } from '@/infra/cache/memory-cache';
import { HdbRepository } from './repository';
import type { HdbTransactionFilters, HdbMarketReport } from './types';

export class HdbService {
  private cache = new MemoryCache();
  private static readonly LOOKUP_TTL = 6 * 60 * 60 * 1000; // 6 hours
  private static readonly REPORT_TTL = 60 * 60 * 1000; // 1 hour

  constructor(private readonly repo: HdbRepository = new HdbRepository()) {}

  clearCache(): void {
    this.cache.clear();
  }

  async getTransactions(filters: HdbTransactionFilters) {
    return this.repo.findTransactions(filters);
  }

  async getDistinctTowns(): Promise<string[]> {
    const key = 'hdb:towns';
    const cached = this.cache.get<string[]>(key);
    if (cached) return cached;
    const result = await this.repo.getDistinctTowns();
    this.cache.set(key, result, HdbService.LOOKUP_TTL);
    return result;
  }

  async getDistinctFlatTypes(): Promise<string[]> {
    const key = 'hdb:flatTypes';
    const cached = this.cache.get<string[]>(key);
    if (cached) return cached;
    const result = await this.repo.getDistinctFlatTypes();
    this.cache.set(key, result, HdbService.LOOKUP_TTL);
    return result;
  }

  async getDistinctFlatTypesByTown(town: string): Promise<string[]> {
    const key = `hdb:flatTypes:${town}`;
    const cached = this.cache.get<string[]>(key);
    if (cached) return cached;
    const result = await this.repo.getDistinctFlatTypesByTown(town);
    this.cache.set(key, result, HdbService.LOOKUP_TTL);
    return result;
  }

  async getDistinctStoreyRanges(): Promise<string[]> {
    const key = 'hdb:storeyRanges';
    const cached = this.cache.get<string[]>(key);
    if (cached) return cached;
    const result = await this.repo.getDistinctStoreyRanges();
    this.cache.set(key, result, HdbService.LOOKUP_TTL);
    return result;
  }

  async getDistinctStoreyRangesByTownAndFlatType(
    town: string,
    flatType: string,
  ): Promise<string[]> {
    const key = `hdb:storeyRanges:${town}:${flatType}`;
    const cached = this.cache.get<string[]>(key);
    if (cached) return cached;
    const result = await this.repo.getDistinctStoreyRangesByTownAndFlatType(town, flatType);
    this.cache.set(key, result, HdbService.LOOKUP_TTL);
    return result;
  }

  async getPropertyInfo(
    block: string,
    street: string,
  ): Promise<{ leaseCommenceDate: number; town: string } | null> {
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
    const key = `hdb:txns:${params.town}:${params.flatType}:${params.storeyRange || 'all'}:${params.months ?? 24}:${page}:${pageSize}`;
    const cached = this.cache.get<{
      transactions: Awaited<ReturnType<HdbRepository['getRecentTransactions']>>;
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }>(key);
    if (cached) return cached;

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

    const result = {
      transactions,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };

    this.cache.set(key, result, HdbService.REPORT_TTL);
    return result;
  }

  async getMarketReport(params: {
    town: string;
    flatType: string;
    storeyRange?: string;
    months?: number;
  }): Promise<HdbMarketReport | null> {
    const key = `hdb:report:${params.town}:${params.flatType}:${params.storeyRange || 'all'}:${params.months ?? 24}`;
    const cached = this.cache.get<HdbMarketReport>(key);
    if (cached) return cached;

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

    const result: HdbMarketReport = {
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

    this.cache.set(key, result, HdbService.REPORT_TTL);
    return result;
  }
}

// ─── Standalone exports for cross-domain module import pattern ───────────────

const _serviceInstance = new HdbService();

export async function getRecentByTownAndFlatType(town: string, flatType: string, months = 12) {
  return _serviceInstance.getRecentByTownAndFlatType(town, flatType, months);
}

export function clearHdbCache(): void {
  _serviceInstance.clearCache();
}
