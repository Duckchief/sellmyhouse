// src/domains/seller/case-flag.repository.ts
import { prisma } from '@/infra/database/prisma';
import type { CaseFlagType, CaseFlagStatus } from '@prisma/client';

export async function create(data: {
  id: string;
  sellerId: string;
  flagType: CaseFlagType;
  description: string;
}) {
  return prisma.caseFlag.create({ data });
}

export async function updateStatus(id: string, status: CaseFlagStatus, guidanceProvided?: string) {
  const isTerminal = status === 'resolved' || status === 'out_of_scope';
  return prisma.caseFlag.update({
    where: { id },
    data: {
      status,
      guidanceProvided: guidanceProvided ?? undefined,
      resolvedAt: isTerminal ? new Date() : undefined,
    },
  });
}

export async function findById(id: string) {
  return prisma.caseFlag.findUnique({ where: { id } });
}

export async function findBySellerId(sellerId: string) {
  return prisma.caseFlag.findMany({
    where: { sellerId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findActiveMopFlag(sellerId: string) {
  return prisma.caseFlag.findFirst({
    where: {
      sellerId,
      flagType: 'mop_not_met',
      status: { in: ['identified', 'in_progress'] },
    },
    orderBy: { createdAt: 'desc' },
  });
}
