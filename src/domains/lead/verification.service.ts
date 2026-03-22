import { ValidationError } from '../shared/errors';
import * as leadRepo from './lead.repository';
import * as auditService from '../shared/audit.service';
import * as notificationService from '../notification/notification.service';
import { propertyRepository as propertyRepo } from '../property/property.repository';
import type { LeadDetailsInput } from './verification.types';

export async function verifyEmailToken(rawToken: string): Promise<{ sellerId: string }> {
  const seller = await leadRepo.findSellerByVerificationToken(rawToken);

  if (!seller || !seller.emailVerificationExpiry || seller.emailVerificationExpiry < new Date()) {
    throw new ValidationError('Invalid or expired verification link');
  }

  await leadRepo.markEmailVerified(seller.id);

  await auditService.log({
    action: 'lead.email_verified',
    entityType: 'Seller',
    entityId: seller.id,
    details: {},
    actorType: 'system' as const,
  });

  return { sellerId: seller.id };
}

export async function submitLeadDetails(input: LeadDetailsInput): Promise<void> {
  const seller = await leadRepo.findSellerById(input.sellerId);
  if (!seller || !seller.emailVerified) {
    throw new ValidationError('Email must be verified before submitting details');
  }

  // Create property with minimal required fields — lead-stage property
  await propertyRepo.create({
    sellerId: input.sellerId,
    block: input.block,
    street: input.street,
    town: input.town,
    flatType: 'Unknown',
    storeyRange: 'Unknown',
    floorAreaSqm: 0,
    flatModel: 'Unknown',
    leaseCommenceDate: 0,
    askingPrice: input.askingPrice,
  });

  await leadRepo.updateSellingIntent(input.sellerId, {
    sellingTimeline: input.sellingTimeline,
    sellingReason: input.sellingReason,
    sellingReasonOther: input.sellingReasonOther,
  });

  await auditService.log({
    action: 'lead.details_submitted',
    entityType: 'Seller',
    entityId: input.sellerId,
    details: {
      town: input.town,
      sellingTimeline: input.sellingTimeline,
      sellingReason: input.sellingReason,
    },
    actorType: 'seller' as const,
    actorId: input.sellerId,
  });

  // Notify assigned agent if any
  if (seller.agentId) {
    await notificationService.send(
      {
        recipientType: 'agent',
        recipientId: seller.agentId,
        templateName: 'generic',
        templateData: {
          message: `Lead details submitted: ${input.block} ${input.street}, ${input.town}. Timeline: ${input.sellingTimeline}. Ready for follow-up.`,
        },
      },
      'system',
    );
  }
}
