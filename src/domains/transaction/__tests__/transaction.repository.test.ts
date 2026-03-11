// src/domains/transaction/__tests__/transaction.repository.test.ts
import { factory } from '../../../tests/fixtures/factory';
import { testPrisma } from '../../../tests/helpers/prisma';
import * as txRepo from '../transaction.repository';
import { createId } from '@paralleldrive/cuid2';

describe('transaction.repository', () => {
  let agentId: string;
  let sellerId: string;
  let propertyId: string;
  let transactionId: string;

  beforeEach(async () => {
    await testPrisma.otp.deleteMany();
    await testPrisma.commissionInvoice.deleteMany();
    await testPrisma.transaction.deleteMany();
    await testPrisma.offer.deleteMany();
    await testPrisma.property.deleteMany();
    await testPrisma.seller.deleteMany();
    await testPrisma.agent.deleteMany();

    const agent = await factory.agent();
    agentId = agent.id;
    const seller = await factory.seller({ agentId });
    sellerId = seller.id;
    const property = await factory.property({ sellerId });
    propertyId = property.id;
    const tx = await factory.transaction({ propertyId, sellerId, agreedPrice: 600000 });
    transactionId = tx.id;
  });

  describe('createTransaction', () => {
    it('creates a transaction record', async () => {
      const id = createId();
      const tx = await txRepo.createTransaction({
        id,
        propertyId,
        sellerId,
        agreedPrice: 650000,
      });
      expect(tx.id).toBe(id);
      expect(tx.status).toBe('option_issued');
    });
  });

  describe('findById', () => {
    it('returns transaction with otp and invoice', async () => {
      const tx = await txRepo.findById(transactionId);
      expect(tx?.id).toBe(transactionId);
    });

    it('returns null for unknown id', async () => {
      const tx = await txRepo.findById('nonexistent');
      expect(tx).toBeNull();
    });
  });

  describe('updateTransactionStatus', () => {
    it('updates status and sets completionDate when transitioning to completed', async () => {
      const updated = await txRepo.updateTransactionStatus(transactionId, 'completed', new Date());
      expect(updated.status).toBe('completed');
      expect(updated.completionDate).not.toBeNull();
    });
  });

  describe('createOtp', () => {
    it('creates an OTP record linked to transaction', async () => {
      const otp = await txRepo.createOtp({
        id: createId(),
        transactionId,
        hdbSerialNumber: 'SN-001',
      });
      expect(otp.transactionId).toBe(transactionId);
      expect(otp.status).toBe('prepared');
    });
  });

  describe('findOtpByTransactionId', () => {
    it('returns null when no OTP exists', async () => {
      const otp = await txRepo.findOtpByTransactionId(transactionId);
      expect(otp).toBeNull();
    });
  });

  describe('updateOtpStatus', () => {
    it('advances OTP status', async () => {
      const otp = await factory.otp({ transactionId });
      const updated = await txRepo.updateOtpStatus(otp.id, 'sent_to_seller');
      expect(updated.status).toBe('sent_to_seller');
    });
  });
});
