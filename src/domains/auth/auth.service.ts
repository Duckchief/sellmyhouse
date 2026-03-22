import bcrypt from 'bcrypt';
import { generateSecret as otpGenerateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import * as authRepo from './auth.repository';
import * as auditService from '../shared/audit.service';
import { encrypt, decrypt } from '../shared/encryption';
import { ValidationError, ConflictError, UnauthorizedError } from '../shared/errors';
import { maskEmail } from '../shared/nric';
import { sendSystemEmail } from '../../infra/email/system-mailer';
import type {
  SellerRegistrationInput,
  TotpSetupResult,
  TotpVerifyInput,
  BackupCodeVerifyInput,
  UserRole,
} from './auth.types';

const BCRYPT_ROUNDS = 12;
const BACKUP_CODE_COUNT = 8;
const MAX_2FA_FAILURES = 5;
const LOCKOUT_MINUTES = 30;
const MAX_LOGIN_FAILURES = 5;
const DUMMY_HASH = '$2b$12$LJ3m4ys3Lk0TSwMCkGRNnuV6B5rl.LCbQiAsl/RIccJxO3bFG8V2a';

export async function registerSeller(input: SellerRegistrationInput) {
  if (!input.consentService) {
    throw new ValidationError('Service consent is required', {
      consentService: 'You must consent to our service terms to register',
    });
  }

  const existing = await authRepo.findSellerByEmail(input.email);
  if (existing) {
    throw new ConflictError('An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const seller = await authRepo.createSeller({
    name: input.name,
    email: input.email,
    phone: input.phone,
    passwordHash,
    consentService: input.consentService,
    consentMarketing: input.consentMarketing,
  });

  await authRepo.createConsentRecord({
    sellerId: seller.id,
    purposeService: input.consentService,
    purposeMarketing: input.consentMarketing,
    purposeHuttonsTransfer: false,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  // Best-effort: send verification email; failure should not block registration
  try {
    await sendVerificationEmail(seller.id, seller.email as string);
  } catch (err) {
    await auditService.log({
      action: 'auth.email_verification_send_failed',
      entityType: 'seller',
      entityId: seller.id,
      details: { error: err instanceof Error ? err.message : String(err) },
      actorType: 'system' as const,
    });
  }

  await auditService.log({
    action: 'auth.seller_registered',
    entityType: 'seller',
    entityId: seller.id,
    details: { email: maskEmail(input.email) },
    ipAddress: input.ipAddress,
    actorType: 'seller' as const,
    actorId: seller.id,
  });

  return seller;
}

export async function loginSeller(email: string, password: string) {
  const seller = await authRepo.findSellerByEmail(email);
  const hashToCompare = seller?.passwordHash ?? DUMMY_HASH;
  const passwordValid = await bcrypt.compare(password, hashToCompare);

  if (!seller) return null;

  // Check login lockout
  if (seller.loginLockedUntil && seller.loginLockedUntil > new Date()) {
    throw new UnauthorizedError('Account is temporarily locked. Please try again later.');
  }

  if (!passwordValid) {
    await auditService.log({
      action: 'auth.login_failed',
      entityType: 'Seller',
      entityId: seller.id,
      details: { reason: 'invalid_password' },
      actorType: 'seller' as const,
      actorId: seller.id,
    });
    await authRepo.incrementSellerFailedLoginAttempts(seller.id);
    if (seller.failedLoginAttempts + 1 >= MAX_LOGIN_FAILURES) {
      const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
      await authRepo.lockSellerLogin(seller.id, lockUntil);
      await auditService.log({
        action: 'auth.login_locked',
        entityType: 'seller',
        entityId: seller.id,
        details: { reason: 'Too many failed login attempts' },
        actorType: 'system' as const,
      });
    }
    return null;
  }

  // Success — reset failed attempts
  if (seller.failedLoginAttempts > 0 || seller.loginLockedUntil) {
    await authRepo.resetSellerLoginAttempts(seller.id);
  }

  await auditService.log({
    action: 'auth.login_success',
    entityType: 'Seller',
    entityId: seller.id,
    details: {},
    actorType: 'seller' as const,
    actorId: seller.id,
  });

  return seller;
}

export async function loginAgent(email: string, password: string) {
  const agent = await authRepo.findAgentByEmail(email);
  const hashToCompare = agent?.passwordHash ?? DUMMY_HASH;
  const passwordValid = await bcrypt.compare(password, hashToCompare);

  if (!agent) return null;
  if (!agent.isActive) return null;

  // Check login lockout
  if (agent.loginLockedUntil && agent.loginLockedUntil > new Date()) {
    throw new UnauthorizedError('Account is temporarily locked. Please try again later.');
  }

  if (!passwordValid) {
    await auditService.log({
      action: 'auth.login_failed',
      entityType: 'Agent',
      entityId: agent.id,
      details: { reason: 'invalid_password' },
      actorType: 'agent' as const,
      actorId: agent.id,
    });
    await authRepo.incrementAgentFailedLoginAttempts(agent.id);
    if (agent.failedLoginAttempts + 1 >= MAX_LOGIN_FAILURES) {
      const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
      await authRepo.lockAgentLogin(agent.id, lockUntil);
      await auditService.log({
        action: 'auth.login_locked',
        entityType: 'agent',
        entityId: agent.id,
        details: { reason: 'Too many failed login attempts' },
        actorType: 'system' as const,
      });
    }
    return null;
  }

  // Success — reset failed attempts
  if (agent.failedLoginAttempts > 0 || agent.loginLockedUntil) {
    await authRepo.resetAgentLoginAttempts(agent.id);
  }

  await auditService.log({
    action: 'auth.login_success',
    entityType: 'Agent',
    entityId: agent.id,
    details: {},
    actorType: 'agent' as const,
    actorId: agent.id,
  });

  return agent;
}

export async function setup2FA(
  userId: string,
  role: UserRole,
  currentSessionId?: string,
): Promise<TotpSetupResult> {
  const secret = otpGenerateSecret();
  const issuer = role === 'seller' ? 'SellMyHomeNow (Seller)' : 'SellMyHomeNow (Agent)';
  const otpAuthUrl = generateURI({ issuer, label: userId, secret });
  const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl);

  // Generate backup codes
  const backupCodes: string[] = [];
  const hashedCodes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const code = crypto.randomBytes(4).toString('hex'); // 8 char hex
    backupCodes.push(code);
    hashedCodes.push(await bcrypt.hash(code, BCRYPT_ROUNDS));
  }

  const encryptedSecret = encrypt(secret);

  const updateFn =
    role === 'seller' ? authRepo.updateSellerTwoFactor : authRepo.updateAgentTwoFactor;

  await updateFn(userId, {
    twoFactorSecret: encryptedSecret,
    twoFactorEnabled: true,
    twoFactorBackupCodes: hashedCodes,
  });

  // Invalidate all other sessions so existing sessions cannot bypass the new 2FA secret
  await authRepo.invalidateUserSessions(userId, currentSessionId);

  await auditService.log({
    action: 'auth.2fa_setup',
    entityType: role,
    entityId: userId,
    details: { method: 'totp' },
    actorType: role as 'seller' | 'agent',
    actorId: userId,
  });

  return { secret, otpAuthUrl, qrCodeDataUrl, backupCodes };
}

export async function verify2FA(input: TotpVerifyInput): Promise<boolean> {
  const record = await getRecordForRole(input.userId, input.role);
  if (!record) throw new UnauthorizedError('User not found');

  // Check lockout
  if (record.twoFactorLockedUntil && record.twoFactorLockedUntil > new Date()) {
    throw new UnauthorizedError('2FA is temporarily locked. Please try again later.');
  }

  if (!record.twoFactorSecret) {
    throw new UnauthorizedError('2FA is not set up');
  }

  const secret = decrypt(record.twoFactorSecret);
  const result = verifySync({ secret, token: input.token });
  const isValid = result.valid;

  if (!isValid) {
    const incrementFn =
      input.role === 'seller'
        ? authRepo.incrementSellerFailedTwoFactor
        : authRepo.incrementAgentFailedTwoFactor;
    await incrementFn(input.userId);

    const newFailures = record.failedTwoFactorAttempts + 1;
    if (newFailures >= MAX_2FA_FAILURES) {
      const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
      const lockFn =
        input.role === 'seller' ? authRepo.lockSellerTwoFactor : authRepo.lockAgentTwoFactor;
      await lockFn(input.userId, lockUntil);
    }

    return false;
  }

  // Reset failures on success
  const resetFn =
    input.role === 'seller'
      ? authRepo.resetSellerFailedTwoFactor
      : authRepo.resetAgentFailedTwoFactor;
  await resetFn(input.userId);

  return true;
}

export async function verifyBackupCode(input: BackupCodeVerifyInput): Promise<boolean> {
  const record = await getRecordForRole(input.userId, input.role);
  if (!record) throw new UnauthorizedError('User not found');

  const storedCodes = (record.twoFactorBackupCodes as string[]) || [];
  if (storedCodes.length === 0) return false;

  for (let i = 0; i < storedCodes.length; i++) {
    const matches = await bcrypt.compare(input.code, storedCodes[i]);
    if (matches) {
      // Remove used code atomically (prevents race condition)
      const remaining = await authRepo.removeBackupCodeAtomically(
        input.userId,
        input.role,
        i,
        storedCodes,
      );

      await auditService.log({
        action: 'auth.2fa_backup_used',
        entityType: input.role,
        entityId: input.userId,
        details: { remainingCodes: remaining.length },
        actorType: input.role as 'seller' | 'agent',
        actorId: input.userId,
      });

      return true;
    }
  }

  return false;
}

export async function changePassword(
  userId: string,
  role: UserRole,
  newPassword: string,
  currentSessionId?: string,
) {
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  const updateFn =
    role === 'seller' ? authRepo.updateSellerPasswordHash : authRepo.updateAgentPasswordHash;
  await updateFn(userId, passwordHash);

  await authRepo.invalidateUserSessions(userId, currentSessionId);

  await auditService.log({
    action: 'auth.password_changed',
    entityType: role,
    entityId: userId,
    details: {},
    actorType: role as 'seller' | 'agent',
    actorId: userId,
  });
}

export async function requestPasswordReset(
  email: string,
  role: UserRole,
): Promise<{ token: string; userId: string } | null> {
  const findFn = role === 'seller' ? authRepo.findSellerByEmail : authRepo.findAgentByEmail;
  const user = await findFn(email);

  if (!user) {
    // Constant-time dummy compare to prevent email enumeration via timing
    await bcrypt.compare('dummy', DUMMY_HASH);
    return null;
  }

  const token = crypto.randomBytes(64).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  const setTokenFn =
    role === 'seller' ? authRepo.setSellerPasswordResetToken : authRepo.setAgentPasswordResetToken;
  await setTokenFn(user.id, hashedToken, expiry);

  await auditService.log({
    action: 'auth.password_reset_requested',
    entityType: role,
    entityId: user.id,
    details: { email: maskEmail(email) },
    actorType: role as 'seller' | 'agent',
    actorId: user.id,
  });

  return { token, userId: user.id };
}

export async function resetPassword(
  token: string,
  newPassword: string,
  role: UserRole,
): Promise<void> {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const findFn =
    role === 'seller' ? authRepo.findSellerByResetToken : authRepo.findAgentByResetToken;
  const user = await findFn(hashedToken);

  if (!user) {
    throw new ValidationError('Invalid or expired reset token');
  }

  if (!user.passwordResetExpiry || user.passwordResetExpiry < new Date()) {
    throw new ValidationError('Invalid or expired reset token');
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  const updateFn =
    role === 'seller' ? authRepo.updateSellerPasswordHash : authRepo.updateAgentPasswordHash;
  await updateFn(user.id, passwordHash);

  const clearTokenFn =
    role === 'seller'
      ? authRepo.clearSellerPasswordResetToken
      : authRepo.clearAgentPasswordResetToken;
  await clearTokenFn(user.id);

  await authRepo.invalidateUserSessions(user.id);

  await auditService.log({
    action: 'auth.password_reset_completed',
    entityType: role,
    entityId: user.id,
    details: {},
    actorType: role as 'seller' | 'agent',
    actorId: user.id,
  });
}

export async function sendVerificationEmail(sellerId: string, email: string): Promise<void> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await authRepo.setSellerEmailVerificationToken(sellerId, hashedToken, expiry);

  const appUrl = process.env.APP_URL || 'https://sellmyhomenow.sg';
  const verifyUrl = `${appUrl}/auth/verify-email/${rawToken}`;

  await sendSystemEmail(
    email,
    'Verify your SellMyHomeNow email address',
    `<p>Click the link below to verify your email address:</p>
<p><a href="${verifyUrl}">${verifyUrl}</a></p>
<p>This link expires in 24 hours.</p>
<p>If you did not register on SellMyHomeNow, please ignore this email.</p>`,
  );

  await auditService.log({
    action: 'auth.email_verification_sent',
    entityType: 'seller',
    entityId: sellerId,
    details: { email: maskEmail(email) },
    actorType: 'system' as const,
  });
}

export async function verifyEmail(rawToken: string): Promise<void> {
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const seller = await authRepo.findSellerByEmailVerificationToken(hashedToken);

  if (!seller) {
    throw new ValidationError('Invalid or expired verification link');
  }

  if (!seller.emailVerificationExpiry || seller.emailVerificationExpiry < new Date()) {
    throw new ValidationError('Invalid or expired verification link');
  }

  await authRepo.markSellerEmailVerified(seller.id);

  await auditService.log({
    action: 'auth.email_verified',
    entityType: 'seller',
    entityId: seller.id,
    details: {},
    actorType: 'seller' as const,
    actorId: seller.id,
  });
}

export async function resendVerificationEmail(sellerId: string): Promise<void> {
  const seller = await authRepo.findSellerById(sellerId);
  if (!seller) throw new ValidationError('Seller not found');
  if (!seller.email) throw new ValidationError('Seller email not found');

  await sendVerificationEmail(sellerId, seller.email);

  await auditService.log({
    action: 'auth.email_verification_resent',
    entityType: 'seller',
    entityId: sellerId,
    details: { email: maskEmail(seller.email) },
    actorType: 'seller' as const,
    actorId: sellerId,
  });
}

export async function sendAccountSetupEmail(
  sellerId: string,
  name: string,
  email: string,
): Promise<void> {
  const rawToken = crypto.randomBytes(64).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await authRepo.setSellerPasswordResetToken(sellerId, hashedToken, expiry);

  const appUrl = process.env.APP_URL || 'https://sellmyhomenow.sg';
  const setupUrl = `${appUrl}/auth/setup-account?token=${rawToken}`;

  await sendSystemEmail(
    email,
    'Set up your SellMyHomeNow account',
    `<p>Hi ${name},</p>
<p>Your agent has invited you to set up your SellMyHomeNow account. Click the link below to create your password and access your dashboard:</p>
<p><a href="${setupUrl}">${setupUrl}</a></p>
<p>This link expires in 24 hours.</p>
<p>If you did not expect this email, please ignore it.</p>`,
  );

  await auditService.log({
    action: 'lead.account_setup_sent',
    entityType: 'seller',
    entityId: sellerId,
    details: { email: maskEmail(email) },
    actorType: 'system' as const,
  });
}

// ─── Helpers ───────────────────────────────────────────────

async function getRecordForRole(userId: string, role: UserRole) {
  if (role === 'seller') {
    return authRepo.findSellerById(userId);
  }
  return authRepo.findAgentById(userId);
}
