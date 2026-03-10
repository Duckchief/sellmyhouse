import { prisma, createId } from '../../infra/database/prisma';
import type { SettingRecord } from './settings.types';

export async function findByKey(key: string): Promise<SettingRecord | null> {
  return prisma.systemSetting.findUnique({ where: { key } });
}

export async function findAll(): Promise<SettingRecord[]> {
  return prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
}

export async function upsert(
  key: string,
  value: string,
  description: string,
  agentId?: string,
): Promise<SettingRecord> {
  return prisma.systemSetting.upsert({
    where: { key },
    update: { value, updatedByAgentId: agentId ?? null },
    create: { id: createId(), key, value, description, updatedByAgentId: agentId ?? null },
  });
}
