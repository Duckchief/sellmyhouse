import * as sellerDocService from '../seller-document.service';

jest.mock('@/infra/database/prisma', () => ({
  prisma: { sellerDocument: {} },
}));

jest.mock('../seller-document.repository', () => ({
  create: jest.fn(),
  countActiveBySellerAndDocType: jest.fn(),
  findById: jest.fn(),
  findActiveBySeller: jest.fn(),
  findAllBySeller: jest.fn(),
  markDownloadedAndDeleted: jest.fn(),
  hardDelete: jest.fn(),
  findExpiredUnpurged: jest.fn(),
  markPurged: jest.fn(),
}));

jest.mock('../seller.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('@/infra/storage/encrypted-storage', () => ({
  encryptedStorage: {
    save: jest.fn(),
    read: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('@/infra/security/virus-scanner', () => ({
  scanBuffer: jest.fn().mockResolvedValue({ isClean: true, viruses: [] }),
}));

jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn().mockResolvedValue({ mime: 'image/jpeg' }),
}));

jest.mock('../../shared/audit.service', () => ({
  log: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../notification/notification.service', () => ({
  createInAppNotification: jest.fn().mockResolvedValue(undefined),
}));

import * as sellerDocRepo from '../seller-document.repository';
import * as sellerRepo from '../seller.repository';
import { encryptedStorage } from '@/infra/storage/encrypted-storage';
import { scanBuffer } from '@/infra/security/virus-scanner';
import { fileTypeFromBuffer } from 'file-type';
import * as auditService from '../../shared/audit.service';
import * as notificationService from '../../notification/notification.service';
import type { UploadSellerDocumentInput } from '../seller.types';

const mockSellerDocRepo = sellerDocRepo as jest.Mocked<typeof sellerDocRepo>;
const mockSellerRepo = sellerRepo as jest.Mocked<typeof sellerRepo>;

beforeEach(() => jest.clearAllMocks());

describe('uploadSellerDocument', () => {
  const validInput: UploadSellerDocumentInput = {
    sellerId: 'seller-1',
    docType: 'nric',
    fileBuffer: Buffer.from('fake-file'),
    mimeType: 'image/jpeg',
    originalFilename: 'nric-front.jpg',
    uploadedBy: 'seller-1',
    uploadedByRole: 'seller',
  };

  beforeEach(() => {
    mockSellerRepo.findById.mockResolvedValue({ id: 'seller-1', agentId: 'agent-1' } as any);
    mockSellerDocRepo.countActiveBySellerAndDocType.mockResolvedValue(0);
    (encryptedStorage.save as jest.Mock).mockResolvedValue({
      path: 'seller-docs/seller-1/nric-abc.enc',
      wrappedKey: 'wrapped-key-base64',
    });
    mockSellerDocRepo.create.mockResolvedValue({
      id: 'doc-1',
      sellerId: 'seller-1',
      docType: 'nric',
      slotIndex: 0,
      path: 'seller-docs/seller-1/nric-abc.enc',
      wrappedKey: 'wrapped-key-base64',
      mimeType: 'image/jpeg',
      sizeBytes: 9,
      uploadedAt: new Date(),
      uploadedBy: 'seller-1',
      downloadedAt: null,
      downloadedBy: null,
      deletedAt: null,
    });
  });

  it('encrypts file, saves to DB, notifies agent, and audits', async () => {
    const result = await sellerDocService.uploadSellerDocument(validInput);

    expect(scanBuffer).toHaveBeenCalledWith(validInput.fileBuffer, validInput.originalFilename);
    expect(encryptedStorage.save).toHaveBeenCalledWith(
      expect.stringMatching(/^seller-docs\/seller-1\/nric-.+\.jpg\.enc$/),
      validInput.fileBuffer,
    );
    expect(mockSellerDocRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerId: 'seller-1',
        docType: 'nric',
        slotIndex: 0,
        mimeType: 'image/jpeg',
        uploadedBy: 'seller-1',
      }),
    );
    expect(notificationService.createInAppNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientType: 'agent',
        recipientId: 'agent-1',
        templateName: 'seller_document_uploaded',
      }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'seller_document.uploaded',
        entityType: 'seller',
        entityId: 'seller-1',
      }),
    );
    expect(result.id).toBe('doc-1');
  });

  it('rejects when file count exceeds max for docType', async () => {
    mockSellerDocRepo.countActiveBySellerAndDocType.mockResolvedValue(2);

    await expect(sellerDocService.uploadSellerDocument(validInput)).rejects.toThrow(
      'Maximum 2 files allowed for nric',
    );
  });

  it('rejects when virus scan fails', async () => {
    (scanBuffer as jest.Mock).mockResolvedValue({ isClean: false, viruses: ['EICAR'] });

    await expect(sellerDocService.uploadSellerDocument(validInput)).rejects.toThrow(
      'File rejected: security scan failed',
    );
  });

  it('rejects when MIME type is invalid', async () => {
    (fileTypeFromBuffer as jest.Mock).mockResolvedValue({ mime: 'text/html' });

    await expect(sellerDocService.uploadSellerDocument(validInput)).rejects.toThrow(
      'File content does not match a valid image or PDF',
    );
  });

  it('rejects invalid docType', async () => {
    const badInput = { ...validInput, docType: 'passport' as any };

    await expect(sellerDocService.uploadSellerDocument(badInput)).rejects.toThrow(
      'Invalid document type',
    );
  });
});

describe('downloadAndDeleteSellerDocument', () => {
  const mockDoc = {
    id: 'doc-1',
    sellerId: 'seller-1',
    path: 'seller-docs/seller-1/nric-abc.enc',
    wrappedKey: 'wrapped-key',
    mimeType: 'image/jpeg',
    docType: 'nric',
    deletedAt: null,
    downloadedAt: null,
  };

  it('decrypts file, marks as downloaded+deleted, audits', async () => {
    mockSellerDocRepo.findById.mockResolvedValue(mockDoc as any);
    (encryptedStorage.read as jest.Mock).mockResolvedValue(Buffer.from('decrypted'));
    (encryptedStorage.delete as jest.Mock).mockResolvedValue(undefined);
    mockSellerDocRepo.markDownloadedAndDeleted.mockResolvedValue({} as any);

    const result = await sellerDocService.downloadAndDeleteSellerDocument('doc-1', 'agent-1');

    expect(encryptedStorage.read).toHaveBeenCalledWith(mockDoc.path, mockDoc.wrappedKey);
    expect(encryptedStorage.delete).toHaveBeenCalledWith(mockDoc.path);
    expect(mockSellerDocRepo.markDownloadedAndDeleted).toHaveBeenCalledWith('doc-1', 'agent-1');
    expect(result.buffer).toEqual(Buffer.from('decrypted'));
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('rejects if document not found', async () => {
    mockSellerDocRepo.findById.mockResolvedValue(null);

    await expect(
      sellerDocService.downloadAndDeleteSellerDocument('bad-id', 'agent-1'),
    ).rejects.toThrow('SellerDocument');
  });

  it('rejects if already deleted', async () => {
    mockSellerDocRepo.findById.mockResolvedValue({ ...mockDoc, deletedAt: new Date() } as any);

    await expect(
      sellerDocService.downloadAndDeleteSellerDocument('doc-1', 'agent-1'),
    ).rejects.toThrow('already been deleted');
  });
});

describe('deleteSellerDocumentBySeller', () => {
  const mockDoc = {
    id: 'doc-1',
    sellerId: 'seller-1',
    path: 'seller-docs/seller-1/nric-abc.enc',
    wrappedKey: 'wrapped-key',
    downloadedAt: null,
    deletedAt: null,
  };

  it('deletes file and removes DB row if not yet downloaded', async () => {
    mockSellerDocRepo.findById.mockResolvedValue(mockDoc as any);
    (encryptedStorage.delete as jest.Mock).mockResolvedValue(undefined);
    mockSellerDocRepo.hardDelete.mockResolvedValue(undefined);

    await sellerDocService.deleteSellerDocumentBySeller('doc-1', 'seller-1');

    expect(encryptedStorage.delete).toHaveBeenCalledWith(mockDoc.path);
    expect(mockSellerDocRepo.hardDelete).toHaveBeenCalledWith('doc-1');
  });

  it('rejects if seller does not own document', async () => {
    mockSellerDocRepo.findById.mockResolvedValue({ ...mockDoc, sellerId: 'other' } as any);

    await expect(
      sellerDocService.deleteSellerDocumentBySeller('doc-1', 'seller-1'),
    ).rejects.toThrow();
  });

  it('rejects if already downloaded by agent', async () => {
    mockSellerDocRepo.findById.mockResolvedValue({
      ...mockDoc,
      downloadedAt: new Date(),
    } as any);

    await expect(
      sellerDocService.deleteSellerDocumentBySeller('doc-1', 'seller-1'),
    ).rejects.toThrow('already been received');
  });
});

describe('getDocumentChecklistWithStatus', () => {
  it('derives status from DB records', async () => {
    mockSellerDocRepo.findAllBySeller.mockResolvedValue([
      { docType: 'nric', deletedAt: null } as any,
      { docType: 'eaa', deletedAt: new Date() } as any,
    ]);

    const result = await sellerDocService.getDocumentChecklistWithStatus('seller-1', 'draft');

    const nric = result.find((i) => i.id === 'nric');
    const eaa = result.find((i) => i.id === 'estate-agency-agreement');
    const marriage = result.find((i) => i.id === 'marriage-cert');

    expect(nric?.status).toBe('uploaded');
    expect(eaa?.status).toBe('received_by_agent');
    expect(marriage?.status).toBe('not_uploaded');
  });
});
