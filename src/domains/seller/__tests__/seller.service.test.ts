import * as sellerService from '../seller.service';
import * as sellerRepo from '../seller.repository';
import * as notificationRepo from '../../notification/notification.repository';
import * as auditService from '../../shared/audit.service';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { TOTAL_ONBOARDING_STEPS } from '../seller.types';

jest.mock('../seller.repository');
jest.mock('../../notification/notification.repository');
jest.mock('../../shared/audit.service');

const mockedSellerRepo = jest.mocked(sellerRepo);
const mockedNotificationRepo = jest.mocked(notificationRepo);
const mockedAuditService = jest.mocked(auditService);

describe('seller.service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getOnboardingStatus', () => {
    it('returns not started when step is 0', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 0,
      } as any);

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
      } as any);

      const result = await sellerService.getOnboardingStatus('seller-1');

      expect(result.isComplete).toBe(true);
      expect(result.completedSteps).toEqual([1, 2, 3, 4, 5]);
    });

    it('throws NotFoundError for nonexistent seller', async () => {
      mockedSellerRepo.findById.mockResolvedValue(null);

      await expect(sellerService.getOnboardingStatus('bad-id'))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('completeOnboardingStep', () => {
    it('advances to the next step', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 1,
      } as any);
      mockedSellerRepo.updateOnboardingStep.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 2,
      } as any);

      const result = await sellerService.completeOnboardingStep({
        sellerId: 'seller-1',
        step: 2,
      });

      expect(mockedSellerRepo.updateOnboardingStep)
        .toHaveBeenCalledWith('seller-1', 2);
      expect(result.onboardingStep).toBe(2);
    });

    it('rejects step below 1', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 0,
      } as any);

      await expect(sellerService.completeOnboardingStep({
        sellerId: 'seller-1',
        step: 0,
      })).rejects.toThrow(ValidationError);
    });

    it('rejects step beyond total', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 3,
      } as any);

      await expect(sellerService.completeOnboardingStep({
        sellerId: 'seller-1',
        step: TOTAL_ONBOARDING_STEPS + 1,
      })).rejects.toThrow(ValidationError);
    });

    it('rejects skipping steps', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 1,
      } as any);

      await expect(sellerService.completeOnboardingStep({
        sellerId: 'seller-1',
        step: 3,
      })).rejects.toThrow(ValidationError);
    });

    it('rejects going backward', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 3,
      } as any);

      await expect(sellerService.completeOnboardingStep({
        sellerId: 'seller-1',
        step: 2,
      })).rejects.toThrow(ValidationError);
    });

    it('rejects completing step when already fully onboarded', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: TOTAL_ONBOARDING_STEPS,
      } as any);

      await expect(sellerService.completeOnboardingStep({
        sellerId: 'seller-1',
        step: TOTAL_ONBOARDING_STEPS + 1,
      })).rejects.toThrow(ValidationError);
    });

    it('logs audit entry on step completion', async () => {
      mockedSellerRepo.findById.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 0,
      } as any);
      mockedSellerRepo.updateOnboardingStep.mockResolvedValue({
        id: 'seller-1',
        onboardingStep: 1,
      } as any);

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
      } as any);
      mockedNotificationRepo.countUnreadForRecipient.mockResolvedValue(5);

      const result = await sellerService.getDashboardOverview('seller-1');

      expect(result.seller.name).toBe('Test Seller');
      expect(result.onboarding.currentStep).toBe(3);
      expect(result.onboarding.isComplete).toBe(false);
      expect(result.unreadNotificationCount).toBe(5);
      expect(result.nextSteps.length).toBeGreaterThan(0);
    });

    it('throws NotFoundError for nonexistent seller', async () => {
      mockedSellerRepo.getSellerWithRelations.mockResolvedValue(null);

      await expect(sellerService.getDashboardOverview('bad-id'))
        .rejects.toThrow(NotFoundError);
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
      } as any);
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
    it('groups tutorials by category', async () => {
      mockedSellerRepo.findTutorialsGroupedByCategory.mockResolvedValue([
        { id: 't1', category: 'photography', title: 'Photo tips', orderIndex: 1 },
        { id: 't2', category: 'photography', title: 'Lighting', orderIndex: 2 },
        { id: 't3', category: 'process', title: 'Timeline', orderIndex: 1 },
      ] as any);

      const result = await sellerService.getTutorialsGrouped();

      expect(result['photography']).toHaveLength(2);
      expect(result['process']).toHaveLength(1);
    });
  });
});
