// src/domains/profile/profile.repository.ts
import bcrypt from 'bcrypt';
import { prisma } from '../../infra/database/prisma';

const profileSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
  twoFactorEnabled: true,
  avatarPath: true,
} as const;

export function findAgentById(agentId: string) {
  return prisma.agent.findUnique({
    where: { id: agentId },
    select: profileSelect,
  });
}

export function updateAvatarPath(agentId: string, avatarPath: string) {
  return prisma.agent.update({
    where: { id: agentId },
    data: { avatarPath },
  });
}

export function clearAvatarPath(agentId: string) {
  return prisma.agent.update({
    where: { id: agentId },
    data: { avatarPath: null },
  });
}

export function updatePasswordHash(agentId: string, hash: string) {
  return prisma.agent.update({
    where: { id: agentId },
    data: { passwordHash: hash },
  });
}

export async function verifyPassword(agentId: string, password: string): Promise<boolean> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { passwordHash: true },
  });
  if (!agent) return false;
  return bcrypt.compare(password, agent.passwordHash);
}
