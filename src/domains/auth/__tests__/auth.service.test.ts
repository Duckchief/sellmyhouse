import * as authService from '../auth.service';

// Mock dependencies
jest.mock('../auth.repository');
jest.mock('../../shared/audit.service');
jest.mock('../../shared/encryption');
jest.mock('bcrypt');
jest.mock('otplib');
jest.mock('qrcode');

const authRepo = jest.requireMock('../auth.repository');
const auditService = jest.requireMock('../../shared/audit.service');
const encryption = jest.requireMock('../../shared/encryption');
const bcrypt = jest.requireMock('bcrypt');
const otplib = jest.requireMock('otplib');
const QRCode = jest.requireMock('qrcode');

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bcrypt.hash = jest.fn().mockResolvedValue('hashed-password');
    bcrypt.compare = jest.fn().mockResolvedValue(true);
    auditService.log = jest.fn().mockResolvedValue(undefined);
    encryption.encrypt = jest.fn().mockReturnValue('encrypted-secret');
    encryption.decrypt = jest.fn().mockReturnValue('decrypted-secret');
  });

  describe('registerSeller', () => {
    const validInput = {
      name: 'Test Seller',
      email: 'test@example.com',
      phone: '91234567',
      password: 'password123',
      consentService: true,
      consentMarketing: false,
      ipAddress: '127.0.0.1',
      userAgent: 'TestAgent',
    };

    it('throws ValidationError when consentService is false', async () => {
      await expect(
        authService.registerSeller({ ...validInput, consentService: false }),
      ).rejects.toThrow('Service consent is required');
    });

    it('throws ConflictError on duplicate email', async () => {
      authRepo.findSellerByEmail = jest.fn().mockResolvedValue({ id: 'existing' });
      await expect(authService.registerSeller(validInput)).rejects.toThrow(
        'An account with this email already exists',
      );
    });

    it('creates seller with bcrypt-hashed password', async () => {
      authRepo.findSellerByEmail = jest.fn().mockResolvedValue(null);
      authRepo.createSeller = jest.fn().mockResolvedValue({ id: 'new-seller' });
      authRepo.createConsentRecord = jest.fn().mockResolvedValue({});

      await authService.registerSeller(validInput);

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 12);
      expect(authRepo.createSeller).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Seller',
          email: 'test@example.com',
          passwordHash: 'hashed-password',
          consentService: true,
          consentMarketing: false,
        }),
      );
    });

    it('creates consent record and audit log', async () => {
      authRepo.findSellerByEmail = jest.fn().mockResolvedValue(null);
      authRepo.createSeller = jest.fn().mockResolvedValue({ id: 'new-seller' });
      authRepo.createConsentRecord = jest.fn().mockResolvedValue({});

      await authService.registerSeller(validInput);

      expect(authRepo.createConsentRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectType: 'seller',
          subjectId: 'new-seller',
          purposeService: true,
          purposeMarketing: false,
          ipAddress: '127.0.0.1',
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'seller.registered',
          entityType: 'seller',
          entityId: 'new-seller',
        }),
      );
    });
  });

  describe('loginSeller', () => {
    it('returns null when email not found', async () => {
      authRepo.findSellerByEmail = jest.fn().mockResolvedValue(null);
      const result = await authService.loginSeller('no@exist.com', 'password');
      expect(result).toBeNull();
    });

    it('runs bcrypt.compare even when email not found (prevents timing attack)', async () => {
      authRepo.findSellerByEmail = jest.fn().mockResolvedValue(null);
      const result = await authService.loginSeller('noone@test.com', 'wrong');
      expect(result).toBeNull();
      expect(bcrypt.compare).toHaveBeenCalled();
    });

    it('returns null when password is wrong', async () => {
      authRepo.findSellerByEmail = jest.fn().mockResolvedValue({
        id: 's1',
        passwordHash: 'hash',
        failedLoginAttempts: 0,
        loginLockedUntil: null,
      });
      bcrypt.compare = jest.fn().mockResolvedValue(false);
      authRepo.incrementSellerFailedLoginAttempts = jest.fn().mockResolvedValue({});

      const result = await authService.loginSeller('test@example.com', 'wrong');
      expect(result).toBeNull();
    });

    it('returns seller when credentials are correct', async () => {
      const seller = {
        id: 's1',
        passwordHash: 'hash',
        email: 'test@example.com',
        failedLoginAttempts: 0,
        loginLockedUntil: null,
      };
      authRepo.findSellerByEmail = jest.fn().mockResolvedValue(seller);
      bcrypt.compare = jest.fn().mockResolvedValue(true);

      const result = await authService.loginSeller('test@example.com', 'password');
      expect(result).toBe(seller);
    });
  });

  describe('loginSeller — login lockout', () => {
    it('returns locked error when seller login is locked', async () => {
      authRepo.findSellerByEmail = jest.fn().mockResolvedValue({
        id: 's1',
        passwordHash: 'hash',
        failedLoginAttempts: 5,
        loginLockedUntil: new Date(Date.now() + 60000),
      });

      await expect(authService.loginSeller('test@example.com', 'password')).rejects.toThrow(
        'Account is temporarily locked. Please try again later.',
      );
    });

    it('increments failed attempts on wrong password', async () => {
      authRepo.findSellerByEmail = jest.fn().mockResolvedValue({
        id: 's1',
        passwordHash: 'hash',
        failedLoginAttempts: 0,
        loginLockedUntil: null,
      });
      bcrypt.compare = jest.fn().mockResolvedValue(false);
      authRepo.incrementSellerFailedLoginAttempts = jest.fn().mockResolvedValue({});

      await authService.loginSeller('test@example.com', 'wrong');

      expect(authRepo.incrementSellerFailedLoginAttempts).toHaveBeenCalledWith('s1');
    });

    it('locks account after 5 failed attempts', async () => {
      authRepo.findSellerByEmail = jest.fn().mockResolvedValue({
        id: 's1',
        passwordHash: 'hash',
        failedLoginAttempts: 4,
        loginLockedUntil: null,
      });
      bcrypt.compare = jest.fn().mockResolvedValue(false);
      authRepo.incrementSellerFailedLoginAttempts = jest.fn().mockResolvedValue({});
      authRepo.lockSellerLogin = jest.fn().mockResolvedValue({});

      await authService.loginSeller('test@example.com', 'wrong');

      expect(authRepo.lockSellerLogin).toHaveBeenCalledWith('s1', expect.any(Date));
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.login_locked',
          entityType: 'seller',
          entityId: 's1',
        }),
      );
    });

    it('resets failed attempts on successful login', async () => {
      authRepo.findSellerByEmail = jest.fn().mockResolvedValue({
        id: 's1',
        passwordHash: 'hash',
        failedLoginAttempts: 3,
        loginLockedUntil: null,
      });
      bcrypt.compare = jest.fn().mockResolvedValue(true);
      authRepo.resetSellerLoginAttempts = jest.fn().mockResolvedValue({});

      await authService.loginSeller('test@example.com', 'password');

      expect(authRepo.resetSellerLoginAttempts).toHaveBeenCalledWith('s1');
    });

    it('allows login when lockout has expired', async () => {
      const seller = {
        id: 's1',
        passwordHash: 'hash',
        failedLoginAttempts: 0,
        loginLockedUntil: new Date(Date.now() - 60000),
      };
      authRepo.findSellerByEmail = jest.fn().mockResolvedValue(seller);
      bcrypt.compare = jest.fn().mockResolvedValue(true);
      authRepo.resetSellerLoginAttempts = jest.fn().mockResolvedValue({});

      const result = await authService.loginSeller('test@example.com', 'password');
      expect(result).toBe(seller);
    });
  });

  describe('loginAgent', () => {
    it('returns null for inactive agent', async () => {
      authRepo.findAgentByEmail = jest.fn().mockResolvedValue({
        id: 'a1',
        isActive: false,
        passwordHash: 'hash',
        failedLoginAttempts: 0,
        loginLockedUntil: null,
      });
      const result = await authService.loginAgent('agent@test.local', 'password');
      expect(result).toBeNull();
    });

    it('returns agent when credentials are correct', async () => {
      const agent = {
        id: 'a1',
        isActive: true,
        passwordHash: 'hash',
        failedLoginAttempts: 0,
        loginLockedUntil: null,
      };
      authRepo.findAgentByEmail = jest.fn().mockResolvedValue(agent);
      bcrypt.compare = jest.fn().mockResolvedValue(true);

      const result = await authService.loginAgent('agent@test.local', 'password');
      expect(result).toBe(agent);
    });

    it('runs bcrypt.compare even when email not found (prevents timing attack)', async () => {
      authRepo.findAgentByEmail = jest.fn().mockResolvedValue(null);
      const result = await authService.loginAgent('noone@test.com', 'wrong');
      expect(result).toBeNull();
      expect(bcrypt.compare).toHaveBeenCalled();
    });
  });

  describe('loginAgent — login lockout', () => {
    it('returns locked error when agent login is locked', async () => {
      authRepo.findAgentByEmail = jest.fn().mockResolvedValue({
        id: 'a1',
        isActive: true,
        passwordHash: 'hash',
        failedLoginAttempts: 5,
        loginLockedUntil: new Date(Date.now() + 60000),
      });

      await expect(authService.loginAgent('agent@test.local', 'password')).rejects.toThrow(
        'Account is temporarily locked. Please try again later.',
      );
    });

    it('increments failed attempts on wrong password', async () => {
      authRepo.findAgentByEmail = jest.fn().mockResolvedValue({
        id: 'a1',
        isActive: true,
        passwordHash: 'hash',
        failedLoginAttempts: 0,
        loginLockedUntil: null,
      });
      bcrypt.compare = jest.fn().mockResolvedValue(false);
      authRepo.incrementAgentFailedLoginAttempts = jest.fn().mockResolvedValue({});

      await authService.loginAgent('agent@test.local', 'wrong');

      expect(authRepo.incrementAgentFailedLoginAttempts).toHaveBeenCalledWith('a1');
    });

    it('locks account after 5 failed attempts', async () => {
      authRepo.findAgentByEmail = jest.fn().mockResolvedValue({
        id: 'a1',
        isActive: true,
        passwordHash: 'hash',
        failedLoginAttempts: 4,
        loginLockedUntil: null,
      });
      bcrypt.compare = jest.fn().mockResolvedValue(false);
      authRepo.incrementAgentFailedLoginAttempts = jest.fn().mockResolvedValue({});
      authRepo.lockAgentLogin = jest.fn().mockResolvedValue({});

      await authService.loginAgent('agent@test.local', 'wrong');

      expect(authRepo.lockAgentLogin).toHaveBeenCalledWith('a1', expect.any(Date));
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.login_locked',
          entityType: 'agent',
          entityId: 'a1',
        }),
      );
    });

    it('resets failed attempts on successful login', async () => {
      authRepo.findAgentByEmail = jest.fn().mockResolvedValue({
        id: 'a1',
        isActive: true,
        passwordHash: 'hash',
        failedLoginAttempts: 3,
        loginLockedUntil: null,
      });
      bcrypt.compare = jest.fn().mockResolvedValue(true);
      authRepo.resetAgentLoginAttempts = jest.fn().mockResolvedValue({});

      await authService.loginAgent('agent@test.local', 'password');

      expect(authRepo.resetAgentLoginAttempts).toHaveBeenCalledWith('a1');
    });

    it('allows login when lockout has expired', async () => {
      const agent = {
        id: 'a1',
        isActive: true,
        passwordHash: 'hash',
        failedLoginAttempts: 0,
        loginLockedUntil: new Date(Date.now() - 60000),
      };
      authRepo.findAgentByEmail = jest.fn().mockResolvedValue(agent);
      bcrypt.compare = jest.fn().mockResolvedValue(true);
      authRepo.resetAgentLoginAttempts = jest.fn().mockResolvedValue({});

      const result = await authService.loginAgent('agent@test.local', 'password');
      expect(result).toBe(agent);
    });
  });

  describe('setup2FA', () => {
    it('generates secret, QR code, and backup codes', async () => {
      otplib.generateSecret = jest.fn().mockReturnValue('ABCDEF');
      otplib.generateURI = jest.fn().mockReturnValue('otpauth://totp/...');
      QRCode.toDataURL = jest.fn().mockResolvedValue('data:image/png;base64,...');
      authRepo.updateSellerTwoFactor = jest.fn().mockResolvedValue({});

      const result = await authService.setup2FA('s1', 'seller');

      expect(result.secret).toBe('ABCDEF');
      expect(result.qrCodeDataUrl).toContain('data:image');
      expect(result.backupCodes).toHaveLength(8);
      expect(authRepo.updateSellerTwoFactor).toHaveBeenCalledWith('s1', {
        twoFactorSecret: 'encrypted-secret',
        twoFactorEnabled: true,
        twoFactorBackupCodes: expect.any(Array),
      });
    });
  });

  describe('verify2FA', () => {
    const baseRecord = {
      id: 's1',
      twoFactorSecret: 'encrypted-secret',
      twoFactorLockedUntil: null,
      failedTwoFactorAttempts: 0,
      twoFactorBackupCodes: [],
    };

    it('returns true on valid token and resets failures', async () => {
      authRepo.findSellerById = jest.fn().mockResolvedValue(baseRecord);
      otplib.verifySync = jest.fn().mockReturnValue({ valid: true, delta: 0 });
      authRepo.resetSellerFailedTwoFactor = jest.fn().mockResolvedValue({});

      const result = await authService.verify2FA({
        userId: 's1',
        role: 'seller',
        token: '123456',
      });

      expect(result).toBe(true);
      expect(authRepo.resetSellerFailedTwoFactor).toHaveBeenCalledWith('s1');
    });

    it('increments failures on invalid token', async () => {
      authRepo.findSellerById = jest.fn().mockResolvedValue(baseRecord);
      otplib.verifySync = jest.fn().mockReturnValue({ valid: false });
      authRepo.incrementSellerFailedTwoFactor = jest.fn().mockResolvedValue({});

      const result = await authService.verify2FA({
        userId: 's1',
        role: 'seller',
        token: 'wrong',
      });

      expect(result).toBe(false);
      expect(authRepo.incrementSellerFailedTwoFactor).toHaveBeenCalledWith('s1');
    });

    it('locks after 5 failures', async () => {
      const record = { ...baseRecord, failedTwoFactorAttempts: 4 };
      authRepo.findSellerById = jest.fn().mockResolvedValue(record);
      otplib.verifySync = jest.fn().mockReturnValue({ valid: false });
      authRepo.incrementSellerFailedTwoFactor = jest.fn().mockResolvedValue({});
      authRepo.lockSellerTwoFactor = jest.fn().mockResolvedValue({});

      await authService.verify2FA({
        userId: 's1',
        role: 'seller',
        token: 'wrong',
      });

      expect(authRepo.lockSellerTwoFactor).toHaveBeenCalledWith('s1', expect.any(Date));
    });

    it('throws when locked out', async () => {
      const record = {
        ...baseRecord,
        twoFactorLockedUntil: new Date(Date.now() + 60000),
      };
      authRepo.findSellerById = jest.fn().mockResolvedValue(record);

      await expect(
        authService.verify2FA({ userId: 's1', role: 'seller', token: '123456' }),
      ).rejects.toThrow('2FA is temporarily locked');
    });
  });

  describe('verifyBackupCode', () => {
    it('returns true and removes used code atomically', async () => {
      authRepo.findSellerById = jest.fn().mockResolvedValue({
        id: 's1',
        twoFactorBackupCodes: ['hash1', 'hash2', 'hash3'],
      });
      // Match second code
      bcrypt.compare = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      authRepo.removeBackupCodeAtomically = jest.fn().mockResolvedValue(['hash1', 'hash3']);

      const result = await authService.verifyBackupCode({
        userId: 's1',
        role: 'seller',
        code: 'mycode',
      });

      expect(result).toBe(true);
      expect(authRepo.removeBackupCodeAtomically).toHaveBeenCalledWith(
        's1',
        'seller',
        1, // index of matched code (hash2)
        ['hash1', 'hash2', 'hash3'],
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: '2fa.backup_code_used',
          details: { remainingCodes: 2 },
        }),
      );
    });

    it('returns false when no code matches', async () => {
      authRepo.findSellerById = jest.fn().mockResolvedValue({
        id: 's1',
        twoFactorBackupCodes: ['hash1'],
      });
      bcrypt.compare = jest.fn().mockResolvedValue(false);

      const result = await authService.verifyBackupCode({
        userId: 's1',
        role: 'seller',
        code: 'wrong',
      });
      expect(result).toBe(false);
    });
  });

  describe('changePassword', () => {
    it('hashes new password with bcrypt cost 12 and logs audit', async () => {
      authRepo.updateSellerPasswordHash = jest.fn().mockResolvedValue({});

      await authService.changePassword('s1', 'seller', 'newpassword');

      expect(bcrypt.hash).toHaveBeenCalledWith('newpassword', 12);
      expect(authRepo.updateSellerPasswordHash).toHaveBeenCalledWith('s1', 'hashed-password');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'password.changed',
          entityType: 'seller',
          entityId: 's1',
        }),
      );
    });
  });
});
