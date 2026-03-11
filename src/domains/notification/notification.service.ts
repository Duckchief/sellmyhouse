import crypto from 'crypto';
import * as notificationRepo from './notification.repository';
import { EmailProvider } from './providers/email.provider';
import { WhatsAppProvider } from './providers/whatsapp.provider';
import { logger } from '../../infra/logger';
import type { SendNotificationInput, NotificationChannel } from './notification.types';
import { NOTIFICATION_TEMPLATES } from './notification.templates';

export async function send(input: SendNotificationInput, agentId: string): Promise<void> {
  const content = renderTemplate(input.templateName, input.templateData);

  // Always create in-app notification
  const inAppRecord = await notificationRepo.create({
    recipientType: input.recipientType,
    recipientId: input.recipientId,
    channel: 'in_app',
    templateName: input.templateName,
    content,
  });
  await notificationRepo.updateStatus(inAppRecord.id, 'sent', { sentAt: new Date() });

  // Determine preferred external channel
  const preferredChannel = input.preferredChannel || 'whatsapp';

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
  const record = await notificationRepo.create({
    recipientType: input.recipientType,
    recipientId: input.recipientId,
    channel: primaryChannel,
    templateName: input.templateName,
    content,
  });

  try {
    const provider = primaryChannel === 'whatsapp' ? new WhatsAppProvider() : new EmailProvider();

    const result = await provider.send(input.recipientId, content, agentId);
    await notificationRepo.updateStatus(record.id, 'sent', {
      sentAt: new Date(),
      whatsappMessageId: result.messageId ?? undefined,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logger.warn({ err, channel: primaryChannel }, 'Primary notification channel failed');
    await notificationRepo.updateStatus(record.id, 'failed', { error: errorMessage });

    // Fallback: WhatsApp → email
    if (primaryChannel === 'whatsapp') {
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
      } catch (fallbackErr) {
        logger.error({ err: fallbackErr }, 'Email fallback also failed');
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
  const template = NOTIFICATION_TEMPLATES[templateName as keyof typeof NOTIFICATION_TEMPLATES] ?? NOTIFICATION_TEMPLATES.generic;
  return template.body.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || '');
}
