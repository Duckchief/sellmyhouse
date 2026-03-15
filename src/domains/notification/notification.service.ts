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
import * as auditService from '../shared/audit.service';
import * as complianceService from '../compliance/compliance.service';
import { NotFoundError, ForbiddenError } from '../shared/errors';

async function resolveChannel(
  recipientId: string,
  recipientType: string,
): Promise<NotificationChannel> {
  // N7: Respect agent notificationPreference (not just sellers)
  if (recipientType === 'agent') {
    const agentPreference = await notificationRepo.findAgentNotificationPreference(recipientId);
    if (agentPreference === 'email_only') return 'email';
    return 'whatsapp';
  }

  if (recipientType !== 'seller') return 'whatsapp';

  const preference = await notificationRepo.findSellerNotificationPreference(recipientId);

  if (preference === 'email_only') return 'email';
  return 'whatsapp';
}

async function checkMarketingConsent(recipientId: string, recipientType: string): Promise<boolean> {
  if (recipientType !== 'seller') return true;

  return notificationRepo.findSellerMarketingConsent(recipientId);
}

export async function checkDnc(_phone: string): Promise<DncCheckResult> {
  // TODO: Integrate Singapore DNC Registry API before enabling
  // outbound marketing at scale. Currently always returns
  // { blocked: false }. Tracked in [your issue tracker].
  return { blocked: false };
}

export async function send(input: SendNotificationInput, agentId: string): Promise<void> {
  const content = renderTemplate(input.templateName, input.templateData);
  const notificationType = input.notificationType || 'transactional';

  // AML/CFT Reg 12H — Tipping-off prohibition
  // When a CDD record is flagged as sensitiveCase, suppress all seller-facing
  // notifications about compliance status to avoid alerting the seller.
  if (
    input.recipientType === 'seller' &&
    (input.templateName.includes('cdd') || input.templateName.includes('compliance'))
  ) {
    const sensitive = await complianceService.isSensitiveCaseSeller(input.recipientId);
    if (sensitive) {
      await auditService.log({
        action: 'notification.suppressed',
        entityType: 'notification',
        entityId: input.recipientId,
        details: { reason: 'sensitive_case', templateName: input.templateName },
      });
      return; // silently suppress — do not send
    }
  }

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

    // N5: Add unsubscribe URL for marketing emails
    if (input.recipientType === 'seller') {
      const unsubscribeToken = generateUnsubscribeToken(input.recipientId);
      const appUrl = process.env.APP_URL || 'https://sellmyhomenow.sg';
      input.templateData = {
        ...input.templateData,
        unsubscribeUrl: `${appUrl}/api/notifications/unsubscribe?token=${unsubscribeToken}`,
      };
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

  // DNC compliance gate — calls compliance service with sellerId + messageType
  if (
    (resolvedChannel === 'whatsapp' || resolvedChannel === 'email') &&
    input.recipientType === 'seller'
  ) {
    const messageType = input.notificationType === 'marketing' ? 'marketing' : 'service';
    const dncResult = await complianceService.checkDncAllowed(
      input.recipientId,
      resolvedChannel,
      messageType,
    );
    if (!dncResult.allowed) {
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
          recipientId: input.recipientId,
          templateName: input.templateName,
          reason: dncResult.reason,
          messageType,
        },
      });
      return; // Do not send — in-app notification was already created
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

export async function countUnreadNotifications(
  recipientType: 'seller' | 'agent',
  recipientId: string,
) {
  return notificationRepo.countUnreadForRecipient(recipientType, recipientId);
}

export async function markAsRead(
  notificationId: string,
  recipientId: string,
  recipientType: 'seller' | 'agent',
): Promise<void> {
  const notification = await notificationRepo.findById(notificationId);
  if (!notification) throw new NotFoundError('Notification', notificationId);
  if (notification.recipientId !== recipientId || notification.recipientType !== recipientType) {
    throw new ForbiddenError("Cannot mark another user's notification as read");
  }
  await notificationRepo.markAsRead(notificationId);
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  const secret = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!secret || !signature) return false;

  const expectedSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const expected = Buffer.from(`sha256=${expectedSignature}`);
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function renderTemplate(templateName: string, data: Record<string, string>): string {
  const template =
    NOTIFICATION_TEMPLATES[templateName as keyof typeof NOTIFICATION_TEMPLATES] ??
    NOTIFICATION_TEMPLATES.generic;
  return template.body.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || '');
}

export function generateUnsubscribeToken(sellerId: string): string {
  return jwt.sign({ sellerId, purpose: 'marketing_consent_withdrawal' }, process.env.JWT_SECRET!, {
    expiresIn: '30d',
  });
}

export async function handleUnsubscribe(sellerId: string): Promise<void> {
  await notificationRepo.withdrawMarketingConsent(sellerId);

  await auditService.log({
    action: 'consent.marketing_withdrawn',
    entityType: 'seller',
    entityId: sellerId,
    details: { channel: 'email_unsubscribe' },
  });
}
