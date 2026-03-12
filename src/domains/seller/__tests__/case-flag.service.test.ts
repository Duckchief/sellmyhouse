import * as caseFlagService from '../case-flag.service';
import * as caseFlagRepo from '../case-flag.repository';
import * as sellerRepo from '../seller.repository';
import * as auditService from '../../shared/audit.service';
import { NotFoundError } from '../../shared/errors';

jest.mock('../case-flag.repository');
jest.mock('../seller.repository');
jest.mock('../../shared/audit.service');
jest.mock('@paralleldrive/cuid2', () => ({ createId: () => 'test-id' }));

const mockedCaseFlagRepo = jest.mocked(caseFlagRepo);
const mockedSellerRepo = jest.mocked(sellerRepo);
const mockedAuditService = jest.mocked(auditService);

describe('case-flag.service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createCaseFlag', () => {
    it('creates a flag and writes audit log', async () => {
      mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1' } as never);
      mockedCaseFlagRepo.create.mockResolvedValue({ id: 'test-id', flagType: 'other' } as never);

      const result = await caseFlagService.createCaseFlag({
        sellerId: 'seller-1',
        flagType: 'other',
        description: 'Test',
        agentId: 'agent-1',
      });

      expect(mockedCaseFlagRepo.create).toHaveBeenCalledWith({
        id: 'test-id',
        sellerId: 'seller-1',
        flagType: 'other',
        description: 'Test',
      });
      expect(mockedAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'case_flag.created', entityId: 'test-id' }),
      );
      expect(result).toMatchObject({ id: 'test-id' });
    });

    it('throws NotFoundError if seller does not exist', async () => {
      mockedSellerRepo.findById.mockResolvedValue(null);

      await expect(
        caseFlagService.createCaseFlag({
          sellerId: 'bad-id',
          flagType: 'other',
          description: 'x',
          agentId: 'a-1',
        }),
      ).rejects.toThrow(NotFoundError);

      expect(mockedCaseFlagRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('updateCaseFlag', () => {
    it('updates status and writes audit log', async () => {
      mockedCaseFlagRepo.findById.mockResolvedValue({ id: 'flag-1' } as never);
      mockedCaseFlagRepo.updateStatus.mockResolvedValue({ id: 'flag-1', status: 'resolved' } as never);

      await caseFlagService.updateCaseFlag({
        flagId: 'flag-1',
        status: 'resolved',
        agentId: 'agent-1',
      });

      expect(mockedCaseFlagRepo.updateStatus).toHaveBeenCalledWith('flag-1', 'resolved', undefined);
      expect(mockedAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'case_flag.updated', entityId: 'flag-1' }),
      );
    });

    it('passes guidanceProvided when supplied', async () => {
      mockedCaseFlagRepo.findById.mockResolvedValue({ id: 'flag-1' } as never);
      mockedCaseFlagRepo.updateStatus.mockResolvedValue({ id: 'flag-1' } as never);

      await caseFlagService.updateCaseFlag({
        flagId: 'flag-1',
        status: 'in_progress',
        guidanceProvided: 'Contact HDB',
        agentId: 'agent-1',
      });

      expect(mockedCaseFlagRepo.updateStatus).toHaveBeenCalledWith(
        'flag-1',
        'in_progress',
        'Contact HDB',
      );
    });

    it('throws NotFoundError if flag does not exist', async () => {
      mockedCaseFlagRepo.findById.mockResolvedValue(null);

      await expect(
        caseFlagService.updateCaseFlag({ flagId: 'bad-id', status: 'resolved', agentId: 'a-1' }),
      ).rejects.toThrow(NotFoundError);

      expect(mockedCaseFlagRepo.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('getCaseFlagsForSeller', () => {
    it('returns all flags for the seller', async () => {
      const flags = [{ id: 'flag-1' }, { id: 'flag-2' }];
      mockedCaseFlagRepo.findBySellerId.mockResolvedValue(flags as never);

      const result = await caseFlagService.getCaseFlagsForSeller('seller-1');

      expect(mockedCaseFlagRepo.findBySellerId).toHaveBeenCalledWith('seller-1');
      expect(result).toEqual(flags);
    });
  });

  describe('getChecklistForType', () => {
    it('returns checklist items for mop_not_met', () => {
      const items = caseFlagService.getChecklistForType('mop_not_met');
      expect(items.length).toBeGreaterThan(0);
      expect(items.some((i) => i.includes('MOP'))).toBe(true);
    });

    it('returns checklist items for every flag type', () => {
      const types = [
        'deceased_estate', 'divorce', 'mop_not_met', 'eip_restriction',
        'pr_quota', 'bank_loan', 'court_order', 'other',
      ] as const;
      for (const type of types) {
        expect(caseFlagService.getChecklistForType(type).length).toBeGreaterThan(0);
      }
    });
  });

  describe('hasActiveMopFlag', () => {
    it('returns true when an active mop_not_met flag exists', async () => {
      mockedCaseFlagRepo.findActiveMopFlag.mockResolvedValue({ id: 'flag-1' } as never);
      expect(await caseFlagService.hasActiveMopFlag('seller-1')).toBe(true);
    });

    it('returns false when no active mop_not_met flag exists', async () => {
      mockedCaseFlagRepo.findActiveMopFlag.mockResolvedValue(null);
      expect(await caseFlagService.hasActiveMopFlag('seller-1')).toBe(false);
    });
  });
});
