// src/domains/lead/lead.service.ts
import crypto from 'crypto';
import { ConflictError } from '../shared/errors';
import { logger } from '../../infra/logger';
import { sendSystemEmail } from '../../infra/email/system-mailer';
import * as leadRepo from './lead.repository';
import * as settingsService from '../shared/settings.service';
import * as auditService from '../shared/audit.service';
import * as notificationService from '../notification/notification.service';
import { maskPhone } from '../shared/nric';
import type { LeadInput, LeadResult } from './lead.types';

export async function submitLead(input: LeadInput): Promise<LeadResult> {
  // Check for duplicate
  const existing = await leadRepo.findActiveSellerByPhone(input.phone);
  if (existing) {
    throw new ConflictError('A lead with this phone number already exists');
  }

  // Provisional retention: lead_retention_months (actual purge handled by scanRetention)
  const retentionMonths = await settingsService.getNumber('lead_retention_months', 12);
  const retentionExpiresAt = new Date();
  retentionExpiresAt.setMonth(retentionExpiresAt.getMonth() + retentionMonths);

  // Create seller and consent record atomically — if consent creation fails,
  // the seller row is rolled back (PDPA: no personal data without consent audit trail)
  const seller = await leadRepo.submitLeadAtomically({
    name: input.name.trim(),
    email: input.email.trim(),
    countryCode: input.countryCode,
    nationalNumber: input.nationalNumber,
    phone: input.phone,
    consentService: input.consentService,
    consentMarketing: input.consentMarketing,
    leadSource: input.leadSource,
    retentionExpiresAt,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  // Generate email verification token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const verificationExpiry = new Date();
  verificationExpiry.setHours(verificationExpiry.getHours() + 72);

  await leadRepo.setEmailVerificationToken(seller.id, hashedToken, verificationExpiry);

  // Send verification email
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const verificationUrl = `${appUrl}/verify-email?token=${rawToken}`;
  await sendSystemEmail(
    input.email,
    'Verify your SellMyHouse email address',
    `<p>Click the link below to verify your email and complete your submission:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p>This link expires in 72 hours.</p><p>If you did not submit a lead on SellMyHouse, please ignore this email.</p>`,
  );

  await auditService.log({
    action: 'lead.verification_sent',
    entityType: 'Seller',
    entityId: seller.id,
    details: { email: input.email },
    actorType: 'system' as const,
  });

  // Audit log
  await auditService.log({
    action: 'lead.created',
    entityType: 'Seller',
    entityId: seller.id,
    details: { leadSource: input.leadSource, phone: maskPhone(input.phone) },
    actorType: 'system' as const,
  });

  // A1: Audit consent events from lead capture
  // The ConsentRecord was created inside the $transaction above — we reference seller.id
  // since the consent record ID is not returned from the transaction block
  await auditService.log({
    action: 'consent.service_given',
    entityType: 'seller',
    entityId: seller.id,
    details: { sellerId: seller.id, purposeService: true },
    actorType: 'seller' as const,
    actorId: seller.id,
  });

  if (input.consentMarketing) {
    await auditService.log({
      action: 'consent.marketing_given',
      entityType: 'seller',
      entityId: seller.id,
      details: { sellerId: seller.id },
      actorType: 'seller' as const,
      actorId: seller.id,
    });
  }

  // Auto-assign to default agent if configured
  const defaultAgentId = await settingsService.get('default_agent_id', '');
  if (defaultAgentId) {
    await leadRepo.assignAgent(seller.id, defaultAgentId);
    await auditService.log({
      action: 'lead.auto_assigned',
      entityType: 'Seller',
      entityId: seller.id,
      details: { agentId: defaultAgentId, reason: 'default_agent' },
      actorType: 'system' as const,
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
