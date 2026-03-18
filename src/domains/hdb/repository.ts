// src/domains/hdb/repository.ts
import { Prisma } from '@prisma/client';
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

  async getMarketReportStats(filters: HdbTransactionFilters): Promise<{
    count: number;
    min: number;
    max: number;
    median: number;
    avgPricePerSqm: number;
  } | null> {
    const conditions: Prisma.Sql[] = [];

    if (filters.town) {
      conditions.push(Prisma.sql`town = ${filters.town}`);
    }
    if (filters.flatType) {
      conditions.push(Prisma.sql`flat_type = ${filters.flatType}`);
    }
    if (filters.storeyRange) {
      conditions.push(Prisma.sql`storey_range = ${filters.storeyRange}`);
    }
    if (filters.fromMonth) {
      conditions.push(Prisma.sql`month >= ${filters.fromMonth}`);
    }
    if (filters.toMonth) {
      conditions.push(Prisma.sql`month <= ${filters.toMonth}`);
    }

    const where = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;

    type StatsRow = { count: bigint; min: string; max: string; median: string; avg_psm: string };
    const rows = await prisma.$queryRaw<StatsRow[]>(
      Prisma.sql`SELECT
         COUNT(*)                                                          AS count,
         MIN(resale_price)                                                 AS min,
         MAX(resale_price)                                                 AS max,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY resale_price)        AS median,
         AVG(resale_price::float / NULLIF(floor_area_sqm, 0))             AS avg_psm
       FROM hdb_transactions ${where}`,
    );

    const row = rows[0];
    if (!row || Number(row.count) === 0) return null;

    return {
      count: Number(row.count),
      min: Math.round(Number(row.min)),
      max: Math.round(Number(row.max)),
      median: Math.round(Number(row.median)),
      avgPricePerSqm: Math.round(Number(row.avg_psm)),
    };
  }

  async getRecentTransactions(filters: HdbTransactionFilters, limit = 5, offset = 0) {
    const where: Record<string, unknown> = {};

    if (filters.town) where.town = filters.town;
    if (filters.flatType) where.flatType = filters.flatType;
    if (filters.storeyRange) where.storeyRange = filters.storeyRange;
    if (filters.fromMonth || filters.toMonth) {
      const monthFilter: Record<string, string> = {};
      if (filters.fromMonth) monthFilter.gte = filters.fromMonth;
      if (filters.toMonth) monthFilter.lte = filters.toMonth;
      where.month = monthFilter;
    }

    return prisma.hdbTransaction.findMany({
      where,
      orderBy: { month: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async countFilteredTransactions(filters: HdbTransactionFilters): Promise<number> {
    const where: Record<string, unknown> = {};

    if (filters.town) where.town = filters.town;
    if (filters.flatType) where.flatType = filters.flatType;
    if (filters.storeyRange) where.storeyRange = filters.storeyRange;
    if (filters.fromMonth || filters.toMonth) {
      const monthFilter: Record<string, string> = {};
      if (filters.fromMonth) monthFilter.gte = filters.fromMonth;
      if (filters.toMonth) monthFilter.lte = filters.toMonth;
      where.month = monthFilter;
    }

    return prisma.hdbTransaction.count({ where });
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

  async getDistinctFlatTypesByTown(town: string): Promise<string[]> {
    const results = await prisma.hdbTransaction.findMany({
      distinct: ['flatType'],
      select: { flatType: true },
      orderBy: { flatType: 'asc' },
      where: { town },
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

  async getDistinctStoreyRangesByTownAndFlatType(
    town: string,
    flatType: string,
  ): Promise<string[]> {
    const results = await prisma.hdbTransaction.findMany({
      distinct: ['storeyRange'],
      select: { storeyRange: true },
      orderBy: { storeyRange: 'asc' },
      where: { town, flatType },
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

  async findRecentByTownAndFlatType(town: string, flatType: string, months = 12) {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - months);
    const cutoffMonth = cutoffDate.toISOString().slice(0, 7); // 'YYYY-MM'

    return prisma.hdbTransaction.findMany({
      where: {
        town: town.toUpperCase(),
        flatType: flatType.toUpperCase(),
        month: { gte: cutoffMonth },
      },
      orderBy: { month: 'desc' },
      take: 50,
    });
  }
}
