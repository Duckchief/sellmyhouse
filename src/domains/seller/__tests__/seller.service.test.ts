import * as sellerService from '../seller.service';
import * as sellerRepo from '../seller.repository';
import * as contentService from '../../content/content.service';
import * as notificationService from '../../notification/notification.service';
import * as auditService from '../../shared/audit.service';
import * as settingsService from '../../shared/settings.service';
import * as viewingService from '../../viewing/viewing.service';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { TOTAL_ONBOARDING_STEPS } from '../seller.types';
import type { Seller } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

type SellerWithRelations = Awaited<ReturnType<typeof sellerRepo.getSellerWithRelations>>;

jest.mock('../seller.repository');
jest.mock('../../content/content.service');
jest.mock('../../notification/notification.service');
jest.mock('../../shared/audit.service');
jest.mock('../../shared/settings.service');
jest.mock('../../viewing/viewing.service');

const mockedSellerRepo = jest.mocked(sellerRepo);
const mockedNotificationService = jest.mocked(notificationService);
const mockedAuditService = jest.mocked(auditService);
const mockedSettings = jest.mocked(settingsService);
const mockedViewingService = viewingService as jest.Mocked<typeof viewingService>;

describe('seller.service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getOnboardingStatus', () => {
    it('returns not started when step is 0', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 0,
      } as Seller);

      const result = await sellerService.getOnboardingStatus('seller-1');

      expect(result).toEqual({
        currentStep: 0,
        isComplete: false,
        completedSteps: [],
      });
    });

    it('returns complete when step equals total', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: TOTAL_ONBOARDING_STEPS,
      } as Seller);

      const result = await sellerService.getOnboardingStatus('seller-1');

      expect(result.isComplete).toBe(true);
      expect(result.completedSteps).toEqual([1, 2, 3, 4, 5]);
    });

    it('throws NotFoundError for nonexistent seller', async () => {
      mockedSellerRepo.findById.mockResolvedValue(null);

      await expect(sellerService.getOnboardingStatus('bad-id')).rejects.toThrow(NotFoundError);
    });
  });

  describe('completeOnboardingStep', () => {
    it('advances to the next step', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 1,
      } as Seller);
      mockedSellerRepo.updateOnboardingStep.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 2,
      } as Seller);

      const result = await sellerService.completeOnboardingStep({
        sellerId: 'seller-1',
        step: 2,
      });

      expect(mockedSellerRepo.updateOnboardingStep).toHaveBeenCalledWith('seller-1', 2);
      expect(result.onboardingStep).toBe(2);
    });

    it('rejects step below 1', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 0,
      } as Seller);

      await expect(
        sellerService.completeOnboardingStep({
          sellerId: 'seller-1',
          step: 0,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects step beyond total', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 3,
      } as Seller);

      await expect(
        sellerService.completeOnboardingStep({
          sellerId: 'seller-1',
          step: TOTAL_ONBOARDING_STEPS + 1,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects skipping steps', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 1,
      } as Seller);

      await expect(
        sellerService.completeOnboardingStep({
          sellerId: 'seller-1',
          step: 3,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects going backward', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 3,
      } as Seller);

      await expect(
        sellerService.completeOnboardingStep({
          sellerId: 'seller-1',
          step: 2,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects completing step when already fully onboarded', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: TOTAL_ONBOARDING_STEPS,
      } as Seller);

      await expect(
        sellerService.completeOnboardingStep({
          sellerId: 'seller-1',
          step: TOTAL_ONBOARDING_STEPS + 1,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('logs audit entry on step completion', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 0,
      } as Seller);
      mockedSellerRepo.updateOnboardingStep.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 1,
      } as Seller);

      await sellerService.completeOnboardingStep({
        sellerId: 'seller-1',
        step: 1,
      });

      expect(mockedAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'seller.onboarding_step_completed',
          entityType: 'seller',
          entityId: 'seller-1',
          details: { step: 1 },
        }),
      );
    });
  });

  describe('getDashboardOverview', () => {
    it('returns overview with onboarding status and next steps', async () => {
      mockedSellerRepo.getSellerWithRelations.mockResolvedValue({
        id: 'seller-1',
        name: 'Test Seller',
        email: 'test@test.local',
        phone: '91234567',
        status: 'engaged',
        onboardingStep: 3,
        properties: [],
        transactions: [],
        consentRecords: [],
        caseFlags: [],
        createdAt: new Date(),
      } as unknown as SellerWithRelations);
      mockedNotificationService.countUnreadNotifications.mockResolvedValue(5);

      const result = await sellerService.getDashboardOverview('seller-1');

      expect(result.seller.name).toBe('Test Seller');
      expect(result.onboarding.currentStep).toBe(3);
      expect(result.onboarding.isComplete).toBe(false);
      expect(result.unreadNotificationCount).toBe(5);
      expect(result.nextSteps.length).toBeGreaterThan(0);
    });

    it('throws NotFoundError for nonexistent seller', async () => {
      mockedSellerRepo.getSellerWithRelations.mockResolvedValue(null);

      await expect(sellerService.getDashboardOverview('bad-id')).rejects.toThrow(NotFoundError);
    });

    it('sets showMarketingPrompt true when seller is 14+ days old and consentMarketing is false', async () => {
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

      mockedSellerRepo.getSellerWithRelations.mockResolvedValue({
        id: 'seller-1',
        name: 'Test Seller',
        email: 'test@test.local',
        phone: '91234567',
        status: 'engaged',
        onboardingStep: 3,
        properties: [],
        transactions: [],
        consentRecords: [],
        caseFlags: [],
        createdAt: fourteenDaysAgo,
        consentMarketing: false,
      } as any);
      mockedNotificationService.countUnreadNotifications.mockResolvedValue(0);

      const result = await sellerService.getDashboardOverview('seller-1');
      expect(result.showMarketingPrompt).toBe(true);
    });

    it('sets showMarketingPrompt false when seller is less than 14 days old', async () => {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      mockedSellerRepo.getSellerWithRelations.mockResolvedValue({
        id: 'seller-1',
        name: 'Test Seller',
        email: 'test@test.local',
        phone: '91234567',
        status: 'engaged',
        onboardingStep: 3,
        properties: [],
        transactions: [],
        consentRecords: [],
        caseFlags: [],
        createdAt: twoDaysAgo,
        consentMarketing: false,
      } as any);
      mockedNotificationService.countUnreadNotifications.mockResolvedValue(0);

      const result = await sellerService.getDashboardOverview('seller-1');
      expect(result.showMarketingPrompt).toBe(false);
    });

    it('sets showMarketingPrompt false when consentMarketing is already true', async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      mockedSellerRepo.getSellerWithRelations.mockResolvedValue({
        id: 'seller-1',
        name: 'Test Seller',
        email: 'test@test.local',
        phone: '91234567',
        status: 'engaged',
        onboardingStep: 3,
        properties: [],
        transactions: [],
        consentRecords: [],
        caseFlags: [],
        createdAt: thirtyDaysAgo,
        consentMarketing: true,
      } as any);
      mockedNotificationService.countUnreadNotifications.mockResolvedValue(0);

      const result = await sellerService.getDashboardOverview('seller-1');
      expect(result.showMarketingPrompt).toBe(false);
    });

    it('sets showMarketingPrompt false when seller is exactly 13 days old', async () => {
      const thirteenDaysAgo = new Date();
      thirteenDaysAgo.setDate(thirteenDaysAgo.getDate() - 13);

      mockedSellerRepo.getSellerWithRelations.mockResolvedValue({
        id: 'seller-1',
        name: 'Test Seller',
        email: 'test@test.local',
        phone: '91234567',
        status: 'engaged',
        onboardingStep: 3,
        properties: [],
        transactions: [],
        consentRecords: [],
        caseFlags: [],
        createdAt: thirteenDaysAgo,
        consentMarketing: false,
      } as any);
      mockedNotificationService.countUnreadNotifications.mockResolvedValue(0);

      const result = await sellerService.getDashboardOverview('seller-1');
      expect(result.showMarketingPrompt).toBe(false);
    });
  });

  describe('getDashboardOverview - enhanced', () => {
    it('returns property details when seller has a property', async () => {
      mockedSellerRepo.getSellerWithRelations.mockResolvedValue({
        id: 'seller-1',
        name: 'Test Seller',
        email: 'test@test.local',
        phone: '91234567',
        status: 'active',
        onboardingStep: 5,
        properties: [
          {
            id: 'prop-1',
            block: '123',
            street: 'Ang Mo Kio Ave 3',
            town: 'Ang Mo Kio',
            flatType: '4-room',
            floorAreaSqm: new Decimal('95.5'),
            askingPrice: new Decimal('550000'),
            status: 'listed',
          },
        ],
        transactions: [],
        consentRecords: [],
        caseFlags: [
          { id: 'flag-1', flagType: 'missing_document', description: 'NRIC not uploaded' },
          { id: 'flag-2', flagType: 'compliance_check', description: 'CDD pending' },
        ],
        createdAt: new Date(),
      } as unknown as SellerWithRelations);

      mockedNotificationService.countUnreadNotifications.mockResolvedValue(3);
      mockedViewingService.getViewingStats.mockResolvedValue({
        totalViewings: 10,
        upcomingCount: 2,
        noShowCount: 1,
        averageInterestRating: 3.5,
      });

      const result = await sellerService.getDashboardOverview('seller-1');

      expect(result.property).not.toBeNull();
      expect(result.property?.block).toBe('123');
      expect(result.property?.street).toBe('Ang Mo Kio Ave 3');
      expect(result.property?.town).toBe('Ang Mo Kio');
      expect(result.property?.flatType).toBe('4-room');
      expect(result.property?.floorAreaSqm).toBe(95.5);
      expect(result.property?.askingPrice).toBe(550000);

      expect(result.caseFlags).toHaveLength(2);
      expect(result.caseFlags[0]).toEqual({
        id: 'flag-1',
        flagType: 'missing_document',
        description: 'NRIC not uploaded',
      });
      expect(result.caseFlags[1]).toEqual({
        id: 'flag-2',
        flagType: 'compliance_check',
        description: 'CDD pending',
      });

      expect(result.upcomingViewings).toBe(2);
      expect(result.totalViewings).toBe(10);
      expect(result.unreadNotificationCount).toBe(3);
    });

    it('returns null property when seller has no properties', async () => {
      mockedSellerRepo.getSellerWithRelations.mockResolvedValue({
        id: 'seller-1',
        name: 'Test Seller',
        email: 'test@test.local',
        phone: '91234567',
        status: 'engaged',
        onboardingStep: 5,
        properties: [],
        transactions: [],
        consentRecords: [],
        caseFlags: [],
        createdAt: new Date(),
      } as unknown as SellerWithRelations);

      mockedNotificationService.countUnreadNotifications.mockResolvedValue(0);

      const result = await sellerService.getDashboardOverview('seller-1');

      expect(result.property).toBeNull();
      expect(result.caseFlags).toHaveLength(0);
      expect(result.upcomingViewings).toBe(0);
      expect(result.totalViewings).toBe(0);
    });
  });

  describe('getMyData', () => {
    it('returns personal info and consent status', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        name: 'Test Seller',
        email: 'test@test.local',
        phone: '91234567',
        consentService: true,
        consentMarketing: false,
        consentTimestamp: new Date('2026-01-01'),
        consentWithdrawnAt: null,
        status: 'active',
      } as Seller);
      mockedSellerRepo.getConsentHistory.mockResolvedValue([]);

      const result = await sellerService.getMyData('seller-1');

      expect(result.personalInfo.name).toBe('Test Seller');
      expect(result.consentStatus.service).toBe(true);
      expect(result.consentStatus.marketing).toBe(false);
      expect(result.dataActions.canRequestCorrection).toBe(true);
      expect(result.dataActions.canRequestDeletion).toBe(false); // active status
      expect(result.dataActions.canWithdrawConsent).toBe(true);
    });
  });

  describe('getTutorialsGrouped', () => {
    it('delegates to contentService', async () => {
      const grouped = { photography: [], process: [] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.mocked(contentService).getTutorialsGrouped.mockResolvedValue(grouped as any);

      const result = await sellerService.getTutorialsGrouped();

      expect(result).toBe(grouped);
      expect(jest.mocked(contentService).getTutorialsGrouped).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSellerSettings', () => {
    it('returns notificationPreference for the seller', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        notificationPreference: 'email_only',
      } as Seller);

      const result = await sellerService.getSellerSettings('seller-1');

      expect(result).toEqual({ notificationPreference: 'email_only' });
    });

    it('throws NotFoundError when seller does not exist', async () => {
      mockedSellerRepo.findById.mockResolvedValue(null);
      await expect(sellerService.getSellerSettings('bad-id')).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateSellerStatus', () => {
    it('transitions lead to engaged and sets consultationCompletedAt', async () => {
      mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1', status: 'lead' } as Seller);
      mockedSellerRepo.updateSellerStatus = jest.fn().mockResolvedValue({
        id: 'seller-1',
        status: 'engaged',
        consultationCompletedAt: new Date(),
      } as Seller);

      const result = await sellerService.updateSellerStatus(
        'seller-1',
        'engaged',
        'agent-1',
        'Consultation completed',
      );

      expect(mockedSellerRepo.updateSellerStatus).toHaveBeenCalledWith(
        'seller-1',
        expect.objectContaining({ status: 'engaged', consultationCompletedAt: expect.any(Date) }),
      );
      expect(result.status).toBe('engaged');
    });

    it('does not set consultationCompletedAt for non-engaged transitions', async () => {
      mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1', status: 'engaged' } as Seller);
      mockedSellerRepo.updateSellerStatus = jest.fn().mockResolvedValue({
        id: 'seller-1',
        status: 'active',
      } as Seller);

      await sellerService.updateSellerStatus('seller-1', 'active', 'agent-1', 'Activating seller');

      const callArg = (mockedSellerRepo.updateSellerStatus as jest.Mock).mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(callArg).not.toHaveProperty('consultationCompletedAt');
    });

    it('throws ValidationError for invalid status transition', async () => {
      mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1', status: 'lead' } as Seller);

      await expect(
        sellerService.updateSellerStatus('seller-1', 'completed', 'agent-1'),
      ).rejects.toThrow(ValidationError);
    });

    it('throws NotFoundError when seller does not exist', async () => {
      mockedSellerRepo.findById.mockResolvedValue(null);

      await expect(
        sellerService.updateSellerStatus('bad-id', 'engaged', 'agent-1'),
      ).rejects.toThrow(NotFoundError);
    });

    it('writes audit log on status change', async () => {
      mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1', status: 'lead' } as Seller);
      mockedSellerRepo.updateSellerStatus = jest.fn().mockResolvedValue({
        id: 'seller-1',
        status: 'engaged',
      } as Seller);

      await sellerService.updateSellerStatus('seller-1', 'engaged', 'agent-1', 'Consultation done');

      expect(mockedAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          action: 'seller.status_changed',
          entityType: 'seller',
          entityId: 'seller-1',
          details: expect.objectContaining({ previousStatus: 'lead', newStatus: 'engaged' }),
        }),
      );
    });

    it('throws ValidationError when note is missing for lead→engaged transition', async () => {
      mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1', status: 'lead' } as Seller);

      await expect(
        sellerService.updateSellerStatus('seller-1', 'engaged', 'agent-1', undefined),
      ).rejects.toThrow(ValidationError);
    });

    it('allows engaged→active transition without a note (EAA activation handles this path)', async () => {
      mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1', status: 'engaged' } as Seller);
      mockedSellerRepo.updateSellerStatus.mockResolvedValue({
        id: 'seller-1',
        status: 'active',
      } as Seller);

      await expect(
        sellerService.updateSellerStatus('seller-1', 'active', 'agent-1', undefined),
      ).resolves.toBeDefined();
    });

    it('throws ValidationError when note is missing for archive transition', async () => {
      mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1', status: 'lead' } as Seller);

      await expect(
        sellerService.updateSellerStatus('seller-1', 'archived', 'agent-1', undefined),
      ).rejects.toThrow(ValidationError);
    });

    it('does NOT require note for active→completed transition', async () => {
      mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1', status: 'active' } as Seller);
      mockedSellerRepo.updateSellerStatus = jest.fn().mockResolvedValue({
        id: 'seller-1',
        status: 'completed',
      } as Seller);

      await expect(
        sellerService.updateSellerStatus('seller-1', 'completed', 'agent-1', undefined),
      ).resolves.not.toThrow();
    });

    it('includes note in audit log details when provided', async () => {
      mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1', status: 'lead' } as Seller);
      mockedSellerRepo.updateSellerStatus = jest.fn().mockResolvedValue({
        id: 'seller-1',
        status: 'engaged',
        consultationCompletedAt: new Date(),
      } as Seller);

      await sellerService.updateSellerStatus(
        'seller-1',
        'engaged',
        'agent-1',
        'Seller is motivated',
      );

      expect(mockedAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ note: 'Seller is motivated' }),
        }),
      );
    });

    it('omits note from audit log when not provided', async () => {
      mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1', status: 'active' } as Seller);
      mockedSellerRepo.updateSellerStatus = jest.fn().mockResolvedValue({
        id: 'seller-1',
        status: 'completed',
      } as Seller);

      await sellerService.updateSellerStatus('seller-1', 'completed', 'agent-1', undefined);

      expect(mockedAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.not.objectContaining({ note: expect.anything() }),
        }),
      );
    });
  });

  describe('updateNotificationPreference', () => {
    it('updates preference and writes audit log, returns updated seller', async () => {
      const updatedSeller = {
        id: 'seller-1',
        notificationPreference: 'email_only' as const,
      } as Seller;
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        notificationPreference: 'whatsapp_and_email',
      } as Seller);
      mockedSellerRepo.updateNotificationPreference = jest.fn().mockResolvedValue(updatedSeller);

      const result = await sellerService.updateNotificationPreference({
        sellerId: 'seller-1',
        preference: 'email_only',
      });

      expect(mockedSellerRepo.updateNotificationPreference).toHaveBeenCalledWith(
        'seller-1',
        'email_only',
      );
      expect(mockedAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'seller.notification_preference_changed',
          entityId: 'seller-1',
          details: { newPreference: 'email_only', actorType: 'seller' },
        }),
      );
      expect(result).toEqual({ notificationPreference: 'email_only' });
    });

    it('records actorType: agent when agentId is provided', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        notificationPreference: 'whatsapp_and_email',
      } as Seller);
      mockedSellerRepo.updateNotificationPreference = jest.fn().mockResolvedValue({
        id: 'seller-1',
        notificationPreference: 'email_only',
      } as Seller);

      await sellerService.updateNotificationPreference({
        sellerId: 'seller-1',
        preference: 'email_only',
        agentId: 'agent-1',
      });

      expect(mockedAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          details: expect.objectContaining({ actorType: 'agent' }),
        }),
      );
    });

    it('throws NotFoundError when seller does not exist', async () => {
      mockedSellerRepo.findById.mockResolvedValue(null);
      await expect(
        sellerService.updateNotificationPreference({
          sellerId: 'bad-id',
          preference: 'email_only',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('checkInactiveSellers', () => {
    it('sends agent notification for inactive seller', async () => {
      mockedSellerRepo.findInactiveSellers.mockResolvedValue([
        {
          id: 'seller-1',
          name: 'Jane',
          email: 'jane@test.com',
          agentId: 'agent-1',
          updatedAt: new Date(Date.now() - 20 * 86400000),
          status: 'active',
        },
      ]);
      mockedSettings.getNumber.mockResolvedValue(14);

      const result = await sellerService.checkInactiveSellers();

      expect(result.checked).toBe(1);
      expect(mockedNotificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientType: 'agent',
          recipientId: 'agent-1',
          templateName: 'generic',
        }),
        'system',
      );
      expect(mockedAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'seller.inactive_alert',
          entityType: 'seller',
          entityId: 'seller-1',
        }),
      );
    });

    it('skips sellers without assigned agent', async () => {
      mockedSellerRepo.findInactiveSellers.mockResolvedValue([
        {
          id: 'seller-2',
          name: 'Bob',
          email: 'bob@test.com',
          agentId: null,
          updatedAt: new Date(Date.now() - 20 * 86400000),
          status: 'engaged',
        },
      ]);
      mockedSettings.getNumber.mockResolvedValue(14);

      await sellerService.checkInactiveSellers();

      expect(mockedNotificationService.send).not.toHaveBeenCalled();
    });

    it('returns zero when no inactive sellers', async () => {
      mockedSellerRepo.findInactiveSellers.mockResolvedValue([]);
      mockedSettings.getNumber.mockResolvedValue(14);

      const result = await sellerService.checkInactiveSellers();
      expect(result.checked).toBe(0);
    });
  });
});
