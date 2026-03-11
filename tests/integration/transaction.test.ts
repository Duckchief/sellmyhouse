// tests/integration/transaction.test.ts
import { factory } from '../fixtures/factory';
import { testPrisma } from '../helpers/prisma';
import * as txService from '../../src/domains/transaction/transaction.service';
import * as notificationService from '../../src/domains/notification/notification.service';

jest.mock('../../src/domains/notification/notification.service');
jest.mock('../../src/infra/storage/local-storage', () => ({
  localStorage: {
    save: jest.fn().mockResolvedValue('/uploads/test/file.pdf'),
    read: jest.fn().mockResolvedValue(Buffer.from('mock-pdf')),
  },
}));
jest.mock('../../src/domains/property/portal.service');

const mockNotification = jest.mocked(notificationService);

describe('transaction integration', () => {
  let agentId: string;
  let sellerId: string;
  let propertyId: string;

  beforeEach(async () => {
    await testPrisma.commissionInvoice.deleteMany();
    await testPrisma.otp.deleteMany();
    await testPrisma.transaction.deleteMany();
    await testPrisma.offer.deleteMany();
    await testPrisma.portalListing.deleteMany();
    await testPrisma.listing.deleteMany();
    await testPrisma.property.deleteMany();
    await testPrisma.seller.deleteMany();
    await testPrisma.agent.deleteMany();
    await testPrisma.systemSetting.deleteMany();

    mockNotification.send.mockResolvedValue(undefined as never);

    const agent = await factory.agent();
    agentId = agent.id;
    const seller = await factory.seller({ agentId });
    sellerId = seller.id;
    const property = await factory.property({ sellerId });
    propertyId = property.id;

    await testPrisma.systemSetting.createMany({
      data: [
        { id: 's1', key: 'commission_amount', value: '1499', description: 'test' },
        { id: 's2', key: 'gst_rate', value: '0.09', description: 'test' },
        { id: 's3', key: 'otp_exercise_days', value: '21', description: 'test' },
      ],
    });
  });

  it('creates a transaction', async () => {
    const tx = await txService.createTransaction({
      propertyId,
      sellerId,
      agreedPrice: 600000,
      agentId,
    });

    expect(tx.id).toBeDefined();
    expect(tx.status).toBe('option_issued');

    const persisted = await testPrisma.transaction.findUnique({ where: { id: tx.id } });
    expect(persisted?.status).toBe('option_issued');
  });

  it('OTP: creates OTP, rejects double-creation', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });

    await txService.createOtp({ transactionId: tx.id, hdbSerialNumber: 'SN-001', agentId });

    await expect(
      txService.createOtp({ transactionId: tx.id, hdbSerialNumber: 'SN-002', agentId }),
    ).rejects.toThrow('OTP already exists');
  });

  it('OTP: advances status strictly sequentially', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });
    await factory.otp({ transactionId: tx.id, status: 'prepared' });

    await txService.advanceOtp({ transactionId: tx.id, agentId });

    const otp = await testPrisma.otp.findFirst({ where: { transactionId: tx.id } });
    expect(otp?.status).toBe('sent_to_seller');
  });

  it('OTP: blocks issued_to_buyer without agent review', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });
    await factory.otp({ transactionId: tx.id, status: 'returned', agentReviewedAt: null });

    await expect(
      txService.advanceOtp({ transactionId: tx.id, agentId }),
    ).rejects.toThrow('must review OTP');
  });

  it('OTP: sets exerciseDeadline when advancing to issued_to_buyer', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });
    await factory.otp({
      transactionId: tx.id,
      status: 'returned',
      agentReviewedAt: new Date(),
    });

    await txService.advanceOtp({ transactionId: tx.id, agentId });

    const updated = await testPrisma.transaction.findUnique({ where: { id: tx.id } });
    expect(updated?.exerciseDeadline).not.toBeNull();
  });

  it('invoice: reads amounts from SystemSetting not schema defaults', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });

    const invoice = await txService.uploadInvoice({
      transactionId: tx.id,
      fileBuffer: Buffer.from('fake-pdf'),
      originalFilename: 'invoice.pdf',
      invoiceNumber: 'INV-001',
      agentId,
    });

    expect(Number(invoice.amount)).toBe(1499);
    expect(Number(invoice.gstAmount)).toBeCloseTo(134.91, 1);
    expect(Number(invoice.totalAmount)).toBeCloseTo(1633.91, 1);
  });

  it('completionDate auto-set on transition to completed', async () => {
    const tx = await factory.transaction({ propertyId, sellerId, status: 'completing' });

    await txService.advanceTransactionStatus({
      transactionId: tx.id,
      status: 'completed',
      agentId,
    });

    const updated = await testPrisma.transaction.findUnique({ where: { id: tx.id } });
    expect(updated?.completionDate).not.toBeNull();
  });

  it('fallen-through cascade: expires OTP and portal listings', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });
    await factory.otp({ transactionId: tx.id, status: 'issued_to_buyer' });

    await txService.advanceTransactionStatus({
      transactionId: tx.id,
      status: 'fallen_through',
      agentId,
    });

    const otp = await testPrisma.otp.findFirst({ where: { transactionId: tx.id } });
    expect(otp?.status).toBe('expired');
  });

  it('OTP: uploadOtpScan stores seller scan path', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });
    await factory.otp({ transactionId: tx.id, status: 'signed_by_seller' });

    await txService.uploadOtpScan({
      transactionId: tx.id,
      scanType: 'seller',
      fileBuffer: Buffer.from('fake-scan'),
      originalFilename: 'signed.pdf',
      agentId,
    });

    const otp = await testPrisma.otp.findFirst({ where: { transactionId: tx.id } });
    expect(otp?.scannedCopyPathSeller).not.toBeNull();
  });

  it('OTP: uploadOtpScan stores returned scan path', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });
    await factory.otp({
      transactionId: tx.id,
      status: 'returned',
      scannedCopyPathSeller: 'otp/tx-1/seller.pdf',
    });

    await txService.uploadOtpScan({
      transactionId: tx.id,
      scanType: 'returned',
      fileBuffer: Buffer.from('fake-scan'),
      originalFilename: 'returned.pdf',
      agentId,
    });

    const otp = await testPrisma.otp.findFirst({ where: { transactionId: tx.id } });
    expect(otp?.scannedCopyPathReturned).not.toBeNull();
  });

  it('invoice: sendInvoice updates status to sent_to_client', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });
    const invoice = await factory.commissionInvoice({
      transactionId: tx.id,
      status: 'uploaded',
      invoiceFilePath: '/uploads/invoices/test.pdf',
    });

    await txService.sendInvoice({ transactionId: tx.id, sellerId, agentId });

    const updated = await testPrisma.commissionInvoice.findUnique({ where: { id: invoice.id } });
    expect(updated?.status).toBe('sent_to_client');
  });
});
