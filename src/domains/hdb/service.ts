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

  async getDistinctStoreyRanges(): Promise<string[]> {
    return this.repo.getDistinctStoreyRanges();
  }

  async getRecentByTownAndFlatType(town: string, flatType: string, months = 12) {
    return this.repo.findRecentByTownAndFlatType(town, flatType, months);
  }

  async getMarketReport(params: {
    town: string;
    flatType: string;
    storeyRange?: string;
    months?: number;
  }): Promise<HdbMarketReport | null> {
    const months = params.months ?? 24;

    // Build filters with month cutoff
    const filters: HdbTransactionFilters = {
      town: params.town.toUpperCase(),
      flatType: params.flatType,
      storeyRange: params.storeyRange,
    };

    if (months > 0) {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      const cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;
      filters.fromMonth = cutoffMonth;
    }

    const transactions = await this.repo.findTransactions(filters);

    if (transactions.length === 0) {
      return null;
    }

    const count = transactions.length;
    const min = transactions[0].resalePrice;
    const max = transactions[count - 1].resalePrice;

    // Median calculation
    let median: Decimal;
    if (count % 2 === 0) {
      const a = transactions[count / 2 - 1].resalePrice;
      const b = transactions[count / 2].resalePrice;
      median = a.add(b).div(2);
    } else {
      median = transactions[Math.floor(count / 2)].resalePrice;
    }

    // Average price per sqm
    let totalPricePerSqm = 0;
    for (const t of transactions) {
      totalPricePerSqm += t.resalePrice.toNumber() / t.floorAreaSqm;
    }
    const avgPricePerSqm = Math.round(totalPricePerSqm / count);

    return {
      town: params.town.toUpperCase(),
      flatType: params.flatType,
      storeyRange: params.storeyRange ?? 'All',
      months,
      count,
      min,
      max,
      median,
      avgPricePerSqm,
      recentTransactions: transactions.slice(-5).reverse(),
    };
  }
}

// ─── Standalone exports for cross-domain module import pattern ───────────────

const _serviceInstance = new HdbService();

export async function getRecentByTownAndFlatType(
  town: string,
  flatType: string,
  months = 12,
) {
  return _serviceInstance.getRecentByTownAndFlatType(town, flatType, months);
}
