import { prisma, createId } from '../../infra/database/prisma';

export async function findActiveSellerByPhone(phone: string) {
  return prisma.seller.findFirst({
    where: {
      phone,
      status: { in: ['lead', 'engaged', 'active'] },
    },
  });
}

export async function createSellerLead(data: {
  name: string;
  phone: string;
  consentService: boolean;
  consentMarketing: boolean;
  leadSource: string;
}) {
  const id = createId();
  return prisma.seller.create({
    data: {
      id,
      name: data.name,
      phone: data.phone,
      consentService: data.consentService,
      consentMarketing: data.consentMarketing,
      consentTimestamp: new Date(),
      leadSource: data.leadSource as
        | 'website'
        | 'tiktok'
        | 'instagram'
        | 'referral'
        | 'walkin'
        | 'other',
      status: 'lead',
    },
  });
}

export async function createConsentRecord(data: {
  subjectId: string;
  purposeService: boolean;
  purposeMarketing: boolean;
  ipAddress?: string;
  userAgent?: string;
}) {
  return prisma.consentRecord.create({
    data: {
      id: createId(),
      subjectType: 'seller',
      subjectId: data.subjectId,
      purposeService: data.purposeService,
      purposeMarketing: data.purposeMarketing,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    },
  });
}

export async function findAdminAgents() {
  return prisma.agent.findMany({
    where: { role: 'admin', isActive: true },
    select: { id: true },
  });
}
