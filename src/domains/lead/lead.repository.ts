import crypto from 'crypto';
import { prisma, createId } from '../../infra/database/prisma';
import type { Prisma } from '@prisma/client';

export async function findActiveSellerByPhone(phone: string) {
  return prisma.seller.findFirst({
    where: {
      phone,
      status: { in: ['lead', 'engaged', 'active'] },
    },
  });
}

export async function createSellerLead(
  tx: Prisma.TransactionClient,
  data: {
    name: string;
    email: string;
    countryCode: string;
    nationalNumber: string;
    phone: string;
    consentService: boolean;
    consentMarketing: boolean;
    leadSource: string;
    retentionExpiresAt?: Date;
  },
) {
  const id = createId();
  return tx.seller.create({
    data: {
      id,
      name: data.name,
      email: data.email,
      countryCode: data.countryCode,
      nationalNumber: data.nationalNumber,
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
      retentionExpiresAt: data.retentionExpiresAt,
    },
  });
}

export async function createConsentRecord(
  tx: Prisma.TransactionClient,
  data: {
    sellerId: string;
    purposeService: boolean;
    purposeMarketing: boolean;
    purposeHuttonsTransfer?: boolean;
    ipAddress?: string;
    userAgent?: string;
  },
) {
  return tx.consentRecord.create({
    data: {
      id: createId(),
      subjectType: 'seller',
      subjectId: data.sellerId, // legacy column — kept for data continuity
      sellerId: data.sellerId,
      purposeService: data.purposeService,
      purposeMarketing: data.purposeMarketing,
      purposeHuttonsTransfer: data.purposeHuttonsTransfer ?? false,
      version: '1.0',
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    },
  });
}

export async function submitLeadAtomically(data: {
  name: string;
  email: string;
  countryCode: string;
  nationalNumber: string;
  phone: string;
  consentService: boolean;
  consentMarketing: boolean;
  leadSource: string;
  retentionExpiresAt?: Date;
  ipAddress?: string;
  userAgent?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const seller = await createSellerLead(tx, {
      name: data.name,
      email: data.email,
      countryCode: data.countryCode,
      nationalNumber: data.nationalNumber,
      phone: data.phone,
      consentService: data.consentService,
      consentMarketing: data.consentMarketing,
      leadSource: data.leadSource,
      retentionExpiresAt: data.retentionExpiresAt,
    });

    await createConsentRecord(tx, {
      sellerId: seller.id,
      purposeService: data.consentService,
      purposeMarketing: data.consentMarketing,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    });

    return seller;
  });
}

export async function setEmailVerificationToken(
  sellerId: string,
  hashedToken: string,
  expiry: Date,
): Promise<void> {
  await prisma.seller.update({
    where: { id: sellerId },
    data: {
      emailVerificationToken: hashedToken,
      emailVerificationExpiry: expiry,
    },
  });
}

export async function findAdminAgents() {
  return prisma.agent.findMany({
    where: { role: 'admin', isActive: true },
    select: { id: true, notificationPreference: true },
  });
}

export async function findSellerByVerificationToken(rawToken: string) {
  const hashed = crypto.createHash('sha256').update(rawToken).digest('hex');
  return prisma.seller.findFirst({
    where: { emailVerificationToken: hashed },
    select: {
      id: true,
      emailVerified: true,
      emailVerificationExpiry: true,
      agentId: true,
    },
  });
}

export async function markEmailVerified(sellerId: string): Promise<void> {
  await prisma.seller.update({
    where: { id: sellerId },
    data: {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiry: null,
    },
  });
}

export async function findSellerById(sellerId: string) {
  return prisma.seller.findUnique({
    where: { id: sellerId },
    select: { id: true, emailVerified: true, agentId: true },
  });
}

export async function updateSellingIntent(
  sellerId: string,
  data: {
    sellingTimeline: string;
    sellingReason: string;
    sellingReasonOther?: string;
  },
): Promise<void> {
  await prisma.seller.update({
    where: { id: sellerId },
    data: {
      sellingTimeline: data.sellingTimeline as 'one_to_three_months' | 'three_to_six_months' | 'just_thinking',
      sellingReason: data.sellingReason as 'upgrading' | 'downsizing' | 'relocating' | 'financial' | 'investment' | 'other',
      sellingReasonOther: data.sellingReasonOther ?? null,
    },
  });
}

export async function assignAgent(sellerId: string, agentId: string): Promise<void> {
  await prisma.seller.update({ where: { id: sellerId }, data: { agentId } });
}
