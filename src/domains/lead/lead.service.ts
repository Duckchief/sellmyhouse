// src/domains/lead/lead.service.ts
import { ConflictError } from '../shared/errors';
import { logger } from '../../infra/logger';
import * as leadRepo from './lead.repository';
import * as settingsService from '../shared/settings.service';
import * as auditService from '../shared/audit.service';
import * as notificationService from '../notification/notification.service';
import type { LeadInput, LeadResult } from './lead.types';

export async function submitLead(input: LeadInput): Promise<LeadResult> {
  // Check for duplicate
  const existing = await leadRepo.findActiveSellerByPhone(input.phone);
  if (existing) {
    throw new ConflictError('A lead with this phone number already exists');
  }

  // Compute provisional retention expiry (adjustable when transaction completes)
  const retentionYears = await settingsService.getNumber('data_retention_years', 6);
  const retentionExpiresAt = new Date();
  retentionExpiresAt.setFullYear(retentionExpiresAt.getFullYear() + retentionYears);

  // Create seller and consent record atomically — if consent creation fails,
  // the seller row is rolled back (PDPA: no personal data without consent audit trail)
  const seller = await leadRepo.submitLeadAtomically({
    name: input.name.trim(),
    phone: input.phone,
    consentService: input.consentService,
    consentMarketing: input.consentMarketing,
    leadSource: input.leadSource,
    retentionExpiresAt,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  // Audit log
  await auditService.log({
    action: 'lead.created',
    entityType: 'Seller',
    entityId: seller.id,
    details: { leadSource: input.leadSource, phone: input.phone },
  });

  // A1: Audit consent events from lead capture
  // The ConsentRecord was created inside the $transaction above — we reference seller.id
  // since the consent record ID is not returned from the transaction block
  await auditService.log({
    action: 'consent.service_given',
    entityType: 'seller',
    entityId: seller.id,
    details: { sellerId: seller.id, purposeService: true },
  });

  if (input.consentMarketing) {
    await auditService.log({
      action: 'consent.marketing_given',
      entityType: 'seller',
      entityId: seller.id,
      details: { sellerId: seller.id },
    });
  }

  // N1: Send welcome notification to seller
  await notificationService.send(
    {
      recipientType: 'seller',
      recipientId: seller.id,
      templateName: 'welcome_seller',
      templateData: { name: input.name.trim() },
    },
    'system',
  );

  // Notify admin agents via their preferred channel
  const admins = await leadRepo.findAdminAgents();
  if (admins.length === 0) {
    logger.warn('No admin agents found to notify about new lead');
  } else {
    for (const admin of admins) {
      const preferredChannel = admin.notificationPreference === 'email_only' ? 'email' : 'whatsapp';
      await notificationService.send(
        {
          recipientType: 'agent',
          recipientId: admin.id,
          templateName: 'generic',
          templateData: {
            message: `New lead: ${input.name} (${input.phone}) from ${input.leadSource}`,
          },
          preferredChannel,
        },
        'system',
      );
    }
  }

  return { sellerId: seller.id };
}
