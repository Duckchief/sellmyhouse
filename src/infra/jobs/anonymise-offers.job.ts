import * as offerRepo from '@/domains/offer/offer.repository';
import { logger } from '../logger';

export async function runAnonymiseOffersJob(): Promise<void> {
  const offers = await offerRepo.findOffersForAnonymisation();
  let count = 0;
  for (const offer of offers) {
    try {
      // M65: Atomically anonymise PII and create audit log in a single transaction
      await offerRepo.anonymiseOfferPiiWithAudit(offer.id, {
        action: 'compliance.offer_pii_anonymised',
        entityType: 'offer',
        entityId: offer.id,
        details: {
          retentionExpiresAt: offer.retentionExpiresAt,
        },
      });
      count++;
    } catch (err) {
      logger.error({ err, offerId: offer.id }, 'Failed to anonymise offer PII');
    }
  }
  logger.info({ count }, 'Offer PII anonymisation complete');
}
