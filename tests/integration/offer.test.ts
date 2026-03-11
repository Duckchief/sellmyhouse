import { factory } from '../fixtures/factory';
import { testPrisma } from '../helpers/prisma';
import * as offerRepo from '@/domains/offer/offer.repository';
import { createId } from '@paralleldrive/cuid2';

describe('offer.repository', () => {
  let agentId: string;
  let sellerId: string;
  let propertyId: string;

  beforeEach(async () => {
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
  });

  describe('create', () => {
    it('creates an offer record', async () => {
      const id = createId();
      const offer = await offerRepo.create({
        id,
        propertyId,
        buyerName: 'John Doe',
        buyerPhone: '91234567',
        isCoBroke: false,
        offerAmount: 600000,
      });
      expect(offer.id).toBe(id);
      expect(offer.status).toBe('pending');
      expect(offer.propertyId).toBe(propertyId);
    });
  });

  describe('findById', () => {
    it('returns offer by id', async () => {
      const created = await factory.offer({ propertyId });
      const found = await offerRepo.findById(created.id);
      expect(found?.id).toBe(created.id);
    });

    it('returns null for unknown id', async () => {
      const found = await offerRepo.findById('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('findByPropertyId', () => {
    it('returns all offers for a property including counter-offer chain', async () => {
      const offer1 = await factory.offer({ propertyId });
      const offer2 = await factory.offer({ propertyId });
      const results = await offerRepo.findByPropertyId(propertyId);
      expect(results.length).toBeGreaterThanOrEqual(2);
      const ids = results.map((o) => o.id);
      expect(ids).toContain(offer1.id);
      expect(ids).toContain(offer2.id);
    });

    it('returns empty array for property with no offers', async () => {
      const results = await offerRepo.findByPropertyId(propertyId);
      expect(results).toEqual([]);
    });
  });

  describe('updateStatus', () => {
    it('updates offer status', async () => {
      const offer = await factory.offer({ propertyId });
      const updated = await offerRepo.updateStatus(offer.id, 'accepted');
      expect(updated.status).toBe('accepted');
    });
  });

  describe('updateAiAnalysis', () => {
    it('stores AI analysis data on offer', async () => {
      const offer = await factory.offer({ propertyId });
      const updated = await offerRepo.updateAiAnalysis(offer.id, {
        aiAnalysis: 'This offer is below market median.',
        aiAnalysisProvider: 'anthropic',
        aiAnalysisModel: 'claude-sonnet-4-20250514',
        aiAnalysisStatus: 'generated',
      });
      expect(updated.aiAnalysis).toBe('This offer is below market median.');
      expect(updated.aiAnalysisStatus).toBe('generated');
    });
  });

  describe('updateAiAnalysisStatus', () => {
    it('updates only the AI analysis status without modifying other fields', async () => {
      const offer = await factory.offer({ propertyId });
      await offerRepo.updateAiAnalysis(offer.id, {
        aiAnalysis: 'Original analysis',
        aiAnalysisProvider: 'anthropic',
        aiAnalysisModel: 'claude-sonnet-4-20250514',
        aiAnalysisStatus: 'generated',
      });

      const updated = await offerRepo.updateAiAnalysisStatus(offer.id, 'reviewed');
      expect(updated.aiAnalysisStatus).toBe('reviewed');
      expect(updated.aiAnalysis).toBe('Original analysis');
      expect(updated.aiAnalysisProvider).toBe('anthropic');
      expect(updated.aiAnalysisModel).toBe('claude-sonnet-4-20250514');
    });
  });

  describe('expirePendingAndCounteredSiblings', () => {
    it('sets all pending and countered siblings to expired', async () => {
      const pending1 = await factory.offer({ propertyId, status: 'pending' });
      const pending2 = await factory.offer({ propertyId, status: 'pending' });
      const countered = await factory.offer({ propertyId, status: 'countered' });
      const rejected = await factory.offer({ propertyId, status: 'rejected' });

      await offerRepo.expirePendingAndCounteredSiblings(propertyId, pending1.id);

      const updated2 = await offerRepo.findById(pending2.id);
      const updatedCountered = await offerRepo.findById(countered.id);
      const updatedRejected = await offerRepo.findById(rejected.id);

      expect(updated2?.status).toBe('expired');
      expect(updatedCountered?.status).toBe('expired');
      expect(updatedRejected?.status).toBe('rejected'); // not changed
    });
  });
});
