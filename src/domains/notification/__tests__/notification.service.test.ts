import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import * as service from '../notification.service';

// Mock templates module — all statuses approved by default so WhatsApp tests work
jest.mock('../notification.templates', () => ({
  NOTIFICATION_TEMPLATES: {
    welcome_seller: {
      subject: 'Welcome to SellMyHomeNow',
      body: 'Welcome to SellMyHomeNow, {{name}}! Your account is ready.',
    },
    viewing_booked: {
      subject: 'Viewing Booked',
      body: 'A viewing has been booked for {{address}} on {{date}}.',
    },
    viewing_booked_seller: {
      subject: 'New Viewing Booked',
      body: 'New viewing booked for {{address}} on {{date}} at {{time}}. Viewer: {{viewerName}} ({{viewerType}}).{{noShowWarning}}',
    },
    viewing_cancelled: {
      subject: 'Viewing Cancelled',
      body: 'The viewing for {{address}} on {{date}} has been cancelled.',
    },
    viewing_reminder: {
      subject: 'Reminder',
      body: 'Reminder: Viewing for {{address}} is scheduled for {{date}}.',
    },
    viewing_reminder_viewer: {
      subject: 'Reminder',
      body: 'Reminder: Your viewing at {{address}} is at {{time}} today.',
    },
    viewing_feedback_prompt: {
      subject: 'Feedback',
      body: 'How did the viewing go for {{address}} on {{date}}?',
    },
    offer_received: {
      subject: 'Offer Received',
      body: 'An offer of ${{amount}} has been received for {{address}}.',
    },
    offer_countered: {
      subject: 'Counter-Offer',
      body: 'A counter-offer of ${{amount}} has been made for {{address}}.',
    },
    offer_accepted: {
      subject: 'Offer Accepted',
      body: 'The offer for {{address}} has been accepted. Congratulations!',
    },
    transaction_update: {
      subject: 'Transaction Update',
      body: 'Transaction update for {{address}}: {{status}}.',
    },
    document_ready: {
      subject: 'Document Ready',
      body: 'A document is ready for your review: {{documentName}}.',
    },
    invoice_uploaded: {
      subject: 'Invoice Uploaded',
      body: 'Your commission invoice has been uploaded for {{address}}.',
    },
    agreement_sent: {
      subject: 'Agreement Sent',
      body: 'The estate agency agreement for {{address}} has been sent to you.',
    },
    financial_report_ready: {
      subject: 'Report Ready',
      body: 'Your financial report for {{address}} is ready. {{message}}',
    },
    generic: { subject: 'Notification from SellMyHomeNow', body: '{{message}}' },
  },
  WHATSAPP_TEMPLATE_STATUS: {
    welcome_seller: 'approved',
    viewing_booked: 'approved',
    viewing_booked_seller: 'approved',
    viewing_cancelled: 'approved',
    viewing_reminder: 'approved',
    viewing_reminder_viewer: 'approved',
    viewing_feedback_prompt: 'approved',
    offer_received: 'approved',
    offer_countered: 'approved',
    offer_accepted: 'approved',
    transaction_update: 'approved',
    document_ready: 'approved',
    invoice_uploaded: 'approved',
    agreement_sent: 'approved',
    financial_report_ready: 'approved',
    generic: 'approved',
  },
}));

jest.mock('../notification.repository');
jest.mock('../providers/whatsapp.provider');
jest.mock('../providers/email.provider');

jest.mock('../../../infra/database/prisma', () => ({
  prisma: {
    seller: { findUnique: jest.fn() },
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
      update: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
  },
  createId: jest.fn().mockReturnValue('test-id'),
}));

jest.mock('../../shared/audit.service');

const notificationRepo = jest.requireMock('../notification.repository');
const { WhatsAppProvider } = jest.requireMock('../providers/whatsapp.provider');
const { EmailProvider } = jest.requireMock('../providers/email.provider');
const auditService = jest.requireMock('../../shared/audit.service');
const { prisma } = jest.requireMock('../../../infra/database/prisma');

describe('NotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    notificationRepo.create = jest.fn().mockResolvedValue({ id: 'notif-1' });
    notificationRepo.updateStatus = jest.fn().mockResolvedValue({});
    notificationRepo.findByWhatsAppMessageId = jest.fn().mockResolvedValue(null);

    auditService.log = jest.fn().mockResolvedValue(undefined);

    // Default seller: whatsapp_and_email preference, no marketing consent
    prisma.seller.findUnique = jest.fn().mockResolvedValue({
      id: 'seller-1',
      notificationPreference: 'whatsapp_and_email',
      consentService: true,
      consentMarketing: false,
    });
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

  describe('notification preference', () => {
    const input = {
      recipientType: 'seller' as const,
      recipientId: 'seller-1',
      templateName: 'welcome_seller' as const,
      templateData: { name: 'David' },
    };

    it('uses email when seller preference is email_only', async () => {
      prisma.seller.findUnique = jest.fn().mockResolvedValue({
        id: 'seller-1',
        notificationPreference: 'email_only',
        consentService: true,
        consentMarketing: false,
      });
      EmailProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: '<msg>' });
      WhatsAppProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: 'wamid.1' });

      await service.send(input, 'agent-1');

      expect(WhatsAppProvider.prototype.send).not.toHaveBeenCalled();
      expect(EmailProvider.prototype.send).toHaveBeenCalled();
    });

    it('uses whatsapp when seller preference is whatsapp_and_email', async () => {
      prisma.seller.findUnique = jest.fn().mockResolvedValue({
        id: 'seller-1',
        notificationPreference: 'whatsapp_and_email',
        consentService: true,
        consentMarketing: false,
      });
      WhatsAppProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: 'wamid.1' });

      await service.send(input, 'agent-1');

      expect(WhatsAppProvider.prototype.send).toHaveBeenCalled();
    });

    it('uses whatsapp for non-seller recipients regardless of preference lookup', async () => {
      WhatsAppProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: 'wamid.1' });

      await service.send(
        { ...input, recipientType: 'agent' as const, recipientId: 'agent-1' },
        'agent-1',
      );

      // prisma.seller.findUnique should NOT have been called for non-seller
      expect(prisma.seller.findUnique).not.toHaveBeenCalled();
      expect(WhatsAppProvider.prototype.send).toHaveBeenCalled();
    });
  });

  describe('marketing consent', () => {
    const input = {
      recipientType: 'seller' as const,
      recipientId: 'seller-1',
      templateName: 'welcome_seller' as const,
      templateData: { name: 'David' },
    };

    it('blocks marketing notification without consent', async () => {
      prisma.seller.findUnique = jest.fn().mockResolvedValue({
        id: 'seller-1',
        notificationPreference: 'whatsapp_and_email',
        consentService: true,
        consentMarketing: false,
      });

      await service.send({ ...input, notificationType: 'marketing' }, 'agent-1');

      expect(WhatsAppProvider.prototype.send).not.toHaveBeenCalled();
      expect(EmailProvider.prototype.send).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notification.marketing_blocked' }),
      );
    });

    it('still creates in-app notification even when marketing is blocked', async () => {
      prisma.seller.findUnique = jest.fn().mockResolvedValue({
        id: 'seller-1',
        notificationPreference: 'whatsapp_and_email',
        consentService: true,
        consentMarketing: false,
      });

      await service.send({ ...input, notificationType: 'marketing' }, 'agent-1');

      expect(notificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'in_app' }),
      );
      expect(notificationRepo.create).toHaveBeenCalledTimes(1); // only in-app, no external
    });

    it('allows marketing notification with consent', async () => {
      prisma.seller.findUnique = jest.fn().mockResolvedValue({
        id: 'seller-1',
        notificationPreference: 'whatsapp_and_email',
        consentService: true,
        consentMarketing: true,
      });
      WhatsAppProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: 'wamid.1' });

      await service.send({ ...input, notificationType: 'marketing' }, 'agent-1');

      expect(auditService.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notification.marketing_blocked' }),
      );
      expect(notificationRepo.create).toHaveBeenCalledTimes(2); // in-app + external
    });

    it('sends transactional notifications without checking marketing consent', async () => {
      WhatsAppProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: 'wamid.1' });

      // Default mock has consentMarketing: false but should still send transactional
      await service.send({ ...input, notificationType: 'transactional' }, 'agent-1');

      expect(notificationRepo.create).toHaveBeenCalledTimes(2);
      expect(WhatsAppProvider.prototype.send).toHaveBeenCalled();
    });
  });

  describe('Amendment F: WhatsApp template approval status', () => {
    const { WHATSAPP_TEMPLATE_STATUS } = jest.requireMock('../notification.templates');

    const input = {
      recipientType: 'seller' as const,
      recipientId: 'seller-1',
      templateName: 'welcome_seller' as const,
      templateData: { name: 'David' },
    };

    it('falls back to email when template status is pending', async () => {
      // Override template status to pending for this test
      WHATSAPP_TEMPLATE_STATUS.welcome_seller = 'pending';
      EmailProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: '<msg>' });
      WhatsAppProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: 'wamid.1' });

      await service.send(input, 'agent-1');

      expect(WhatsAppProvider.prototype.send).not.toHaveBeenCalled();
      expect(EmailProvider.prototype.send).toHaveBeenCalled();

      // Restore for subsequent tests
      WHATSAPP_TEMPLATE_STATUS.welcome_seller = 'approved';
    });

    it('sends via WhatsApp when template status is approved', async () => {
      WHATSAPP_TEMPLATE_STATUS.welcome_seller = 'approved';
      WhatsAppProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: 'wamid.1' });

      await service.send(input, 'agent-1');

      expect(WhatsAppProvider.prototype.send).toHaveBeenCalled();
      expect(EmailProvider.prototype.send).not.toHaveBeenCalled();
    });

    it('sends via email directly (no Amendment F check) when preferredChannel=email', async () => {
      EmailProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: '<msg>' });
      WhatsAppProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: 'wamid.1' });

      await service.send({ ...input, preferredChannel: 'email' }, 'agent-1');

      expect(EmailProvider.prototype.send).toHaveBeenCalled();
      expect(WhatsAppProvider.prototype.send).not.toHaveBeenCalled();
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

    it('returns true for valid signature', () => {
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-secret';
      const body = Buffer.from('{"test": "data"}');
      const expected = crypto.createHmac('sha256', 'test-secret').update(body).digest('hex');
      const result = service.verifyWebhookSignature(body, `sha256=${expected}`);
      expect(result).toBe(true);
    });

    it('returns false for invalid signature', () => {
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-secret';
      const body = Buffer.from('{"test": "data"}');
      const result = service.verifyWebhookSignature(body, 'sha256=invalid');
      expect(result).toBe(false);
    });
  });

  describe('audit logging', () => {
    const input = {
      recipientType: 'seller' as const,
      recipientId: 'seller-1',
      templateName: 'welcome_seller' as const,
      templateData: { name: 'David' },
    };

    it('logs notification.sent on successful send', async () => {
      WhatsAppProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: 'wamid.1' });

      await service.send(input, 'agent-1');

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notification.sent' }),
      );
    });

    it('logs notification.failed on send failure', async () => {
      prisma.seller.findUnique = jest.fn().mockResolvedValue({
        id: 'seller-1',
        notificationPreference: 'email_only',
        consentService: true,
        consentMarketing: false,
      });
      EmailProvider.prototype.send = jest.fn().mockRejectedValue(new Error('Email send failed'));

      await service.send(input, 'agent-1');

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notification.failed' }),
      );
    });

    it('logs notification.fallback when WhatsApp fails and email succeeds', async () => {
      WhatsAppProvider.prototype.send = jest.fn().mockRejectedValue(new Error('WA failed'));
      EmailProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: '<fallback>' });

      await service.send(input, 'agent-1');

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notification.fallback' }),
      );
    });
  });

  describe('DNC registry check', () => {
    const input = {
      recipientType: 'seller' as const,
      recipientId: 'seller-1',
      templateName: 'welcome_seller' as const,
      templateData: { name: 'David' },
      recipientPhone: '+6591234567',
    };

    it('falls back to email when DNC check blocks WhatsApp', async () => {
      jest
        .spyOn(service, 'checkDnc')
        .mockResolvedValue({ blocked: true, reason: 'On DNC registry' });
      EmailProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: '<email>' });
      WhatsAppProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: 'wamid.1' });

      await service.send(input, 'agent-1');

      expect(WhatsAppProvider.prototype.send).not.toHaveBeenCalled();
      expect(EmailProvider.prototype.send).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notification.dnc_blocked' }),
      );
    });
  });

  describe('total channel failure', () => {
    const input = {
      recipientType: 'seller' as const,
      recipientId: 'seller-1',
      templateName: 'welcome_seller' as const,
      templateData: { name: 'David' },
    };

    it('alerts agent when both WhatsApp and email fail', async () => {
      WhatsAppProvider.prototype.send = jest.fn().mockRejectedValue(new Error('WA failed'));
      EmailProvider.prototype.send = jest.fn().mockRejectedValue(new Error('Email also failed'));

      await service.send(input, 'agent-1');

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notification.all_channels_failed' }),
      );
      expect(notificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ recipientType: 'agent' }),
      );
    });
  });

  describe('generateUnsubscribeToken', () => {
    it('generates a valid JWT with sellerId and purpose', () => {
      process.env.SESSION_SECRET = 'test-secret';
      const token = service.generateUnsubscribeToken('seller-1');
      const decoded = jwt.verify(token, 'test-secret') as { sellerId: string; purpose: string };
      expect(decoded.sellerId).toBe('seller-1');
      expect(decoded.purpose).toBe('marketing_consent_withdrawal');
    });
  });

  describe('handleUnsubscribe', () => {
    it('withdraws marketing consent and creates consent record', async () => {
      const mockPrisma = jest.requireMock('../../../infra/database/prisma');
      mockPrisma.prisma.seller = {
        ...mockPrisma.prisma.seller,
        update: jest.fn().mockResolvedValue({}),
      };
      mockPrisma.prisma.consentRecord = { create: jest.fn().mockResolvedValue({}) };
      mockPrisma.prisma.$transaction = jest
        .fn()
        .mockImplementation(async (fn: (tx: typeof mockPrisma.prisma) => Promise<void>) =>
          fn(mockPrisma.prisma),
        );

      await service.handleUnsubscribe('seller-1');

      expect(mockPrisma.prisma.$transaction).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'consent.marketing_withdrawn' }),
      );
    });
  });
});
