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

export async function findAgentNotificationPreference(agentId: string): Promise<string | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { notificationPreference: true },
  });
  return agent?.notificationPreference ?? null;
}

export async function findMany(filter: {
  channel?: string;
  status?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}) {
  const page = filter.page ?? 1;
  const limit = filter.limit ?? 50;
  const where: Record<string, unknown> = {};

  if (filter.channel) where['channel'] = filter.channel;
  if (filter.status) where['status'] = filter.status;
  if (filter.dateFrom || filter.dateTo) {
    where['createdAt'] = {
      ...(filter.dateFrom ? { gte: filter.dateFrom } : {}),
      ...(filter.dateTo ? { lte: filter.dateTo } : {}),
    };
  }

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count({ where }),
  ]);

  return { notifications, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function findSellerMarketingConsent(sellerId: string): Promise<boolean> {
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    select: { consentMarketing: true },
  });
  return seller?.consentMarketing ?? false;
}

export async function findRecipientContact(
  recipientType: 'seller' | 'agent' | 'viewer',
  recipientId: string,
): Promise<{ email: string | null; phone: string | null }> {
  if (recipientType === 'seller') {
    const seller = await prisma.seller.findUnique({
      where: { id: recipientId },
      select: { email: true, phone: true },
    });
    return { email: seller?.email ?? null, phone: seller?.phone ?? null };
  }

  if (recipientType === 'agent') {
    const agent = await prisma.agent.findUnique({
      where: { id: recipientId },
      select: { email: true, phone: true },
    });
    return { email: agent?.email ?? null, phone: agent?.phone ?? null };
  }

  if (recipientType === 'viewer') {
    const viewer = await prisma.verifiedViewer.findUnique({
      where: { id: recipientId },
      select: { phone: true },
    });
    return { email: null, phone: viewer?.phone ?? null };
  }

  return { email: null, phone: null };
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
