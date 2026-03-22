import * as verificationService from '../verification.service';
import * as leadRepo from '../lead.repository';
import * as auditService from '../../shared/audit.service';
import * as notificationService from '../../notification/notification.service';
import { propertyRepository } from '../../property/property.repository';

jest.mock('../lead.repository');
jest.mock('../../shared/audit.service');
jest.mock('../../notification/notification.service');
jest.mock('../../property/property.repository');

const mockLeadRepo = leadRepo as jest.Mocked<typeof leadRepo>;
const mockAudit = auditService as jest.Mocked<typeof auditService>;
const mockNotification = notificationService as jest.Mocked<typeof notificationService>;
const mockPropertyRepo = propertyRepository as jest.Mocked<typeof propertyRepository>;

describe('verification.service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('verifyEmailToken', () => {
    it('returns seller when token is valid and not expired', async () => {
      const seller = {
        id: 'seller-1',
        emailVerificationExpiry: new Date(Date.now() + 3600000),
        emailVerified: false,
        agentId: null,
      };
      mockLeadRepo.findSellerByVerificationToken.mockResolvedValue(seller as never);
      mockLeadRepo.markEmailVerified.mockResolvedValue(undefined);
      mockAudit.log.mockResolvedValue(undefined);

      const result = await verificationService.verifyEmailToken('raw-token-hex');

      expect(result).toEqual({ sellerId: 'seller-1' });
      expect(mockLeadRepo.markEmailVerified).toHaveBeenCalledWith('seller-1');
    });

    it('throws ValidationError when token not found', async () => {
      mockLeadRepo.findSellerByVerificationToken.mockResolvedValue(null);

      await expect(verificationService.verifyEmailToken('bad-token')).rejects.toThrow(
        'Invalid or expired verification link',
      );
    });

    it('throws ValidationError when token is expired', async () => {
      const seller = {
        id: 'seller-1',
        emailVerificationExpiry: new Date(Date.now() - 1000),
        emailVerified: false,
        agentId: null,
      };
      mockLeadRepo.findSellerByVerificationToken.mockResolvedValue(seller as never);

      await expect(verificationService.verifyEmailToken('expired-token')).rejects.toThrow(
        'Invalid or expired verification link',
      );
    });
  });

  describe('submitLeadDetails', () => {
    it('creates property and updates seller selling intent', async () => {
      const seller = { id: 'seller-1', emailVerified: true, agentId: 'agent-1' };
      mockLeadRepo.findSellerById.mockResolvedValue(seller as never);
      mockPropertyRepo.create.mockResolvedValue({ id: 'prop-1' } as never);
      mockLeadRepo.updateSellingIntent.mockResolvedValue(undefined);
      mockAudit.log.mockResolvedValue(undefined);
      mockNotification.send.mockResolvedValue(undefined);

      await verificationService.submitLeadDetails({
        sellerId: 'seller-1',
        block: '123',
        street: 'Ang Mo Kio Ave 3',
        town: 'ANG MO KIO',
        sellingTimeline: 'one_to_three_months',
        sellingReason: 'upgrading',
      });

      expect(mockPropertyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sellerId: 'seller-1',
          block: '123',
          street: 'Ang Mo Kio Ave 3',
          town: 'ANG MO KIO',
        }),
      );
      expect(mockLeadRepo.updateSellingIntent).toHaveBeenCalledWith('seller-1', {
        sellingTimeline: 'one_to_three_months',
        sellingReason: 'upgrading',
        sellingReasonOther: undefined,
      });
    });

    it('throws ValidationError when email is not verified', async () => {
      mockLeadRepo.findSellerById.mockResolvedValue({
        id: 'seller-1',
        emailVerified: false,
        agentId: null,
      } as never);

      await expect(
        verificationService.submitLeadDetails({
          sellerId: 'seller-1',
          block: '123',
          street: 'Test St',
          town: 'BEDOK',
          sellingTimeline: 'just_thinking',
          sellingReason: 'other',
          sellingReasonOther: 'Testing',
        }),
      ).rejects.toThrow('Email must be verified');
    });

    it('notifies assigned agent when seller has one', async () => {
      const seller = { id: 'seller-1', emailVerified: true, agentId: 'agent-1' };
      mockLeadRepo.findSellerById.mockResolvedValue(seller as never);
      mockPropertyRepo.create.mockResolvedValue({ id: 'prop-1' } as never);
      mockLeadRepo.updateSellingIntent.mockResolvedValue(undefined);
      mockAudit.log.mockResolvedValue(undefined);
      mockNotification.send.mockResolvedValue(undefined);

      await verificationService.submitLeadDetails({
        sellerId: 'seller-1',
        block: '123',
        street: 'Ang Mo Kio Ave 3',
        town: 'ANG MO KIO',
        sellingTimeline: 'one_to_three_months',
        sellingReason: 'upgrading',
      });

      expect(mockNotification.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientType: 'agent',
          recipientId: 'agent-1',
        }),
        'system',
      );
    });
  });
});
