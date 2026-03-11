import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import * as notificationRepo from './notification.repository';
import { EmailProvider } from './providers/email.provider';
import { WhatsAppProvider } from './providers/whatsapp.provider';
import { logger } from '../../infra/logger';
import type {
  SendNotificationInput,
  NotificationChannel,
  DncCheckResult,
} from './notification.types';
import { NOTIFICATION_TEMPLATES, WHATSAPP_TEMPLATE_STATUS } from './notification.templates';
import { prisma, createId } from '../../infra/database/prisma';
import * as auditService from '../shared/audit.service';

async function resolveChannel(
  recipientId: string,
  recipientType: string,
): Promise<NotificationChannel> {
  if (recipientType !== 'seller') return 'whatsapp'; // agents use both by default

  const seller = await prisma.seller.findUnique({
    where: { id: recipientId },
    select: { notificationPreference: true },
  });

  if (seller?.notificationPreference === 'email_only') return 'email';
  return 'whatsapp';
}

async function checkMarketingConsent(recipientId: string, recipientType: string): Promise<boolean> {
  if (recipientType !== 'seller') return true;

  const seller = await prisma.seller.findUnique({
    where: { id: recipientId },
    select: { consentMarketing: true },
  });

  return seller?.consentMarketing ?? false;
}

export async function checkDnc(_phone: string): Promise<DncCheckResult> {
  // TODO: Integrate with Singapore DNC registry API
  return { blocked: false };
}

export async function send(input: SendNotificationInput, agentId: string): Promise<void> {
  const content = renderTemplate(input.templateName, input.templateData);
  const notificationType = input.notificationType || 'transactional';

  // Always create in-app notification
  const inAppRecord = await notificationRepo.create({
    recipientType: input.recipientType,
    recipientId: input.recipientId,
    channel: 'in_app',
    templateName: input.templateName,
    content,
  });
  await notificationRepo.updateStatus(inAppRecord.id, 'sent', { sentAt: new Date() });

  // Check marketing consent
  if (notificationType === 'marketing') {
    const hasConsent = await checkMarketingConsent(input.recipientId, input.recipientType);
    if (!hasConsent) {
      await auditService.log({
        action: 'notification.marketing_blocked',
        entityType: 'notification',
        entityId: inAppRecord.id,
        details: {
          recipientType: input.recipientType,
          recipientId: input.recipientId,
          templateName: input.templateName,
        },
      });
      return; // Only in-app delivered
    }
  }

  // Resolve preferred channel based on seller preference
  const preferredChannel =
    input.preferredChannel || (await resolveChannel(input.recipientId, input.recipientType));

  if (preferredChannel === 'whatsapp' || preferredChannel === 'email') {
    await sendExternal(input, content, agentId, preferredChannel);
  }
}

async function sendExternal(
  input: SendNotificationInput,
  content: string,
  agentId: string,
  primaryChannel: NotificationChannel,
): Promise<void> {
  // Amendment F: Check WhatsApp template approval status
  let resolvedChannel = primaryChannel;
  if (resolvedChannel === 'whatsapp') {
    const templateStatus =
      WHATSAPP_TEMPLATE_STATUS[input.templateName as keyof typeof WHATSAPP_TEMPLATE_STATUS];
    if (templateStatus !== 'approved') {
      logger.info(
        { templateName: input.templateName, status: templateStatus },
        'WhatsApp template not approved, falling back to email',
      );
      resolvedChannel = 'email';
    }
  }

  // Task 19: DNC registry check — before sending via WhatsApp
  // Call via `exports` so jest.spyOn works in tests (CJS module interop)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const selfModule = require('./notification.service') as typeof import('./notification.service');
  if (resolvedChannel === 'whatsapp' && input.recipientPhone) {
    const dncResult = await selfModule.checkDnc(input.recipientPhone);
    if (dncResult.blocked) {
      // Create a temporary record to log against before we have a real one
      const dncRecord = await notificationRepo.create({
        recipientType: input.recipientType,
        recipientId: input.recipientId,
        channel: resolvedChannel,
        templateName: input.templateName,
        content,
      });
      await auditService.log({
        action: 'notification.dnc_blocked',
        entityType: 'notification',
        entityId: dncRecord.id,
        details: {
          phone: input.recipientPhone.slice(-4),
          templateName: input.templateName,
          reason: dncResult.reason,
        },
      });
      resolvedChannel = 'email';
    }
  }

  const record = await notificationRepo.create({
    recipientType: input.recipientType,
    recipientId: input.recipientId,
    channel: resolvedChannel,
    templateName: input.templateName,
    content,
  });

  try {
    const provider = resolvedChannel === 'whatsapp' ? new WhatsAppProvider() : new EmailProvider();

    const result = await provider.send(input.recipientId, content, agentId);
    await notificationRepo.updateStatus(record.id, 'sent', {
      sentAt: new Date(),
      whatsappMessageId: result.messageId ?? undefined,
    });

    // Task 17: Audit log on successful send
    await auditService.log({
      action: 'notification.sent',
      entityType: 'notification',
      entityId: record.id,
      details: {
        channel: resolvedChannel,
        templateName: input.templateName,
        recipientType: input.recipientType,
        recipientId: input.recipientId,
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logger.warn({ err, channel: resolvedChannel }, 'Primary notification channel failed');
    await notificationRepo.updateStatus(record.id, 'failed', { error: errorMessage });

    // Task 17: Audit log on primary channel failure
    await auditService.log({
      action: 'notification.failed',
      entityType: 'notification',
      entityId: record.id,
      details: {
        channel: resolvedChannel,
        templateName: input.templateName,
        error: errorMessage,
      },
    });

    // Fallback: WhatsApp → email
    if (resolvedChannel === 'whatsapp') {
      try {
        const fallbackRecord = await notificationRepo.create({
          recipientType: input.recipientType,
          recipientId: input.recipientId,
          channel: 'email',
          templateName: input.templateName,
          content,
        });

        const emailProvider = new EmailProvider();
        const result = await emailProvider.send(input.recipientId, content, agentId);
        await notificationRepo.updateStatus(fallbackRecord.id, 'sent', {
          sentAt: new Date(),
          whatsappMessageId: result.messageId ?? undefined,
        });

        // Task 17: Audit log on successful fallback
        await auditService.log({
          action: 'notification.fallback',
          entityType: 'notification',
          entityId: fallbackRecord.id,
          details: {
            primaryChannel: resolvedChannel,
            fallbackChannel: 'email',
            templateName: input.templateName,
            recipientType: input.recipientType,
            recipientId: input.recipientId,
          },
        });
      } catch (fallbackErr) {
        logger.error({ err: fallbackErr }, 'Email fallback also failed');

        // Task 20: Both channels failed — audit and alert agent
        await auditService.log({
          action: 'notification.all_channels_failed',
          entityType: 'notification',
          entityId: record.id,
          details: { recipientId: input.recipientId, templateName: input.templateName },
        });

        // Create in-app notification for agent
        await notificationRepo.create({
          recipientType: 'agent',
          recipientId: agentId,
          channel: 'in_app',
          templateName: 'generic',
          content: `Communication failure: unable to reach recipient via WhatsApp or email for ${input.templateName}. Please follow up manually.`,
        });
      }
    }
  }
}

export async function handleWhatsAppWebhook(body: unknown): Promise<void> {
  const data = body as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          statuses?: Array<{
            id: string;
            status: string;
            timestamp: string;
          }>;
        };
      }>;
    }>;
  };

  const statuses = data?.entry?.[0]?.changes?.[0]?.value?.statuses;
  if (!statuses) return;

  for (const status of statuses) {
    const notification = await notificationRepo.findByWhatsAppMessageId(status.id);
    if (!notification) continue;

    if (status.status === 'delivered') {
      await notificationRepo.updateStatus(notification.id, 'delivered', {
        deliveredAt: new Date(parseInt(status.timestamp) * 1000),
      });
    } else if (status.status === 'read') {
      await notificationRepo.updateStatus(notification.id, 'read', {
        readAt: new Date(parseInt(status.timestamp) * 1000),
      });
    } else if (status.status === 'failed') {
      await notificationRepo.updateStatus(notification.id, 'failed', {
        error: 'Delivery failed (Meta callback)',
      });
    }
  }
}

export async function getUnreadNotifications(
  recipientType: 'seller' | 'agent',
  recipientId: string,
) {
  return notificationRepo.findUnreadForRecipient(recipientType, recipientId);
}

export async function markAsRead(notificationId: string) {
  return notificationRepo.markAsRead(notificationId);
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  const secret = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!secret || !signature) return false;

  const expectedSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  return `sha256=${expectedSignature}` === signature;
}

function renderTemplate(templateName: string, data: Record<string, string>): string {
  const template =
    NOTIFICATION_TEMPLATES[templateName as keyof typeof NOTIFICATION_TEMPLATES] ??
    NOTIFICATION_TEMPLATES.generic;
  return template.body.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || '');
}

export function generateUnsubscribeToken(sellerId: string): string {
  return jwt.sign(
    { sellerId, purpose: 'marketing_consent_withdrawal' },
    process.env.SESSION_SECRET!,
    { expiresIn: '30d' },
  );
}

export async function handleUnsubscribe(sellerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.seller.update({
      where: { id: sellerId },
      data: { consentMarketing: false, consentWithdrawnAt: new Date() },
    });

    await tx.consentRecord.create({
      data: {
        id: createId(),
        subjectType: 'seller',
        subjectId: sellerId,
        purposeService: true,
        purposeMarketing: false,
        consentGivenAt: new Date(),
        consentWithdrawnAt: new Date(),
        ipAddress: 'unsubscribe-link',
        userAgent: 'email-unsubscribe',
      },
    });
  });

  await auditService.log({
    action: 'consent.marketing_withdrawn',
    entityType: 'seller',
    entityId: sellerId,
    details: { channel: 'email_unsubscribe' },
  });
}
