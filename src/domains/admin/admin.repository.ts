// src/domains/admin/admin.repository.ts
import { prisma, createId } from '@/infra/database/prisma';
import type { TeamMember, AgentCreateInput, HdbDataStatus, HdbSyncRecord } from './admin.types';

// ─── Agent Queries ───────────────────────────────────────────

export async function findAllAgents(): Promise<TeamMember[]> {
  const agents = await prisma.agent.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: {
          sellers: {
            where: { status: { notIn: ['completed', 'archived'] } },
          },
        },
      },
    },
  });

  const completedCounts = await prisma.seller.groupBy({
    by: ['agentId'],
    where: { status: 'completed' },
    _count: { id: true },
  });
  const completedMap = new Map(
    completedCounts
      .filter((r) => r.agentId !== null)
      .map((r) => [r.agentId as string, r._count.id]),
  );

  return agents.map((a) => ({
    id: a.id,
    name: a.name,
    email: a.email,
    phone: a.phone,
    ceaRegNo: a.ceaRegNo,
    role: a.role as 'agent' | 'admin',
    isActive: a.isActive,
    activeSellersCount: a._count.sellers,
    completedCount: completedMap.get(a.id) ?? 0,
    createdAt: a.createdAt,
  }));
}

export async function findAgentById(
  id: string,
): Promise<{ id: string; name: string; email: string; isActive: boolean } | null> {
  return prisma.agent.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, isActive: true },
  });
}

export async function findAgentByEmail(email: string): Promise<{ id: string } | null> {
  return prisma.agent.findUnique({ where: { email }, select: { id: true } });
}

export async function createAgent(
  input: AgentCreateInput & { passwordHash: string },
): Promise<{ id: string; name: string; email: string }> {
  return prisma.agent.create({
    data: {
      id: createId(),
      name: input.name,
      email: input.email,
      phone: input.phone,
      ceaRegNo: input.ceaRegNo,
      passwordHash: input.passwordHash,
      role: 'agent',
      isActive: true,
    },
    select: { id: true, name: true, email: true },
  });
}

export async function updateAgentStatus(id: string, isActive: boolean): Promise<void> {
  await prisma.agent.update({ where: { id }, data: { isActive } });
}

export async function anonymiseAgent(id: string): Promise<void> {
  await prisma.agent.update({
    where: { id },
    data: {
      name: `Former Agent [${id}]`,
      email: `anonymised-${id}@deleted.local`,
      phone: 'anonymised',
      isActive: false,
    },
  });
}

export async function countActiveSellers(agentId: string): Promise<number> {
  return prisma.seller.count({
    where: {
      agentId,
      status: { notIn: ['completed', 'archived'] },
    },
  });
}

// ─── Seller Queries ──────────────────────────────────────────

export async function findAllSellers(filter: {
  agentId?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const limit = filter.limit ?? 25;
  const skip = ((filter.page ?? 1) - 1) * limit;

  const where: Record<string, unknown> = {};
  if (filter.agentId) where.agentId = filter.agentId;
  if (filter.status) where.status = filter.status;
  if (filter.search) {
    where.OR = [
      { name: { contains: filter.search, mode: 'insensitive' } },
      { email: { contains: filter.search, mode: 'insensitive' } },
      { phone: { contains: filter.search } },
    ];
  }

  const [sellers, total] = await Promise.all([
    prisma.seller.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        agent: { select: { id: true, name: true } },
      },
    }),
    prisma.seller.count({ where }),
  ]);

  return { sellers, total, page: filter.page ?? 1, limit };
}

export async function findSellerById(
  id: string,
): Promise<{ id: string; agentId: string | null; name: string } | null> {
  return prisma.seller.findUnique({
    where: { id },
    select: { id: true, agentId: true, name: true },
  });
}

export async function assignSeller(sellerId: string, agentId: string): Promise<void> {
  await prisma.seller.update({ where: { id: sellerId }, data: { agentId } });
}

// ─── HDB Queries ─────────────────────────────────────────────

// ─── Analytics Queries ───────────────────────────────────────

export async function getRevenueMetrics(dateFrom?: Date, dateTo?: Date) {
  const dateFilter = dateFrom && dateTo ? { createdAt: { gte: dateFrom, lte: dateTo } } : {};
  const [completed, active, pendingInvoices] = await Promise.all([
    prisma.transaction.aggregate({
      where: { status: 'completed', ...dateFilter },
      _sum: { agreedPrice: true },
      _count: true,
    }),
    prisma.transaction.aggregate({
      where: { status: { notIn: ['completed', 'fallen_through'] }, ...dateFilter },
      _sum: { agreedPrice: true },
      _count: true,
    }),
    prisma.commissionInvoice.count({ where: { status: 'pending_upload', ...dateFilter } }),
  ]);
  return {
    totalRevenue: 0, // computed in service
    completedCount: completed._count,
    pipelineValue: Number(active._sum.agreedPrice ?? 0),
    activeTransactions: active._count,
    pendingInvoices,
  };
}

export async function getTransactionFunnel(dateFrom?: Date, dateTo?: Date) {
  const dateFilter = dateFrom && dateTo ? { createdAt: { gte: dateFrom, lte: dateTo } } : {};
  const stages = await prisma.seller.groupBy({ by: ['status'], where: dateFilter, _count: true });
  const funnel: Record<string, number> = {};
  for (const stage of stages) {
    funnel[stage.status] = stage._count;
  }
  return funnel;
}

export async function getTimeToClose(dateFrom?: Date, dateTo?: Date) {
  const dateFilter =
    dateFrom && dateTo ? { completionDate: { gte: dateFrom, lte: dateTo } } : {};
  const completed = await prisma.transaction.findMany({
    where: { status: 'completed', completionDate: { not: null }, ...dateFilter },
    select: {
      createdAt: true,
      completionDate: true,
      property: { select: { flatType: true } },
    },
  });
  if (completed.length === 0) return { averageDays: 0, count: 0, byFlatType: {} };
  let totalDays = 0;
  const byFlatType: Record<string, { totalDays: number; count: number }> = {};
  for (const tx of completed) {
    const days = Math.round(
      (tx.completionDate!.getTime() - tx.createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    totalDays += days;
    const ft = tx.property?.flatType ?? 'Unknown';
    if (!byFlatType[ft]) byFlatType[ft] = { totalDays: 0, count: 0 };
    byFlatType[ft].totalDays += days;
    byFlatType[ft].count++;
  }
  const byFlatTypeResult: Record<string, { averageDays: number; count: number }> = {};
  for (const [ft, data] of Object.entries(byFlatType)) {
    byFlatTypeResult[ft] = {
      averageDays: Math.round(data.totalDays / data.count),
      count: data.count,
    };
  }
  return {
    averageDays: Math.round(totalDays / completed.length),
    count: completed.length,
    byFlatType: byFlatTypeResult,
  };
}

export async function getLeadSourceMetrics(dateFrom?: Date, dateTo?: Date) {
  const dateFilter = dateFrom && dateTo ? { createdAt: { gte: dateFrom, lte: dateTo } } : {};
  const sources = await prisma.seller.groupBy({
    by: ['leadSource'],
    where: { leadSource: { not: null }, ...dateFilter },
    _count: true,
  });
  const converted = await prisma.seller.groupBy({
    by: ['leadSource'],
    where: { leadSource: { not: null }, status: 'completed', ...dateFilter },
    _count: true,
  });
  const convertedMap = new Map(converted.map((c) => [c.leadSource, c._count]));
  const result: Record<string, { total: number; conversionRate: number }> = {};
  for (const source of sources) {
    const key = source.leadSource ?? 'unknown';
    const total = source._count;
    const conv = convertedMap.get(source.leadSource) ?? 0;
    result[key] = { total, conversionRate: total > 0 ? Math.round((conv / total) * 100) : 0 };
  }
  return result;
}

export async function getViewingMetrics(dateFrom?: Date, dateTo?: Date) {
  const dateFilter =
    dateFrom && dateTo ? { scheduledAt: { gte: dateFrom, lte: dateTo } } : {};
  const [total, completed, noShows, cancelled] = await Promise.all([
    prisma.viewing.count({ where: dateFilter }),
    prisma.viewing.count({ where: { status: 'completed', ...dateFilter } }),
    prisma.viewing.count({ where: { status: 'no_show', ...dateFilter } }),
    prisma.viewing.count({ where: { status: 'cancelled', ...dateFilter } }),
  ]);
  return {
    totalViewings: total,
    completed,
    noShowRate: total > 0 ? Math.round((noShows / total) * 100) : 0,
    cancellationRate: total > 0 ? Math.round((cancelled / total) * 100) : 0,
  };
}

export async function getReferralMetrics(dateFrom?: Date, dateTo?: Date) {
  const dateFilter = dateFrom && dateTo ? { createdAt: { gte: dateFrom, lte: dateTo } } : {};
  const [referrals, leadsCreated, txCompleted] = await Promise.all([
    prisma.referral.findMany({
      where: dateFilter,
      select: {
        clickCount: true,
        status: true,
        referrer: { select: { name: true } },
      },
      orderBy: { clickCount: 'desc' },
    }),
    prisma.seller.count({ where: { leadSource: 'referral', ...dateFilter } }),
    prisma.seller.count({ where: { leadSource: 'referral', status: 'completed', ...dateFilter } }),
  ]);
  const totalLinks = referrals.length;
  const totalClicks = referrals.reduce((sum, r) => sum + r.clickCount, 0);
  const conversionRate =
    totalLinks > 0 ? Math.round((leadsCreated / totalLinks) * 100 * 100) / 100 : 0;
  const topReferrers = referrals.slice(0, 10).map((r) => ({
    name: r.referrer?.name ?? 'Unknown',
    clicks: r.clickCount,
    status: (r.status ?? 'link_generated') as string,
  }));
  return {
    totalLinks,
    totalClicks,
    leadsCreated,
    transactionsCompleted: txCompleted,
    conversionRate,
    topReferrers,
  };
}

export async function getHdbStatus(): Promise<HdbDataStatus> {
  const [totalRecords, aggregate, recentSyncs] = await Promise.all([
    prisma.hdbTransaction.count(),
    prisma.hdbTransaction.aggregate({
      _min: { month: true },
      _max: { month: true },
    }),
    prisma.hdbDataSync.findMany({
      orderBy: { syncedAt: 'desc' },
      take: 20,
    }),
  ]);

  const earliest = aggregate._min.month;
  const latest = aggregate._max.month;

  const syncs: HdbSyncRecord[] = recentSyncs.map((s) => ({
    id: s.id,
    syncedAt: s.syncedAt,
    recordsAdded: s.recordsAdded,
    recordsTotal: s.recordsTotal,
    source: s.source,
    status: s.status,
    error: s.error,
    createdAt: s.createdAt,
  }));

  return {
    totalRecords,
    dateRange: earliest && latest ? { earliest, latest } : null,
    lastSync: syncs[0] ?? null,
    recentSyncs: syncs,
  };
}
