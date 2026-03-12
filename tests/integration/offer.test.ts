// tests/integration/offer.test.ts
import { factory } from '../fixtures/factory';
import { testPrisma } from '../helpers/prisma';
import * as offerService from '../../src/domains/offer/offer.service';
import * as notificationService from '../../src/domains/notification/notification.service';

jest.mock('../../src/domains/shared/ai/ai.facade');
jest.mock('../../src/domains/notification/notification.service');

const mockNotification = jest.mocked(notificationService);

describe('offer integration', () => {
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
    await testPrisma.financialReport.deleteMany();
    await testPrisma.property.deleteMany();
    await testPrisma.seller.deleteMany();
    await testPrisma.agent.deleteMany();
    await testPrisma.systemSetting.deleteMany();

    mockNotification.send.mockResolvedValue(undefined as never);

    const agent = await factory.agent();
    agentId = agent.id;
    const seller = await factory.seller({ agentId });
    sellerId = seller.id;
    const property = await factory.property({ sellerId, town: 'TAMPINES', flatType: '4 ROOM' });
    propertyId = property.id;

    await factory.systemSetting({ key: 'offer_ai_analysis_enabled', value: 'false' });
  });

  it('records an offer and notifies seller', async () => {
    const offer = await offerService.createOffer({
      propertyId,
      sellerId,
      town: 'TAMPINES',
      flatType: '4 ROOM',
      buyerName: 'John Buyer',
      buyerPhone: '91234567',
      isCoBroke: false,
      offerAmount: 600000,
      agentId,
    });

    expect(offer.id).toBeDefined();
    expect(offer.status).toBe('pending');
    expect(mockNotification.send).toHaveBeenCalledTimes(1);
  });

  it('creates counter-offer chain and sets parent to countered', async () => {
    const original = await factory.offer({ propertyId, offerAmount: 600000 });

    await offerService.counterOffer({
      parentOfferId: original.id,
      counterAmount: 650000,
      agentId,
    });

    const updatedParent = await testPrisma.offer.findUnique({ where: { id: original.id } });
    const children = await testPrisma.offer.findMany({ where: { parentOfferId: original.id } });

    expect(updatedParent?.status).toBe('countered');
    expect(children).toHaveLength(1);
    expect(Number(children[0]?.counterAmount)).toBe(650000);
  });

  it('accepts offer and expires all pending/countered siblings', async () => {
    const accepted = await factory.offer({ propertyId, status: 'pending' });
    const sibling1 = await factory.offer({ propertyId, status: 'pending' });
    const sibling2 = await factory.offer({ propertyId, status: 'countered' });
    const rejected = await factory.offer({ propertyId, status: 'rejected' });

    await offerService.acceptOffer({ offerId: accepted.id, agentId });

    const [updatedAccepted, updatedSibling1, updatedSibling2, updatedRejected] = await Promise.all([
      testPrisma.offer.findUnique({ where: { id: accepted.id } }),
      testPrisma.offer.findUnique({ where: { id: sibling1.id } }),
      testPrisma.offer.findUnique({ where: { id: sibling2.id } }),
      testPrisma.offer.findUnique({ where: { id: rejected.id } }),
    ]);

    expect(updatedAccepted?.status).toBe('accepted');
    expect(updatedSibling1?.status).toBe('expired');
    expect(updatedSibling2?.status).toBe('expired');
    expect(updatedRejected?.status).toBe('rejected'); // unchanged
  });

  it('HITL: blocks sharing AI analysis before review', async () => {
    const offer = await factory.offer({ propertyId });
    await testPrisma.offer.update({
      where: { id: offer.id },
      data: { aiAnalysis: 'Test analysis', aiAnalysisStatus: 'generated' },
    });

    await expect(
      offerService.shareAiAnalysis({ offerId: offer.id, agentId, sellerId }),
    ).rejects.toThrow('must be reviewed');
  });

  it('HITL: allows sharing AI analysis after review', async () => {
    const offer = await factory.offer({ propertyId });
    await testPrisma.offer.update({
      where: { id: offer.id },
      data: {
        aiAnalysis: 'Test analysis',
        aiAnalysisProvider: 'anthropic',
        aiAnalysisModel: 'claude-test',
        aiAnalysisStatus: 'reviewed',
      },
    });

    await offerService.shareAiAnalysis({ offerId: offer.id, agentId, sellerId });

    const updated = await testPrisma.offer.findUnique({ where: { id: offer.id } });
    expect(updated?.aiAnalysisStatus).toBe('shared');
    expect(mockNotification.send).toHaveBeenCalled();
    expect(mockNotification.send).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: 'offer_analysis_shared' }),
      agentId,
    );
  });
});
