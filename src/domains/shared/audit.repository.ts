import { Prisma } from '@prisma/client';
import { prisma, createId } from '../../infra/database/prisma';
import type { AuditEntry, AuditLogRecord } from './audit.types';

export async function create(entry: AuditEntry): Promise<AuditLogRecord> {
  return prisma.auditLog.create({
    data: {
      id: createId(),
      agentId: entry.agentId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      details: entry.details as Prisma.InputJsonValue,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}

export async function findByEntity(
  entityType: string,
  entityId: string,
): Promise<AuditLogRecord[]> {
  return prisma.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'desc' },
  });
}
