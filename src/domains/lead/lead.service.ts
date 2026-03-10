// src/domains/lead/lead.service.ts
import { ConflictError } from '../shared/errors';
import { logger } from '../../infra/logger';
import * as leadRepo from './lead.repository';
import * as auditService from '../shared/audit.service';
import * as notificationService from '../notification/notification.service';
import type { LeadInput, LeadResult } from './lead.types';

export async function submitLead(input: LeadInput): Promise<LeadResult> {
  // Check for duplicate
  const existing = await leadRepo.findActiveSellerByPhone(input.phone);
  if (existing) {
    throw new ConflictError('A lead with this phone number already exists');
  }

  // Create seller
  const seller = await leadRepo.createSellerLead({
    name: input.name.trim(),
    phone: input.phone,
    consentService: input.consentService,
    consentMarketing: input.consentMarketing,
    leadSource: input.leadSource,
  });

  // Create consent record (append-only)
  await leadRepo.createConsentRecord({
    subjectId: seller.id,
    purposeService: input.consentService,
    purposeMarketing: input.consentMarketing,
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

  // Notify admin agents
  const admins = await leadRepo.findAdminAgents();
  if (admins.length === 0) {
    logger.warn('No admin agents found to notify about new lead');
  } else {
    for (const admin of admins) {
      await notificationService.send(
        {
          recipientType: 'agent',
          recipientId: admin.id,
          templateName: 'generic',
          templateData: {
            message: `New lead: ${input.name} (${input.phone}) from ${input.leadSource}`,
          },
          preferredChannel: 'in_app',
        },
        'system',
      );
    }
  }

  return { sellerId: seller.id };
}
