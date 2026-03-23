import * as authService from '../auth.service';

// Mock dependencies
jest.mock('../auth.repository');
jest.mock('../../shared/audit.service');
jest.mock('../../shared/encryption');
jest.mock('bcrypt');
jest.mock('otplib');
jest.mock('qrcode');
jest.mock('../../../infra/email/system-mailer');
const systemMailer = jest.requireMock('../../../infra/email/system-mailer');

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
          sellerId: 'new-seller',
          purposeService: true,
          purposeMarketing: false,
          ipAddress: '127.0.0.1',
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.seller_registered',
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
          action: 'auth.2fa_backup_used',
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
      authRepo.invalidateUserSessions = jest.fn().mockResolvedValue(undefined);

      await authService.changePassword('s1', 'seller', 'newpassword');

      expect(bcrypt.hash).toHaveBeenCalledWith('newpassword', 12);
      expect(authRepo.updateSellerPasswordHash).toHaveBeenCalledWith('s1', 'hashed-password');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.password_changed',
          entityType: 'seller',
          entityId: 's1',
        }),
      );
    });

    it('invalidates other sessions on password change', async () => {
      authRepo.updateSellerPasswordHash = jest.fn().mockResolvedValue({});
      authRepo.invalidateUserSessions = jest.fn().mockResolvedValue(undefined);

      await authService.changePassword('s1', 'seller', 'newpassword', 'session-123');

      expect(authRepo.invalidateUserSessions).toHaveBeenCalledWith('s1', 'session-123');
    });
  });

  describe('requestPasswordReset', () => {
    it('generates token and stores SHA-256 hash with 1-hour expiry', async () => {
      authRepo.findSellerByEmail = jest
        .fn()
        .mockResolvedValue({ id: 's1', email: 'test@test.com' });
      authRepo.setSellerPasswordResetToken = jest.fn().mockResolvedValue({});

      const result = await authService.requestPasswordReset('test@test.com', 'seller');

      expect(result).not.toBeNull();
      expect(result!.token).toHaveLength(128); // 64 bytes = 128 hex chars
      expect(authRepo.setSellerPasswordResetToken).toHaveBeenCalledWith(
        's1',
        expect.any(String), // SHA-256 hash
        expect.any(Date), // 1-hour expiry
      );
    });

    it('returns null for non-existent email (no error)', async () => {
      authRepo.findSellerByEmail = jest.fn().mockResolvedValue(null);
      const result = await authService.requestPasswordReset('noone@test.com', 'seller');
      expect(result).toBeNull();
    });

    it('audit logs the reset request', async () => {
      authRepo.findSellerByEmail = jest
        .fn()
        .mockResolvedValue({ id: 's1', email: 'test@test.com' });
      authRepo.setSellerPasswordResetToken = jest.fn().mockResolvedValue({});

      await authService.requestPasswordReset('test@test.com', 'seller');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.password_reset_requested' }),
      );
    });
  });

  describe('resetPassword', () => {
    it('resets password when token is valid and not expired', async () => {
      authRepo.findSellerByResetToken = jest.fn().mockResolvedValue({
        id: 's1',
        passwordResetToken: 'hashed',
        passwordResetExpiry: new Date(Date.now() + 3600000),
      });
      authRepo.updateSellerPasswordHash = jest.fn().mockResolvedValue({});
      authRepo.clearSellerPasswordResetToken = jest.fn().mockResolvedValue({});
      authRepo.invalidateUserSessions = jest.fn().mockResolvedValue(undefined);

      await authService.resetPassword('valid-token', 'newpassword123', 'seller');

      expect(authRepo.updateSellerPasswordHash).toHaveBeenCalledWith('s1', expect.any(String));
      expect(authRepo.clearSellerPasswordResetToken).toHaveBeenCalledWith('s1');
      expect(authRepo.invalidateUserSessions).toHaveBeenCalledWith('s1');
    });

    it('throws ValidationError for expired token', async () => {
      authRepo.findSellerByResetToken = jest.fn().mockResolvedValue({
        id: 's1',
        passwordResetToken: 'hashed',
        passwordResetExpiry: new Date(Date.now() - 1000),
      });

      await expect(
        authService.resetPassword('expired-token', 'newpassword', 'seller'),
      ).rejects.toThrow('Invalid or expired reset token');
    });

    it('throws ValidationError for invalid token', async () => {
      authRepo.findSellerByResetToken = jest.fn().mockResolvedValue(null);

      await expect(authService.resetPassword('bad-token', 'newpassword', 'seller')).rejects.toThrow(
        'Invalid or expired reset token',
      );
    });

    it('audit logs the password reset', async () => {
      authRepo.findSellerByResetToken = jest.fn().mockResolvedValue({
        id: 's1',
        passwordResetToken: 'hashed',
        passwordResetExpiry: new Date(Date.now() + 3600000),
      });
      authRepo.updateSellerPasswordHash = jest.fn().mockResolvedValue({});
      authRepo.clearSellerPasswordResetToken = jest.fn().mockResolvedValue({});
      authRepo.invalidateUserSessions = jest.fn().mockResolvedValue(undefined);

      await authService.resetPassword('token', 'newpass', 'seller');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.password_reset_completed' }),
      );
    });
  });

  describe('sendVerificationEmail', () => {
    it('sets verification token and sends email', async () => {
      authRepo.setSellerEmailVerificationToken = jest.fn().mockResolvedValue({});
      systemMailer.sendSystemEmail = jest.fn().mockResolvedValue(undefined);

      await authService.sendVerificationEmail('seller-1', 'seller@example.com');

      expect(authRepo.setSellerEmailVerificationToken).toHaveBeenCalledWith(
        'seller-1',
        expect.any(String),
        expect.any(Date),
      );
      expect(systemMailer.sendSystemEmail).toHaveBeenCalledWith(
        'seller@example.com',
        expect.stringContaining('Verify'),
        expect.stringContaining('/auth/verify-email/'),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.email_verification_sent' }),
      );
    });
  });

  describe('verifyEmail', () => {
    it('marks seller email as verified when token is valid', async () => {
      const expiry = new Date(Date.now() + 60 * 60 * 1000);
      authRepo.findSellerByEmailVerificationToken = jest.fn().mockResolvedValue({
        id: 'seller-1',
        emailVerificationExpiry: expiry,
      });
      authRepo.markSellerEmailVerified = jest.fn().mockResolvedValue({});

      await authService.verifyEmail('raw-token');

      expect(authRepo.markSellerEmailVerified).toHaveBeenCalledWith('seller-1');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.email_verified' }),
      );
    });

    it('throws ValidationError when token is not found', async () => {
      authRepo.findSellerByEmailVerificationToken = jest.fn().mockResolvedValue(null);
      await expect(authService.verifyEmail('bad-token')).rejects.toThrow('Invalid or expired');
    });

    it('throws ValidationError when token is expired', async () => {
      authRepo.findSellerByEmailVerificationToken = jest.fn().mockResolvedValue({
        id: 'seller-1',
        emailVerificationExpiry: new Date(Date.now() - 1000),
      });
      await expect(authService.verifyEmail('raw-token')).rejects.toThrow('Invalid or expired');
    });
  });

  describe('resendVerificationEmail', () => {
    it('re-generates token and sends email for the seller', async () => {
      authRepo.findSellerById = jest.fn().mockResolvedValue({
        id: 'seller-1',
        email: 'seller@example.com',
        emailVerified: false,
      });
      authRepo.setSellerEmailVerificationToken = jest.fn().mockResolvedValue({});
      systemMailer.sendSystemEmail = jest.fn().mockResolvedValue(undefined);

      await authService.resendVerificationEmail('seller-1');

      expect(authRepo.setSellerEmailVerificationToken).toHaveBeenCalledWith(
        'seller-1',
        expect.any(String),
        expect.any(Date),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.email_verification_resent' }),
      );
    });

    it('throws ValidationError if seller not found', async () => {
      authRepo.findSellerById = jest.fn().mockResolvedValue(null);
      await expect(authService.resendVerificationEmail('bad-id')).rejects.toThrow();
    });
  });

  describe('sendAccountSetupEmail', () => {
    it('generates token, stores hash, and sends setup email', async () => {
      authRepo.setSellerPasswordResetToken = jest.fn().mockResolvedValue(undefined);
      systemMailer.sendSystemEmail = jest.fn().mockResolvedValue(undefined);

      await authService.sendAccountSetupEmail('seller-1', 'Peanuts Malone', 'peanuts@example.com');

      expect(authRepo.setSellerPasswordResetToken).toHaveBeenCalledWith(
        'seller-1',
        expect.any(String), // hashed token
        expect.any(Date), // expiry
      );
      expect(systemMailer.sendSystemEmail).toHaveBeenCalledWith(
        'peanuts@example.com',
        'Set up your SellMyHomeNow account',
        expect.stringContaining('/auth/setup-account?token='),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'lead.account_setup_sent',
          entityId: 'seller-1',
        }),
      );
    });

    it('sets expiry to 24 hours from now', async () => {
      authRepo.setSellerPasswordResetToken = jest.fn().mockResolvedValue(undefined);
      systemMailer.sendSystemEmail = jest.fn().mockResolvedValue(undefined);

      const before = Date.now();
      await authService.sendAccountSetupEmail('seller-1', 'Test', 'test@example.com');
      const after = Date.now();

      const expiry = authRepo.setSellerPasswordResetToken.mock.calls[0][2] as Date;
      const expiryMs = expiry.getTime();
      expect(expiryMs).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000 - 5000);
      expect(expiryMs).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000 + 5000);
    });
  });

  describe('registerSeller — sends verification email', () => {
    it('calls sendVerificationEmail after creating seller', async () => {
      authRepo.findSellerByEmail = jest.fn().mockResolvedValue(null);
      authRepo.createSeller = jest
        .fn()
        .mockResolvedValue({ id: 'new-seller', email: 'test@example.com' });
      authRepo.createConsentRecord = jest.fn().mockResolvedValue({});
      authRepo.setSellerEmailVerificationToken = jest.fn().mockResolvedValue({});
      systemMailer.sendSystemEmail = jest.fn().mockResolvedValue(undefined);

      await authService.registerSeller({
        name: 'Test',
        email: 'test@example.com',
        phone: '91234567',
        password: 'pass',
        consentService: true,
        consentMarketing: false,
        ipAddress: '127.0.0.1',
        userAgent: 'Test',
      });

      expect(authRepo.setSellerEmailVerificationToken).toHaveBeenCalled();
      expect(systemMailer.sendSystemEmail).toHaveBeenCalledWith(
        'test@example.com',
        expect.stringContaining('Verify'),
        expect.any(String),
      );
    });
  });
});
