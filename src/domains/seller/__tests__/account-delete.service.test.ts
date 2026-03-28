// src/domains/seller/__tests__/account-delete.service.test.ts
import * as accountDeleteService from '../account-delete.service';
import * as authRepo from '../../auth/auth.repository';
import * as complianceRepo from '../../compliance/compliance.repository';
import * as auditService from '../../shared/audit.service';
import { localStorage } from '@/infra/storage/local-storage';
import { encryptedStorage } from '@/infra/storage/encrypted-storage';

jest.mock('../../auth/auth.repository');
jest.mock('../../compliance/compliance.repository');
jest.mock('../../shared/audit.service');
jest.mock('@/infra/storage/local-storage', () => ({
  localStorage: { delete: jest.fn() },
}));
jest.mock('@/infra/storage/encrypted-storage', () => ({
  encryptedStorage: { delete: jest.fn() },
}));
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

import bcrypt from 'bcrypt';

const mockAuthRepo = authRepo as jest.Mocked<typeof authRepo>;
const mockComplianceRepo = complianceRepo as jest.Mocked<typeof complianceRepo>;
const mockAudit = auditService as jest.Mocked<typeof auditService>;
const mockStorage = localStorage as jest.Mocked<typeof localStorage>;
const mockEncryptedStorage = encryptedStorage as jest.Mocked<typeof encryptedStorage>;
const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

beforeEach(() => jest.clearAllMocks());

describe('deleteSellerAccount', () => {
  it('throws UnauthorizedError when seller is not found', async () => {
    mockAuthRepo.findSellerById.mockResolvedValue(null);

    await expect(accountDeleteService.deleteSellerAccount('seller-1', 'anypass')).rejects.toThrow(
      'Invalid credentials',
    );
  });

  it('throws UnauthorizedError when password is incorrect', async () => {
    mockAuthRepo.findSellerById.mockResolvedValue({
      id: 'seller-1',
      passwordHash: '$2b$12$hashed',
    } as never);
    mockBcrypt.compare.mockResolvedValue(false as never);

    await expect(accountDeleteService.deleteSellerAccount('seller-1', 'wrongpass')).rejects.toThrow(
      'Incorrect password',
    );
  });

  it('audit logs, hard deletes seller, and removes files when password is correct', async () => {
    mockAuthRepo.findSellerById.mockResolvedValue({
      id: 'seller-1',
      passwordHash: '$2b$12$hashed',
    } as never);
    mockBcrypt.compare.mockResolvedValue(true as never);
    mockComplianceRepo.collectSellerFilePaths.mockResolvedValue([
      'uploads/photo1.jpg',
      'seller-docs/seller-1/nric-abc.jpg.enc',
    ]);
    mockComplianceRepo.hardDeleteSeller.mockResolvedValue(undefined);
    mockStorage.delete.mockResolvedValue(undefined);
    mockEncryptedStorage.delete.mockResolvedValue(undefined);
    mockAudit.log.mockResolvedValue(undefined);

    await accountDeleteService.deleteSellerAccount('seller-1', 'correctpass');

    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'seller.self_service_delete',
        entityType: 'seller',
        entityId: 'seller-1',
        actorType: 'seller',
        actorId: 'seller-1',
      }),
    );
    expect(mockComplianceRepo.collectSellerFilePaths).toHaveBeenCalledWith('seller-1');
    expect(mockComplianceRepo.hardDeleteSeller).toHaveBeenCalledWith('seller-1');
    // Non-.enc files use localStorage
    expect(mockStorage.delete).toHaveBeenCalledWith('uploads/photo1.jpg');
    // .enc files use encryptedStorage
    expect(mockEncryptedStorage.delete).toHaveBeenCalledWith('seller-docs/seller-1/nric-abc.jpg.enc');
  });

  it('still deletes seller when a file cannot be removed', async () => {
    mockAuthRepo.findSellerById.mockResolvedValue({
      id: 'seller-1',
      passwordHash: '$2b$12$hashed',
    } as never);
    mockBcrypt.compare.mockResolvedValue(true as never);
    mockComplianceRepo.collectSellerFilePaths.mockResolvedValue(['uploads/photo.jpg']);
    mockComplianceRepo.hardDeleteSeller.mockResolvedValue(undefined);
    mockStorage.delete.mockRejectedValue(new Error('disk error'));
    mockAudit.log.mockResolvedValue(undefined);

    // Should not throw despite file error
    await expect(
      accountDeleteService.deleteSellerAccount('seller-1', 'correctpass'),
    ).resolves.toBeUndefined();

    expect(mockComplianceRepo.hardDeleteSeller).toHaveBeenCalledWith('seller-1');
  });

  it('audit logs before deleting (so the log survives)', async () => {
    const callOrder: string[] = [];
    mockAuthRepo.findSellerById.mockResolvedValue({
      id: 'seller-1',
      passwordHash: '$2b$12$hashed',
    } as never);
    mockBcrypt.compare.mockResolvedValue(true as never);
    mockComplianceRepo.collectSellerFilePaths.mockResolvedValue([]);
    mockComplianceRepo.hardDeleteSeller.mockImplementation(async () => {
      callOrder.push('delete');
    });
    mockAudit.log.mockImplementation(async () => {
      callOrder.push('audit');
    });

    await accountDeleteService.deleteSellerAccount('seller-1', 'pass');

    expect(callOrder).toEqual(['audit', 'delete']);
  });
});
