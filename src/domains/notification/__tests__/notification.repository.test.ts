import * as repo from '../notification.repository';

jest.mock('../../../infra/database/prisma', () => ({
  prisma: {
    notification: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
  },
  createId: jest.fn().mockReturnValue('test-notif-id'),
}));

const { prisma } = jest.requireMock('../../../infra/database/prisma');

describe('NotificationRepository', () => {
  beforeEach(() => jest.clearAllMocks());

  it('create passes correct data', async () => {
    prisma.notification.create.mockResolvedValue({ id: 'test-notif-id' });

    await repo.create({
      recipientType: 'seller',
      recipientId: 's1',
      channel: 'in_app',
      templateName: 'welcome_seller',
      content: 'Hello',
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'test-notif-id',
        recipientType: 'seller',
        recipientId: 's1',
        channel: 'in_app',
        templateName: 'welcome_seller',
        content: 'Hello',
        status: 'pending',
      }),
    });
  });

  it('updateStatus updates with extra fields', async () => {
    prisma.notification.update.mockResolvedValue({});

    const sentAt = new Date();
    await repo.updateStatus('n1', 'sent', { sentAt });

    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { status: 'sent', sentAt },
    });
  });

  it('findUnreadForRecipient queries correctly', async () => {
    prisma.notification.findMany.mockResolvedValue([]);

    await repo.findUnreadForRecipient('seller', 's1');

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: {
        recipientType: 'seller',
        recipientId: 's1',
        channel: 'in_app',
        status: { not: 'read' },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });

  it('markAsRead sets status and readAt', async () => {
    prisma.notification.update.mockResolvedValue({});

    await repo.markAsRead('n1');

    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: {
        status: 'read',
        readAt: expect.any(Date),
      },
    });
  });

  it('findByWhatsAppMessageId queries correctly', async () => {
    prisma.notification.findFirst.mockResolvedValue(null);

    await repo.findByWhatsAppMessageId('wamid.123');

    expect(prisma.notification.findFirst).toHaveBeenCalledWith({
      where: { whatsappMessageId: 'wamid.123' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('countUnreadForRecipient returns count of unread in-app notifications', async () => {
    prisma.notification.count.mockResolvedValue(3);

    const result = await repo.countUnreadForRecipient('seller', 's1');

    expect(result).toBe(3);
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: {
        recipientType: 'seller',
        recipientId: 's1',
        status: { not: 'read' },
        channel: 'in_app',
      },
    });
  });
});
