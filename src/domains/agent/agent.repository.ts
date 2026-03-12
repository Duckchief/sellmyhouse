import { prisma } from '@/infra/database/prisma';
import type { Prisma, SellerStatus, LeadSource } from '@prisma/client';
import type { SellerListFilter } from './agent.types';

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

  const [cddRecords, eaaRecords, seller, caseFlags] = await Promise.all([
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
  ]);

  const cdd = cddRecords[0];
  const eaa = eaaRecords[0];

  return {
    cdd: {
      status: cdd
        ? cdd.identityVerified
          ? ('verified' as const)
          : ('pending' as const)
        : ('not_started' as const),
      verifiedAt: cdd?.verifiedAt ?? null,
    },
    eaa: {
      status: eaa
        ? eaa.status === 'signed' || eaa.status === 'active'
          ? ('signed' as const)
          : eaa.status === 'sent_to_seller'
            ? ('sent' as const)
            : ('draft' as const)
        : ('not_started' as const),
      signedAt: eaa?.signedAt ?? null,
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
  };
}

export async function getNotificationHistory(sellerId: string, agentId?: string) {
  // RBAC: verify seller belongs to agent before returning notifications
  if (agentId) {
    const seller = await prisma.seller.findFirst({
      where: { id: sellerId, agentId },
      select: { id: true },
    });
    if (!seller) return [];
  }

  return prisma.notification.findMany({
    where: {
      recipientType: 'seller',
      recipientId: sellerId,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
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
