// src/domains/admin/admin.repository.ts
import { Prisma } from '@prisma/client';
import { prisma, createId } from '@/infra/database/prisma';
import type { TeamMember, AgentCreateInput, HdbDataStatus, HdbSyncRecord } from './admin.types';
import type { SettingRecord } from '@/domains/shared/settings.types';

// ─── Agent Queries ───────────────────────────────────────────

const PIPELINE_STAGES = ['lead', 'engaged', 'active', 'completed', 'archived'] as const;
const ACTIVE_STAGES = new Set(['lead', 'engaged', 'active']);

export async function findAllAgents(): Promise<TeamMember[]> {
  const [agents, stageCounts] = await Promise.all([
    prisma.agent.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        ceaRegNo: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    }),
    prisma.seller.groupBy({
      by: ['agentId', 'status'],
      where: { agentId: { not: null } },
      _count: { id: true },
    }),
  ]);

  // agentId -> status -> count
  const countMap = new Map<string, Record<string, number>>();
  for (const row of stageCounts) {
    if (!row.agentId) continue;
    if (!countMap.has(row.agentId)) countMap.set(row.agentId, {});
    countMap.get(row.agentId)![row.status] = row._count.id;
  }

  return agents.map((a) => {
    const counts = countMap.get(a.id) ?? {};
    const perStage = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, counts[s] ?? 0]));
    const activeSellersCount = PIPELINE_STAGES.filter((s) => ACTIVE_STAGES.has(s)).reduce(
      (sum, s) => sum + (counts[s] ?? 0),
      0,
    );
    return {
      id: a.id,
      name: a.name,
      email: a.email,
      phone: a.phone,
      ceaRegNo: a.ceaRegNo,
      role: a.role as 'agent' | 'admin',
      isActive: a.isActive,
      activeSellersCount,
      completedCount: counts['completed'] ?? 0,
      stageCounts: perStage,
      createdAt: a.createdAt,
    };
  });
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
      phone: `anonymised-${id}`,
      passwordHash: '',
      twoFactorSecret: null,
      twoFactorBackupCodes: Prisma.JsonNull,
      passwordResetToken: null,
      passwordResetExpiry: null,
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

// ─── Lead Queries ────────────────────────────────────────────

export async function findUnassignedLeads(page = 1, limit = 25) {
  return prisma.seller.findMany({
    where: { status: 'lead', agentId: null },
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      leadSource: true,
      createdAt: true,
      properties: { take: 1, select: { town: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
}

export async function countUnassignedLeads(): Promise<number> {
  return prisma.seller.count({ where: { status: 'lead', agentId: null } });
}

export async function findAllLeads(limit = 50) {
  return prisma.seller.findMany({
    where: { status: 'lead' },
    select: {
      id: true,
      name: true,
      phone: true,
      leadSource: true,
      createdAt: true,
      properties: { take: 1, select: { town: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
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
  if (filter.agentId === 'unassigned') {
    where.agentId = null;
  } else if (filter.agentId) {
    where.agentId = filter.agentId;
  }
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
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        agentId: true,
        notificationPreference: true,
        consentService: true,
        consentMarketing: true,
        consentTimestamp: true,
        consentWithdrawnAt: true,
        leadSource: true,
        onboardingStep: true,
        twoFactorEnabled: true,
        consultationCompletedAt: true,
        retentionExpiresAt: true,
        createdAt: true,
        updatedAt: true,
        agent: { select: { id: true, name: true } },
        properties: { take: 1, select: { town: true, askingPrice: true } },
      },
    }),
    prisma.seller.count({ where }),
  ]);

  const mappedSellers = sellers.map((s) => ({
    ...s,
    town: s.properties[0]?.town ?? null,
    askingPrice: s.properties[0]?.askingPrice != null ? Number(s.properties[0].askingPrice) : null,
  }));

  return { sellers: mappedSellers, total, page: filter.page ?? 1, limit };
}

export async function getAdminSellerStatusCounts(): Promise<Record<string, number>> {
  const rows = await prisma.seller.groupBy({
    by: ['status'],
    _count: { id: true },
  });
  const counts: Record<string, number> = {
    lead: 0,
    engaged: 0,
    active: 0,
    completed: 0,
    archived: 0,
  };
  for (const row of rows) {
    counts[row.status] = row._count.id;
  }
  return counts;
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

// ─── Review Queue Queries ────────────────────────────────────

export async function getReviewQueue() {
  const [pendingListings, pendingReports] = await Promise.all([
    prisma.listing.findMany({
      where: { status: 'pending_review' },
      select: {
        id: true,
        updatedAt: true,
        property: {
          select: {
            block: true,
            street: true,
            seller: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    }),
    prisma.financialReport.findMany({
      where: { approvedAt: null, aiNarrative: { not: null } },
      select: {
        id: true,
        generatedAt: true,
        seller: { select: { id: true, name: true } },
        property: { select: { block: true, street: true } },
      },
      orderBy: { generatedAt: 'asc' },
      take: 50,
    }),
  ]);

  return { pendingListings, pendingReports };
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
  const dateFilter = dateFrom && dateTo ? { completionDate: { gte: dateFrom, lte: dateTo } } : {};
  const completed = await prisma.transaction.findMany({
    where: { status: 'completed', completionDate: { not: null }, ...dateFilter },
    select: {
      createdAt: true,
      completionDate: true,
      property: { select: { flatType: true } },
    },
    take: 5000,
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
  const dateFilter = dateFrom && dateTo ? { scheduledAt: { gte: dateFrom, lte: dateTo } } : {};
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
      take: 500,
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

export async function findSellerDetailForAdmin(id: string) {
  return prisma.seller.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      notificationPreference: true,
      createdAt: true,
      agent: {
        select: { id: true, name: true, ceaRegNo: true, phone: true },
      },
      properties: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          block: true,
          street: true,
          town: true,
          flatType: true,
          floorAreaSqm: true,
          level: true,
          unitNumber: true,
          askingPrice: true,
          status: true,
        },
      },
      transactions: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          offerId: true,
          agreedPrice: true,
          hdbApplicationStatus: true,
          otp: { select: { status: true } },
          createdAt: true,
        },
      },
      consentRecords: {
        select: { id: true, consentWithdrawnAt: true, createdAt: true },
      },
    },
  });
}

// ─── Settings ────────────────────────────────────────────────

export async function upsertSetting(
  key: string,
  value: string,
  agentId: string,
): Promise<SettingRecord> {
  return prisma.systemSetting.upsert({
    where: { key },
    update: { value, updatedByAgentId: agentId },
    create: { id: createId(), key, value, description: '', updatedByAgentId: agentId },
  });
}
