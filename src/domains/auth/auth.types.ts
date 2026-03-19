export type UserRole = 'seller' | 'agent' | 'admin';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  email: string;
  name: string;
  twoFactorEnabled: boolean;
  twoFactorVerified: boolean;
}

export interface SellerRegistrationInput {
  name: string;
  email: string;
  phone: string;
  password: string;
  consentService: boolean;
  consentMarketing: boolean;
  consentHuttonsTransfer: boolean;
  ipAddress?: string;
  userAgent?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface TotpSetupResult {
  secret: string;
  otpAuthUrl: string;
  qrCodeDataUrl: string;
  backupCodes: string[];
}

export interface TotpVerifyInput {
  userId: string;
  role: UserRole;
  token: string;
}

export interface BackupCodeVerifyInput {
  userId: string;
  role: UserRole;
  code: string;
}

export interface PasswordResetRequestInput {
  email: string;
}

export interface PasswordResetInput {
  token: string;
  newPassword: string;
}

export interface LoginLockoutCheck {
  isLocked: boolean;
  lockedUntil: Date | null;
}
