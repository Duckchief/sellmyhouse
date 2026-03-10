// src/domains/hdb/repository.ts
import { prisma } from '@/infra/database/prisma';
import type { HdbTransactionFilters } from './types';

interface CreateTransactionData {
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
  resalePrice: number;
  source: 'csv_seed' | 'datagov_sync';
}

interface CreateSyncLogData {
  id: string;
  recordsAdded: number;
  recordsTotal: number;
  source: string;
  status: 'success' | 'failed';
  error?: string;
}

export class HdbRepository {
  async createManyTransactions(data: CreateTransactionData[]): Promise<number> {
    const result = await prisma.hdbTransaction.createMany({
      data,
      skipDuplicates: true,
    });
    return result.count;
  }

  async findTransactions(filters: HdbTransactionFilters) {
    const where: Record<string, unknown> = {};

    if (filters.town) where.town = filters.town;
    if (filters.flatType) where.flatType = filters.flatType;
    if (filters.block) where.block = filters.block;
    if (filters.streetName) where.streetName = filters.streetName;
    if (filters.storeyRange) where.storeyRange = filters.storeyRange;

    if (filters.fromMonth || filters.toMonth) {
      const monthFilter: Record<string, string> = {};
      if (filters.fromMonth) monthFilter.gte = filters.fromMonth;
      if (filters.toMonth) monthFilter.lte = filters.toMonth;
      where.month = monthFilter;
    }

    return prisma.hdbTransaction.findMany({
      where,
      orderBy: { resalePrice: 'asc' },
    });
  }

  async getDistinctTowns(): Promise<string[]> {
    const results = await prisma.hdbTransaction.findMany({
      distinct: ['town'],
      select: { town: true },
      orderBy: { town: 'asc' },
    });
    return results.map((r) => r.town);
  }

  async getDistinctFlatTypes(): Promise<string[]> {
    const results = await prisma.hdbTransaction.findMany({
      distinct: ['flatType'],
      select: { flatType: true },
      orderBy: { flatType: 'asc' },
    });
    return results.map((r) => r.flatType);
  }

  async getDistinctStoreyRanges(): Promise<string[]> {
    const results = await prisma.hdbTransaction.findMany({
      distinct: ['storeyRange'],
      select: { storeyRange: true },
      orderBy: { storeyRange: 'asc' },
    });
    return results.map((r) => r.storeyRange);
  }

  async countTransactions(): Promise<number> {
    return prisma.hdbTransaction.count();
  }

  async getLatestMonth(): Promise<string | null> {
    const result = await prisma.hdbTransaction.findFirst({
      orderBy: { month: 'desc' },
      select: { month: true },
    });
    return result?.month ?? null;
  }

  async createSyncLog(data: CreateSyncLogData) {
    return prisma.hdbDataSync.create({ data });
  }
}
