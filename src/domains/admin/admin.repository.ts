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
