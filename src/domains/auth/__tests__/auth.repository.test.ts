import * as authRepo from '../auth.repository';

// Mock prisma
jest.mock('../../../infra/database/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    $executeRawUnsafe: jest.fn(),
    seller: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    agent: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
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

    it('setSellerPasswordResetToken sets token and expiry', async () => {
      prisma.seller.update.mockResolvedValue({});
      const expiry = new Date('2026-03-12T01:00:00Z');
      await authRepo.setSellerPasswordResetToken('s1', 'hashed-token', expiry);
      expect(prisma.seller.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { passwordResetToken: 'hashed-token', passwordResetExpiry: expiry },
      });
    });

    it('findSellerByResetToken queries with findFirst and correct where clause', async () => {
      prisma.seller.findFirst.mockResolvedValue(null);
      await authRepo.findSellerByResetToken('hashed-token');
      expect(prisma.seller.findFirst).toHaveBeenCalledWith({
        where: { passwordResetToken: 'hashed-token' },
      });
    });

    it('clearSellerPasswordResetToken sets both fields to null', async () => {
      prisma.seller.update.mockResolvedValue({});
      await authRepo.clearSellerPasswordResetToken('s1');
      expect(prisma.seller.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { passwordResetToken: null, passwordResetExpiry: null },
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

    it('setAgentPasswordResetToken sets token and expiry', async () => {
      prisma.agent.update.mockResolvedValue({});
      const expiry = new Date('2026-03-12T01:00:00Z');
      await authRepo.setAgentPasswordResetToken('a1', 'hashed-token', expiry);
      expect(prisma.agent.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { passwordResetToken: 'hashed-token', passwordResetExpiry: expiry },
      });
    });

    it('findAgentByResetToken queries with findFirst and correct where clause', async () => {
      prisma.agent.findFirst.mockResolvedValue(null);
      await authRepo.findAgentByResetToken('hashed-token');
      expect(prisma.agent.findFirst).toHaveBeenCalledWith({
        where: { passwordResetToken: 'hashed-token' },
      });
    });

    it('clearAgentPasswordResetToken sets both fields to null', async () => {
      prisma.agent.update.mockResolvedValue({});
      await authRepo.clearAgentPasswordResetToken('a1');
      expect(prisma.agent.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { passwordResetToken: null, passwordResetExpiry: null },
      });
    });
  });

  describe('removeBackupCodeAtomically', () => {
    it('removes code at index using transaction', async () => {
      prisma.$transaction = jest
        .fn()
        .mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
      prisma.seller.update = jest.fn().mockResolvedValue({});

      const codes = ['hash0', 'hash1', 'hash2'];
      const remaining = await authRepo.removeBackupCodeAtomically('s1', 'seller', 1, codes);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.seller.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { twoFactorBackupCodes: ['hash0', 'hash2'] },
      });
      expect(remaining).toEqual(['hash0', 'hash2']);
    });

    it('works for agent role', async () => {
      prisma.$transaction = jest
        .fn()
        .mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
      prisma.agent.update = jest.fn().mockResolvedValue({});

      const codes = ['hash0', 'hash1'];
      const remaining = await authRepo.removeBackupCodeAtomically('a1', 'agent', 0, codes);

      expect(prisma.agent.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { twoFactorBackupCodes: ['hash1'] },
      });
      expect(remaining).toEqual(['hash1']);
    });
  });

  describe('invalidateUserSessions', () => {
    it('deletes all sessions for user', async () => {
      prisma.$executeRawUnsafe = jest.fn().mockResolvedValue(0);
      await authRepo.invalidateUserSessions('user-1');
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM "session"'),
        expect.stringContaining('user-1'),
      );
    });

    it('preserves current session when exceptSessionId provided', async () => {
      prisma.$executeRawUnsafe = jest.fn().mockResolvedValue(0);
      await authRepo.invalidateUserSessions('user-1', 'current-sid');
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('AND sid != $2'),
        expect.stringContaining('user-1'),
        'current-sid',
      );
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
