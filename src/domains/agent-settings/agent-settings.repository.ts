import { prisma, createId } from '../../infra/database/prisma';

export function upsert(agentId: string, key: string, encryptedValue: string) {
  return prisma.agentSetting.upsert({
    where: { agentId_key: { agentId, key } },
    update: { encryptedValue },
    create: {
      id: createId(),
      agentId,
      key,
      encryptedValue,
    },
  });
}

export function findAllForAgent(agentId: string) {
  return prisma.agentSetting.findMany({
    where: { agentId },
    orderBy: { key: 'asc' },
  });
}

export function findByKey(agentId: string, key: string) {
  return prisma.agentSetting.findUnique({
    where: { agentId_key: { agentId, key } },
  });
}

export function deleteByKey(agentId: string, key: string) {
  return prisma.agentSetting.deleteMany({
    where: { agentId, key },
  });
}
