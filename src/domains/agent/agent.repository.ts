import { prisma } from '@/infra/database/prisma';
import type { Prisma, SellerStatus, LeadSource } from '@prisma/client';
import type { PipelineStage, PipelineSeller, SellerListFilter } from './agent.types';
import { maskNric } from '@/domains/shared/nric';

export async function getPipelineStages(agentId?: string) {
  const where = agentId ? { agentId } : {};
  const results = await prisma.seller.groupBy({
    by: ['status'],
    where,
    _count: { id: true },
  });

  // Get total values per status (sum of asking prices from properties)
  const stages = await Promise.all(
    results.map(async (r) => {
      const agg = await prisma.property.aggregate({
        where: { seller: { status: r.status, ...(agentId ? { agentId } : {}) } },
        _sum: { askingPrice: true },
      });
      return {
        status: r.status,
        count: r._count.id,
        totalValue: agg._sum.askingPrice ? Number(agg._sum.askingPrice) : 0,
      };
    }),
  );

  return stages;
}

export async function getPipelineStagesWithSellers(agentId?: string): Promise<PipelineStage[]> {
  const where = agentId ? { agentId } : {};
  const sellers = await prisma.seller.findMany({
    where: { ...where, status: { not: 'archived' } },
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      properties: { select: { askingPrice: true }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
  });

  const stageOrder: SellerStatus[] = ['lead', 'engaged', 'active', 'completed', 'archived'];
  const stageMap = new Map<string, PipelineStage>();
  for (const status of stageOrder) {
    stageMap.set(status, { status, count: 0, totalValue: 0, sellers: [] });
  }
  for (const s of sellers) {
    const stage = stageMap.get(s.status);
    if (!stage) continue;
    const askingPrice = s.properties[0]?.askingPrice ? Number(s.properties[0].askingPrice) : 0;
    stage.count++;
    stage.totalValue += askingPrice;
    const pipelineSeller: PipelineSeller = {
      id: s.id,
      name: s.name,
      phone: s.phone ?? '',
      askingPrice,
      status: s.status,
    };
    stage.sellers.push(pipelineSeller);
  }
  return stageOrder.map((s) => stageMap.get(s)!);
}

export async function getUnassignedLeadCount(): Promise<number> {
  return prisma.seller.count({ where: { status: 'lead', agentId: null } });
}

export async function getRecentActivity(agentId?: string, limit = 10) {
  // Get seller IDs and their related entity IDs for this agent
  const sellers = await prisma.seller.findMany({
    where: agentId ? { agentId } : {},
    select: {
      id: true,
      properties: { select: { id: true, listings: { select: { id: true } } } },
    },
  });

  if (sellers.length === 0) return [];

  // Build a set of all entity IDs related to these sellers
  const entityIds: string[] = [];
  for (const s of sellers) {
    entityIds.push(s.id);
    for (const p of s.properties) {
      entityIds.push(p.id);
      for (const l of p.listings) {
        entityIds.push(l.id);
      }
    }
  }

  return prisma.auditLog.findMany({
    where: {
      entityId: { in: entityIds },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getPendingReviewCount(agentId?: string) {
  const sellerWhere = agentId ? { agentId } : {};

  // FinancialReport has no explicit status field. A report is "pending review" when:
  // - It has an aiNarrative (AI has generated it)
  // - It has NOT been approved (approvedAt is null)
  // - It has NOT been sent to the seller (sentToSellerAt is null)
  // This covers both fresh AI-generated reports and re-generated reports after rejection.
  const [financialReports, listings] = await Promise.all([
    prisma.financialReport.count({
      where: {
        seller: sellerWhere,
        aiNarrative: { not: null },
        approvedAt: null,
      },
    }),
    prisma.listing.count({
      where: {
        property: { seller: sellerWhere },
        status: 'pending_review',
      },
    }),
  ]);

  return financialReports + listings;
}

export async function getLeadQueue(agentId?: string) {
  return prisma.seller.findMany({
    where: {
      status: 'lead',
      ...(agentId ? { agentId } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getWelcomeNotificationStatus(sellerIds: string[]) {
  if (sellerIds.length === 0) return new Map<string, boolean>();

  // Check if any notification has been sent to each seller (any template)
  const notifications = await prisma.notification.findMany({
    where: {
      recipientType: 'seller',
      recipientId: { in: sellerIds },
      status: { in: ['sent', 'delivered', 'read'] },
    },
    select: { recipientId: true },
    distinct: ['recipientId'],
  });

  const sentSet = new Set(notifications.map((n) => n.recipientId));
  const sentMap = new Map<string, boolean>();
  for (const id of sellerIds) {
    sentMap.set(id, sentSet.has(id));
  }
  return sentMap;
}

export async function getSellerList(filter: SellerListFilter) {
  const page = filter.page ?? 1;
  const limit = filter.limit ?? 25;
  const skip = (page - 1) * limit;

  const where: Prisma.SellerWhereInput = {};
  if (filter.agentId) where.agentId = filter.agentId;
  if (filter.status) where.status = filter.status as SellerStatus;
  if (filter.leadSource) where.leadSource = filter.leadSource as LeadSource;
  if (filter.dateFrom || filter.dateTo) {
    where.createdAt = {
      ...(filter.dateFrom ? { gte: new Date(filter.dateFrom) } : {}),
      ...(filter.dateTo ? { lte: new Date(filter.dateTo) } : {}),
    };
  }
  if (filter.search) {
    where.OR = [
      { name: { contains: filter.search, mode: 'insensitive' } },
      { email: { contains: filter.search, mode: 'insensitive' } },
      { phone: { contains: filter.search } },
    ];
  }
  if (filter.town) {
    where.properties = { some: { town: { equals: filter.town, mode: 'insensitive' } } };
  }

  const [sellers, total] = await Promise.all([
    prisma.seller.findMany({
      where,
      include: {
        properties: {
          take: 1,
          select: {
            id: true,
            town: true,
            flatType: true,
            askingPrice: true,
            status: true,
            transactions: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              select: { status: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.seller.count({ where }),
  ]);

  return {
    sellers: sellers.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      phone: s.phone,
      status: s.status,
      leadSource: s.leadSource,
      createdAt: s.createdAt,
      property: s.properties[0]
        ? {
            id: s.properties[0].id,
            town: s.properties[0].town,
            flatType: s.properties[0].flatType,
            askingPrice: s.properties[0].askingPrice ? Number(s.properties[0].askingPrice) : null,
            status: s.properties[0].status,
            transactionStatus: s.properties[0].transactions[0]?.status ?? null,
          }
        : null,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getSellerDetail(sellerId: string, agentId?: string) {
  const where: Prisma.SellerWhereInput = { id: sellerId };
  if (agentId) where.agentId = agentId;

  return prisma.seller.findFirst({
    where,
    include: {
      properties: {
        take: 1,
        include: {
          listings: { take: 1, orderBy: { createdAt: 'desc' } },
        },
      },
    },
  });
}

export async function getComplianceStatus(sellerId: string, agentId?: string) {
  // RBAC: verify seller belongs to agent before returning compliance data
  const sellerWhere: Prisma.SellerWhereInput = { id: sellerId };
  if (agentId) sellerWhere.agentId = agentId;

  const [cddRecords, eaaRecords, seller, caseFlags, activeTransaction] = await Promise.all([
    prisma.cddRecord.findMany({
      where: { subjectType: 'seller', subjectId: sellerId },
      orderBy: { createdAt: 'desc' },
      take: 1,
    }),
    prisma.estateAgencyAgreement.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      take: 1,
    }),
    prisma.seller.findFirst({
      where: sellerWhere,
      select: {
        consentService: true,
        consentMarketing: true,
        consentWithdrawnAt: true,
      },
    }),
    prisma.caseFlag.findMany({
      where: { sellerId, status: { not: 'resolved' } },
    }),
    prisma.transaction.findFirst({
      where: { sellerId, status: { notIn: ['completed', 'fallen_through'] } },
      select: {
        id: true,
        offer: { select: { isCoBroke: true, buyerAgentName: true, buyerAgentCeaReg: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const cdd = cddRecords[0];
  const eaa = eaaRecords[0];

  // Parse explanation method from videoCallNotes (format: "method" or "method: notes")
  let explanationMethod: string | null = null;
  if (eaa?.videoCallNotes) {
    const colonIndex = eaa.videoCallNotes.indexOf(':');
    explanationMethod =
      colonIndex > -1 ? eaa.videoCallNotes.substring(0, colonIndex) : eaa.videoCallNotes;
  }

  // Check counterparty CDD if there's an active transaction
  let counterpartyCdd: {
    status: 'verified' | 'not_started';
    verifiedAt: Date | null;
    transactionId: string | null;
    isCoBroke: boolean;
    buyerAgentName: string | null;
    buyerAgentCeaReg: string | null;
  } | null = null;

  if (activeTransaction) {
    const counterpartyCddRecord = await prisma.cddRecord.findFirst({
      where: { subjectType: 'counterparty', subjectId: activeTransaction.id },
      orderBy: { createdAt: 'desc' },
    });
    counterpartyCdd = {
      status: counterpartyCddRecord?.identityVerified
        ? ('verified' as const)
        : ('not_started' as const),
      verifiedAt: counterpartyCddRecord?.verifiedAt ?? null,
      transactionId: activeTransaction.id,
      isCoBroke: activeTransaction.offer?.isCoBroke ?? false,
      buyerAgentName: activeTransaction.offer?.buyerAgentName ?? null,
      buyerAgentCeaReg: activeTransaction.offer?.buyerAgentCeaReg ?? null,
    };
  }

  return {
    cdd: {
      status: cdd
        ? cdd.identityVerified
          ? ('verified' as const)
          : ('pending' as const)
        : ('not_started' as const),
      verifiedAt: cdd?.verifiedAt ?? null,
      riskLevel: cdd?.riskLevel ?? null,
      fullName: cdd?.fullName ?? null,
      nricLast4: cdd?.nricLast4 ? maskNric(cdd.nricLast4) : null,
    },
    eaa: {
      id: eaa?.id ?? null,
      status: eaa
        ? (eaa.status as 'signed' | 'active' | 'sent_to_seller' | 'draft')
        : ('not_started' as const),
      signedAt: eaa?.signedAt ?? null,
      expiryDate: eaa?.expiryDate ?? null,
      explanationConfirmedAt: eaa?.videoCallConfirmedAt ?? null,
      explanationMethod,
    },
    consent: {
      service: seller?.consentService ?? false,
      marketing: seller?.consentMarketing ?? false,
      withdrawnAt: seller?.consentWithdrawnAt ?? null,
    },
    caseFlags: caseFlags.map((f) => ({
      id: f.id,
      flagType: f.flagType,
      status: f.status,
      description: f.description,
    })),
    counterpartyCdd,
  };
}

export async function getNotificationHistory(
  sellerId: string,
  agentId?: string,
  opts?: { skip?: number; take?: number },
): Promise<{ items: Awaited<ReturnType<typeof prisma.notification.findMany>>; total: number }> {
  // RBAC: verify seller belongs to agent before returning notifications
  if (agentId) {
    const seller = await prisma.seller.findFirst({
      where: { id: sellerId, agentId },
      select: { id: true },
    });
    if (!seller) return { items: [], total: 0 };
  }

  const where = {
    recipientType: 'seller' as const,
    recipientId: sellerId,
  };

  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: opts?.skip ?? 0,
      take: opts?.take ?? 10,
    }),
    prisma.notification.count({ where }),
  ]);

  return { items, total };
}

export async function getPendingCorrectionRequests() {
  return prisma.dataCorrectionRequest.findMany({
    where: { status: { in: ['pending', 'in_progress'] } },
    include: {
      seller: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}
