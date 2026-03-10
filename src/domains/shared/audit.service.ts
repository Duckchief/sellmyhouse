import * as auditRepo from './audit.repository';
import type { AuditEntry, AuditLogRecord } from './audit.types';
import { logger } from '../../infra/logger';

export async function log(entry: AuditEntry): Promise<void> {
  try {
    await auditRepo.create(entry);
  } catch (err) {
    // Audit logging is fire-and-forget — never block the request
    logger.error({ err, entry }, 'Failed to write audit log');
  }
}

export async function getEntityHistory(
  entityType: string,
  entityId: string,
): Promise<AuditLogRecord[]> {
  return auditRepo.findByEntity(entityType, entityId);
}
