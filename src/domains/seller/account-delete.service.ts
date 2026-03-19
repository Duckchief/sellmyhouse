// src/domains/seller/account-delete.service.ts
import bcrypt from 'bcrypt';
import * as authRepo from '../auth/auth.repository';
import * as complianceRepo from '../compliance/compliance.repository';
import { localStorage } from '@/infra/storage/local-storage';
import * as auditService from '../shared/audit.service';
import { UnauthorizedError } from '../shared/errors';

export async function deleteSellerAccount(sellerId: string, password: string): Promise<void> {
  const seller = await authRepo.findSellerById(sellerId);
  if (!seller || !seller.passwordHash) {
    throw new UnauthorizedError('Invalid credentials');
  }

  const valid = await bcrypt.compare(password, seller.passwordHash);
  if (!valid) {
    throw new UnauthorizedError('Incorrect password');
  }

  // Audit log BEFORE deletion so the record survives the cascade
  await auditService.log({
    action: 'seller.self_service_delete',
    entityType: 'seller',
    entityId: sellerId,
    details: { reason: 'self_service_request' },
    actorType: 'seller',
    actorId: sellerId,
  });

  // Collect file paths before the DB cascade removes FK references
  const filePaths = await complianceRepo.collectSellerFilePaths(sellerId);
  await complianceRepo.hardDeleteSeller(sellerId);

  // Best-effort file deletion — DB record already gone, log failures but don't throw
  for (const filePath of filePaths) {
    try {
      await localStorage.delete(filePath);
    } catch (err) {
      await auditService.log({
        action: 'compliance.file_unlink_failed',
        entityType: 'seller',
        entityId: sellerId,
        details: {
          filePath,
          error: err instanceof Error ? err.message : String(err),
        },
        actorType: 'system',
      });
    }
  }
}
