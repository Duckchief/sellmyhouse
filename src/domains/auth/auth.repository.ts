import { Prisma } from '@prisma/client';
import { prisma, createId } from '../../infra/database/prisma';

// ─── Seller ────────────────────────────────────────────────

export function findSellerByEmail(email: string) {
  return prisma.seller.findUnique({ where: { email } });
}

export function findSellerById(id: string) {
  return prisma.seller.findUnique({ where: { id } });
}

export function createSeller(data: {
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  consentService: boolean;
  consentMarketing: boolean;
  leadSource?: string;
}) {
  return prisma.seller.create({
    data: {
      id: createId(),
      name: data.name,
      email: data.email,
      phone: data.phone,
      passwordHash: data.passwordHash,
      consentService: data.consentService,
      consentMarketing: data.consentMarketing,
      consentTimestamp: new Date(),
      leadSource: 'website',
      status: 'lead',
    },
  });
}

export function updateSellerPasswordHash(id: string, passwordHash: string) {
  return prisma.seller.update({
    where: { id },
    data: { passwordHash },
  });
}

export function updateSellerTwoFactor(
  id: string,
  data: {
    twoFactorSecret?: string | null;
    twoFactorEnabled?: boolean;
    twoFactorBackupCodes?: Prisma.InputJsonValue;
  },
) {
  return prisma.seller.update({
    where: { id },
    data,
  });
}

export function incrementSellerFailedTwoFactor(id: string) {
  return prisma.seller.update({
    where: { id },
    data: { failedTwoFactorAttempts: { increment: 1 } },
  });
}

export function resetSellerFailedTwoFactor(id: string) {
  return prisma.seller.update({
    where: { id },
    data: { failedTwoFactorAttempts: 0, twoFactorLockedUntil: null },
  });
}

export function lockSellerTwoFactor(id: string, until: Date) {
  return prisma.seller.update({
    where: { id },
    data: { twoFactorLockedUntil: until },
  });
}

export function updateSellerBackupCodes(id: string, codes: Prisma.InputJsonValue) {
  return prisma.seller.update({
    where: { id },
    data: { twoFactorBackupCodes: codes },
  });
}

// ─── Agent ─────────────────────────────────────────────────

export function findAgentByEmail(email: string) {
  return prisma.agent.findUnique({ where: { email } });
}

export function findAgentById(id: string) {
  return prisma.agent.findUnique({ where: { id } });
}

export function updateAgentPasswordHash(id: string, passwordHash: string) {
  return prisma.agent.update({
    where: { id },
    data: { passwordHash },
  });
}

export function updateAgentTwoFactor(
  id: string,
  data: {
    twoFactorSecret?: string | null;
    twoFactorEnabled?: boolean;
    twoFactorBackupCodes?: Prisma.InputJsonValue;
  },
) {
  return prisma.agent.update({
    where: { id },
    data,
  });
}

export function incrementAgentFailedTwoFactor(id: string) {
  return prisma.agent.update({
    where: { id },
    data: { failedTwoFactorAttempts: { increment: 1 } },
  });
}

export function resetAgentFailedTwoFactor(id: string) {
  return prisma.agent.update({
    where: { id },
    data: { failedTwoFactorAttempts: 0, twoFactorLockedUntil: null },
  });
}

export function lockAgentTwoFactor(id: string, until: Date) {
  return prisma.agent.update({
    where: { id },
    data: { twoFactorLockedUntil: until },
  });
}

export function updateAgentBackupCodes(id: string, codes: Prisma.InputJsonValue) {
  return prisma.agent.update({
    where: { id },
    data: { twoFactorBackupCodes: codes },
  });
}

// ─── ConsentRecord ─────────────────────────────────────────

export function createConsentRecord(data: {
  subjectType: 'seller' | 'buyer';
  subjectId: string;
  purposeService: boolean;
  purposeMarketing: boolean;
  ipAddress?: string;
  userAgent?: string;
}) {
  return prisma.consentRecord.create({
    data: {
      id: createId(),
      subjectType: data.subjectType,
      subjectId: data.subjectId,
      purposeService: data.purposeService,
      purposeMarketing: data.purposeMarketing,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
    },
  });
}
