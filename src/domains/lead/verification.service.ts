import crypto from 'crypto';
import { ValidationError } from '../shared/errors';
import * as leadRepo from './lead.repository';
import * as auditService from '../shared/audit.service';
import * as notificationService from '../notification/notification.service';
import { propertyRepository as propertyRepo } from '../property/property.repository';
import { sendSystemEmail } from '../../infra/email/system-mailer';
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
    level: '',
    unitNumber: '',
    floorAreaSqm: 0,
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

export async function resendVerificationEmail(email: string): Promise<void> {
  const seller = await leadRepo.findUnverifiedSellerByEmail(email);
  if (!seller) return; // Don't leak existence

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 72);

  await leadRepo.setEmailVerificationToken(seller.id, hashedToken, expiry);

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const verificationUrl = `${appUrl}/verify-email?token=${rawToken}`;
  await sendSystemEmail(
    email,
    'Verify your SellMyHomeNow email address',
    `<p>Click the link below to verify your email and complete your submission:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p>This link expires in 72 hours.</p><p>If you did not submit a lead on SellMyHomeNow, please ignore this email.</p>`,
  );

  await auditService.log({
    action: 'lead.verification_resent',
    entityType: 'Seller',
    entityId: seller.id,
    details: { triggeredBy: 'seller' },
    actorType: 'system' as const,
  });
}

export async function agentResendVerification(sellerId: string, agentId: string): Promise<void> {
  const fullSeller = await leadRepo.findSellerWithEmail(sellerId);
  if (!fullSeller) throw new ValidationError('Seller not found');
  if (!fullSeller.email) throw new ValidationError('Seller has no email');
  if (fullSeller.emailVerified) throw new ValidationError('Email is already verified');

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 72);

  await leadRepo.setEmailVerificationToken(sellerId, hashedToken, expiry);

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const verificationUrl = `${appUrl}/verify-email?token=${rawToken}`;
  await sendSystemEmail(
    fullSeller.email,
    'Verify your SellMyHomeNow email address',
    `<p>Click the link below to verify your email and complete your submission:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p>This link expires in 72 hours.</p>`,
  );

  await auditService.log({
    action: 'lead.verification_resent',
    entityType: 'Seller',
    entityId: sellerId,
    details: { triggeredBy: 'agent', agentId },
    actorType: 'agent' as const,
    actorId: agentId,
  });
}
