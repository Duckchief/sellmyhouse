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

export function incrementSellerFailedLoginAttempts(id: string) {
  return prisma.seller.update({
    where: { id },
    data: { failedLoginAttempts: { increment: 1 } },
  });
}

export function lockSellerLogin(id: string, until: Date) {
  return prisma.seller.update({
    where: { id },
    data: { loginLockedUntil: until, failedLoginAttempts: 0 },
  });
}

export function resetSellerLoginAttempts(id: string) {
  return prisma.seller.update({
    where: { id },
    data: { failedLoginAttempts: 0, loginLockedUntil: null },
  });
}

export function setSellerPasswordResetToken(id: string, hashedToken: string, expiry: Date) {
  return prisma.seller.update({
    where: { id },
    data: { passwordResetToken: hashedToken, passwordResetExpiry: expiry },
  });
}

export function findSellerByResetToken(hashedToken: string) {
  return prisma.seller.findFirst({
    where: { passwordResetToken: hashedToken },
  });
}

export function clearSellerPasswordResetToken(id: string) {
  return prisma.seller.update({
    where: { id },
    data: { passwordResetToken: null, passwordResetExpiry: null },
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

export async function removeBackupCodeAtomically(
  userId: string,
  role: 'seller' | 'agent' | 'admin',
  codeIndex: number,
  currentCodes: string[],
) {
  const remaining = [...currentCodes.slice(0, codeIndex), ...currentCodes.slice(codeIndex + 1)];
  return prisma.$transaction(async (tx) => {
    if (role === 'seller') {
      await tx.seller.update({
        where: { id: userId },
        data: { twoFactorBackupCodes: remaining },
      });
    } else {
      await tx.agent.update({
        where: { id: userId },
        data: { twoFactorBackupCodes: remaining },
      });
    }
    return remaining;
  });
}

export function incrementAgentFailedLoginAttempts(id: string) {
  return prisma.agent.update({
    where: { id },
    data: { failedLoginAttempts: { increment: 1 } },
  });
}

export function lockAgentLogin(id: string, until: Date) {
  return prisma.agent.update({
    where: { id },
    data: { loginLockedUntil: until, failedLoginAttempts: 0 },
  });
}

export function resetAgentLoginAttempts(id: string) {
  return prisma.agent.update({
    where: { id },
    data: { failedLoginAttempts: 0, loginLockedUntil: null },
  });
}

export function setAgentPasswordResetToken(id: string, hashedToken: string, expiry: Date) {
  return prisma.agent.update({
    where: { id },
    data: { passwordResetToken: hashedToken, passwordResetExpiry: expiry },
  });
}

export function findAgentByResetToken(hashedToken: string) {
  return prisma.agent.findFirst({
    where: { passwordResetToken: hashedToken },
  });
}

export function clearAgentPasswordResetToken(id: string) {
  return prisma.agent.update({
    where: { id },
    data: { passwordResetToken: null, passwordResetExpiry: null },
  });
}

// ─── Session Invalidation ───────────────────────────────────

export async function invalidateUserSessions(userId: string, exceptSessionId?: string) {
  if (exceptSessionId) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "session" WHERE sess::text LIKE $1 AND sid != $2`,
      `%"id":"${userId}"%`,
      exceptSessionId,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "session" WHERE sess::text LIKE $1`,
      `%"id":"${userId}"%`,
    );
  }
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
