import { prisma, createId } from '../../infra/database/prisma';
import type { NotificationChannel, NotificationStatus } from './notification.types';

export function create(data: {
  recipientType: 'seller' | 'agent' | 'viewer';
  recipientId: string;
  channel: NotificationChannel;
  templateName: string;
  content: string;
}) {
  return prisma.notification.create({
    data: {
      id: createId(),
      recipientType: data.recipientType,
      recipientId: data.recipientId,
      channel: data.channel,
      templateName: data.templateName,
      content: data.content,
      status: 'pending',
    },
  });
}

export function updateStatus(
  id: string,
  status: NotificationStatus,
  extra?: {
    sentAt?: Date;
    deliveredAt?: Date;
    readAt?: Date;
    whatsappMessageId?: string;
    error?: string;
  },
) {
  return prisma.notification.update({
    where: { id },
    data: {
      status,
      ...extra,
    },
  });
}

export function findUnreadForRecipient(recipientType: 'seller' | 'agent', recipientId: string) {
  return prisma.notification.findMany({
    where: {
      recipientType,
      recipientId,
      channel: 'in_app',
      status: { not: 'read' },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export function findById(id: string) {
  return prisma.notification.findUnique({ where: { id } });
}

export function markAsRead(id: string) {
  return prisma.notification.update({
    where: { id },
    data: { status: 'read', readAt: new Date() },
  });
}

export function findByWhatsAppMessageId(messageId: string) {
  return prisma.notification.findFirst({
    where: { whatsappMessageId: messageId },
  });
}

export async function countUnreadForRecipient(
  recipientType: 'seller' | 'agent',
  recipientId: string,
): Promise<number> {
  return prisma.notification.count({
    where: {
      recipientType,
      recipientId,
      status: { not: 'read' },
      channel: 'in_app',
    },
  });
}

export async function findSellerNotificationPreference(sellerId: string): Promise<string | null> {
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    select: { notificationPreference: true },
  });
  return seller?.notificationPreference ?? null;
}

export async function findSellerMarketingConsent(sellerId: string): Promise<boolean> {
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    select: { consentMarketing: true },
  });
  return seller?.consentMarketing ?? false;
}

export async function withdrawMarketingConsent(sellerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.seller.update({
      where: { id: sellerId },
      data: { consentMarketing: false, consentWithdrawnAt: new Date() },
    });

    await tx.consentRecord.create({
      data: {
        id: createId(),
        subjectType: 'seller',
        subjectId: sellerId, // legacy column — kept for data continuity
        sellerId,
        purposeService: true,
        purposeMarketing: false,
        consentGivenAt: new Date(),
        consentWithdrawnAt: new Date(),
        ipAddress: 'unsubscribe-link',
        userAgent: 'email-unsubscribe',
      },
    });
  });
}
