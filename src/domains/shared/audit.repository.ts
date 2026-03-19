import { Prisma } from '@prisma/client';
import { prisma, createId } from '../../infra/database/prisma';
import type { AuditEntry, AuditLogRecord } from './audit.types';

export async function create(entry: AuditEntry): Promise<AuditLogRecord> {
  return prisma.auditLog.create({
    data: {
      id: createId(),
      agentId: entry.agentId ?? null,
      actorType: entry.actorType ?? null,
      actorId: entry.actorId ?? null,
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

function buildAuditWhere(filter: {
  action?: string;
  entityType?: string;
  dateFrom?: Date;
  dateTo?: Date;
}): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (filter.action) where.action = { contains: filter.action, mode: 'insensitive' };
  if (filter.entityType) where.entityType = { contains: filter.entityType, mode: 'insensitive' };
  if (filter.dateFrom || filter.dateTo) {
    where.createdAt = {
      ...(filter.dateFrom ? { gte: filter.dateFrom } : {}),
      ...(filter.dateTo ? { lte: filter.dateTo } : {}),
    };
  }
  return where;
}

export async function findMany(filter: {
  action?: string;
  entityType?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}) {
  const where = buildAuditWhere(filter);
  const page = filter.page ?? 1;
  const limit = filter.limit ?? 50;

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { entries, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function exportAll(filter: {
  action?: string;
  entityType?: string;
  dateFrom?: Date;
  dateTo?: Date;
}) {
  const where = buildAuditWhere(filter);
  return prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' } });
}
