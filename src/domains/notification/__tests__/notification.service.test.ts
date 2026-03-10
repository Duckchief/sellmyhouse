import * as service from '../notification.service';

jest.mock('../notification.repository');
jest.mock('../providers/whatsapp.provider');
jest.mock('../providers/email.provider');

const notificationRepo = jest.requireMock('../notification.repository');
const { WhatsAppProvider } = jest.requireMock('../providers/whatsapp.provider');
const { EmailProvider } = jest.requireMock('../providers/email.provider');

describe('NotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    notificationRepo.create = jest.fn().mockResolvedValue({ id: 'notif-1' });
    notificationRepo.updateStatus = jest.fn().mockResolvedValue({});
    notificationRepo.findByWhatsAppMessageId = jest.fn().mockResolvedValue(null);
  });

  describe('send', () => {
    const input = {
      recipientType: 'seller' as const,
      recipientId: 'seller-1',
      templateName: 'welcome_seller' as const,
      templateData: { name: 'David' },
    };

    it('always creates in-app notification', async () => {
      WhatsAppProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: 'wamid.1' });

      await service.send(input, 'agent-1');

      // First call is in-app, second is the external channel
      expect(notificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'in_app',
          content: 'Welcome to SellMyHomeNow, David! Your account is ready.',
        }),
      );
    });

    it('sends via WhatsApp by default', async () => {
      WhatsAppProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: 'wamid.1' });

      await service.send(input, 'agent-1');

      expect(notificationRepo.create).toHaveBeenCalledTimes(2); // in-app + whatsapp
      expect(WhatsAppProvider.prototype.send).toHaveBeenCalled();
    });

    it('respects preferredChannel=email', async () => {
      EmailProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: '<msg1>' });

      await service.send({ ...input, preferredChannel: 'email' }, 'agent-1');

      expect(EmailProvider.prototype.send).toHaveBeenCalled();
    });

    it('falls back to email when WhatsApp fails', async () => {
      WhatsAppProvider.prototype.send = jest.fn().mockRejectedValue(new Error('WA failed'));
      EmailProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: '<fallback>' });

      await service.send(input, 'agent-1');

      // 3 creates: in-app, whatsapp (failed), email (fallback)
      expect(notificationRepo.create).toHaveBeenCalledTimes(3);
      expect(EmailProvider.prototype.send).toHaveBeenCalled();
    });
  });

  describe('handleWhatsAppWebhook', () => {
    it('updates status on delivery receipt', async () => {
      notificationRepo.findByWhatsAppMessageId = jest.fn().mockResolvedValue({ id: 'notif-1' });

      await service.handleWhatsAppWebhook({
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [{ id: 'wamid.1', status: 'delivered', timestamp: '1700000000' }],
                },
              },
            ],
          },
        ],
      });

      expect(notificationRepo.updateStatus).toHaveBeenCalledWith(
        'notif-1',
        'delivered',
        expect.objectContaining({ deliveredAt: expect.any(Date) }),
      );
    });

    it('ignores unknown message IDs', async () => {
      notificationRepo.findByWhatsAppMessageId = jest.fn().mockResolvedValue(null);

      await service.handleWhatsAppWebhook({
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [{ id: 'unknown', status: 'delivered', timestamp: '1700000000' }],
                },
              },
            ],
          },
        ],
      });

      expect(notificationRepo.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('verifyWebhookSignature', () => {
    it('returns false without secret', () => {
      delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
      const result = service.verifyWebhookSignature(Buffer.from('test'), 'sha256=abc');
      expect(result).toBe(false);
    });
  });
});
