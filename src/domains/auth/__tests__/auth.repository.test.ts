import * as authRepo from '../auth.repository';

// Mock prisma
jest.mock('../../../infra/database/prisma', () => ({
  prisma: {
    seller: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    agent: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    consentRecord: {
      create: jest.fn(),
    },
  },
  createId: jest.fn().mockReturnValue('test-id'),
}));

const { prisma } = jest.requireMock('../../../infra/database/prisma');

describe('AuthRepository', () => {
  describe('seller', () => {
    it('findByEmail queries with correct where clause', async () => {
      prisma.seller.findUnique.mockResolvedValue(null);
      await authRepo.findSellerByEmail('test@example.com');
      expect(prisma.seller.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
    });

    it('findById queries with correct where clause', async () => {
      prisma.seller.findUnique.mockResolvedValue(null);
      await authRepo.findSellerById('seller-123');
      expect(prisma.seller.findUnique).toHaveBeenCalledWith({
        where: { id: 'seller-123' },
      });
    });

    it('createSeller passes correct data shape', async () => {
      prisma.seller.create.mockResolvedValue({ id: 'test-id' });
      await authRepo.createSeller({
        name: 'Test',
        email: 'test@example.com',
        phone: '91234567',
        passwordHash: 'hashed',
        consentService: true,
        consentMarketing: false,
      });
      expect(prisma.seller.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'test-id',
          name: 'Test',
          email: 'test@example.com',
          phone: '91234567',
          passwordHash: 'hashed',
          consentService: true,
          consentMarketing: false,
          status: 'lead',
        }),
      });
    });

    it('updatePasswordHash uses correct where and data', async () => {
      prisma.seller.update.mockResolvedValue({});
      await authRepo.updateSellerPasswordHash('s1', 'newhash');
      expect(prisma.seller.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { passwordHash: 'newhash' },
      });
    });

    it('incrementFailedTwoFactor increments correctly', async () => {
      prisma.seller.update.mockResolvedValue({});
      await authRepo.incrementSellerFailedTwoFactor('s1');
      expect(prisma.seller.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { failedTwoFactorAttempts: { increment: 1 } },
      });
    });

    it('resetFailedTwoFactor clears count and lock', async () => {
      prisma.seller.update.mockResolvedValue({});
      await authRepo.resetSellerFailedTwoFactor('s1');
      expect(prisma.seller.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { failedTwoFactorAttempts: 0, twoFactorLockedUntil: null },
      });
    });

    it('incrementFailedLoginAttempts increments correctly', async () => {
      prisma.seller.update.mockResolvedValue({});
      await authRepo.incrementSellerFailedLoginAttempts('s1');
      expect(prisma.seller.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { failedLoginAttempts: { increment: 1 } },
      });
    });

    it('lockSellerLogin sets loginLockedUntil and resets failedLoginAttempts to 0', async () => {
      prisma.seller.update.mockResolvedValue({});
      const until = new Date('2026-03-12T00:00:00Z');
      await authRepo.lockSellerLogin('s1', until);
      expect(prisma.seller.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { loginLockedUntil: until, failedLoginAttempts: 0 },
      });
    });

    it('resetSellerLoginAttempts clears failedLoginAttempts and loginLockedUntil', async () => {
      prisma.seller.update.mockResolvedValue({});
      await authRepo.resetSellerLoginAttempts('s1');
      expect(prisma.seller.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { failedLoginAttempts: 0, loginLockedUntil: null },
      });
    });
  });

  describe('agent', () => {
    it('findByEmail queries with correct where clause', async () => {
      prisma.agent.findUnique.mockResolvedValue(null);
      await authRepo.findAgentByEmail('agent@test.local');
      expect(prisma.agent.findUnique).toHaveBeenCalledWith({
        where: { email: 'agent@test.local' },
      });
    });

    it('incrementFailedTwoFactor increments correctly', async () => {
      prisma.agent.update.mockResolvedValue({});
      await authRepo.incrementAgentFailedTwoFactor('a1');
      expect(prisma.agent.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { failedTwoFactorAttempts: { increment: 1 } },
      });
    });

    it('incrementAgentFailedLoginAttempts increments correctly', async () => {
      prisma.agent.update.mockResolvedValue({});
      await authRepo.incrementAgentFailedLoginAttempts('a1');
      expect(prisma.agent.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { failedLoginAttempts: { increment: 1 } },
      });
    });

    it('lockAgentLogin sets loginLockedUntil and resets failedLoginAttempts to 0', async () => {
      prisma.agent.update.mockResolvedValue({});
      const until = new Date('2026-03-12T00:00:00Z');
      await authRepo.lockAgentLogin('a1', until);
      expect(prisma.agent.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { loginLockedUntil: until, failedLoginAttempts: 0 },
      });
    });

    it('resetAgentLoginAttempts clears failedLoginAttempts and loginLockedUntil', async () => {
      prisma.agent.update.mockResolvedValue({});
      await authRepo.resetAgentLoginAttempts('a1');
      expect(prisma.agent.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { failedLoginAttempts: 0, loginLockedUntil: null },
      });
    });
  });

  describe('consentRecord', () => {
    it('creates with correct shape including IP and userAgent', async () => {
      prisma.consentRecord.create.mockResolvedValue({ id: 'test-id' });
      await authRepo.createConsentRecord({
        subjectType: 'seller',
        subjectId: 's1',
        purposeService: true,
        purposeMarketing: false,
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
      });
      expect(prisma.consentRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subjectType: 'seller',
          subjectId: 's1',
          purposeService: true,
          purposeMarketing: false,
          ipAddress: '127.0.0.1',
          userAgent: 'Mozilla/5.0',
        }),
      });
    });
  });
});
