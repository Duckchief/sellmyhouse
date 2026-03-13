import * as offerRepo from '@/domains/offer/offer.repository';
import * as auditService from '@/domains/shared/audit.service';
import { logger } from '../logger';

export async function runAnonymiseOffersJob(): Promise<void> {
  const offers = await offerRepo.findOffersForAnonymisation();
  let count = 0;
  for (const offer of offers) {
    try {
      await offerRepo.anonymiseOfferPii(offer.id);
      await auditService.log({
        action: 'compliance.offer_pii_anonymised',
        entityType: 'offer',
        entityId: offer.id,
        details: {
          retentionExpiresAt: offer.retentionExpiresAt,
        },
      });
      count++;
    } catch (err) {
      logger.error(
        { err, offerId: offer.id },
        'Failed to anonymise offer PII',
      );
    }
  }
  logger.info({ count }, 'Offer PII anonymisation complete');
}
