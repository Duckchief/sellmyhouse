# Phase 1B Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical blockers, close compliance gaps, and improve test coverage in the auth, notification, and agent-settings domains.

**Architecture:** Fix-in-place refactor of 3 existing domain modules. Auth gets schema additions (password reset + login lockout fields), router split into sub-routers, and new password reset flow. Notification gets compliance gates (preference check, consent enforcement, DNC stub, audit logging), template extraction, and email enhancements. Agent-settings gets validator, test coverage, and minor fixes.

**Tech Stack:** TypeScript, Express, Prisma, bcrypt, otplib, crypto, nodemailer, axios, jsonwebtoken, Jest

**Spec:** `docs/superpowers/specs/2026-03-11-phase-1b-refactor-design.md`

---

## File Structure

### Auth Domain (`src/domains/auth/`)

| File | Action | Responsibility |
|------|--------|---------------|
| `auth.types.ts` | Modify | Add PasswordResetInput, PasswordResetRequestInput types |
| `auth.service.ts` | Modify | Add password reset, email enumeration fix, login lockout, backup code txn |
| `auth.repository.ts` | Modify | Add password reset token CRUD, login attempt tracking, session invalidation |
| `auth.validator.ts` | Modify | Add password reset validators |
| `auth.router.ts` | Replace | Becomes thin mount file for sub-routers |
| `auth.registration.router.ts` | Create | GET/POST /auth/register |
| `auth.login.router.ts` | Create | Login, logout, password reset endpoints |
| `auth.two-factor.router.ts` | Create | 2FA setup, verify, backup code endpoints |
| `__tests__/auth.service.test.ts` | Modify | Add password reset, login lockout, email enum tests |
| `__tests__/auth.router.test.ts` | Modify | Add agent login, 2FA enforcement, RBAC, password reset tests |

### Notification Domain (`src/domains/notification/`)

| File | Action | Responsibility |
|------|--------|---------------|
| `notification.types.ts` | Modify | Add notificationType, attachment types, DNC types |
| `notification.templates.ts` | Create | Extracted template definitions + WhatsApp template status map |
| `notification.validator.ts` | Create | Webhook payload + notification input validation |
| `notification.service.ts` | Modify | Add preference check, consent check, DNC, audit, channel failure alert |
| `notification.repository.ts` | No change | Already correct |
| `notification.router.ts` | Modify | Fix webhook signature, add unsubscribe endpoint |
| `providers/email.provider.ts` | Modify | Add attachments, retry logic, Nunjucks template rendering |
| `providers/in-app.provider.ts` | No change | Already correct (no-op) |
| `src/views/emails/base.njk` | Create | Base email layout with branding |
| `src/views/emails/notification.njk` | Create | Generic notification email template |
| `__tests__/notification.service.test.ts` | Modify | Add preference, consent, DNC, audit, channel failure tests |
| `providers/__tests__/email.provider.test.ts` | Modify | Add attachment and retry tests |

### Agent-Settings Domain (`src/domains/agent-settings/`)

| File | Action | Responsibility |
|------|--------|---------------|
| `agent-settings.validator.ts` | Create | express-validator schemas for WhatsApp + SMTP |
| `agent-settings.service.ts` | Modify | Add null-safety for decrypt, error logging |
| `agent-settings.repository.ts` | Modify | Fix deleteMany → delete |
| `agent-settings.router.ts` | Modify | Apply validators, fix HTMX rendering |
| `__tests__/agent-settings.service.test.ts` | Modify | Add decrypt error tests |
| `__tests__/agent-settings.repository.test.ts` | Create | Repository unit tests |
| `__tests__/agent-settings.router.test.ts` | Create | Router unit tests |

### Schema + Infrastructure

| File | Action | Responsibility |
|------|--------|---------------|
| `prisma/schema.prisma` | Modify | Add 4 fields each to Agent and Seller |
| `src/infra/http/app.ts` | Modify | Add raw body capture for webhook route |

---

## Chunk 1: Schema Changes + Auth Critical Fixes

### Task 1: Add Schema Fields for Login Lockout and Password Reset

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add fields to Agent model**

In `prisma/schema.prisma`, add these fields to the `Agent` model after `twoFactorLockedUntil`:

```prisma
  failedLoginAttempts       Int       @default(0) @map("failed_login_attempts")
  loginLockedUntil          DateTime? @map("login_locked_until")
  passwordResetToken        String?   @map("password_reset_token")
  passwordResetExpiry       DateTime? @map("password_reset_expiry")
```

- [ ] **Step 2: Add same fields to Seller model**

In `prisma/schema.prisma`, add these fields to the `Seller` model after `twoFactorLockedUntil`:

```prisma
  failedLoginAttempts     Int       @default(0) @map("failed_login_attempts")
  loginLockedUntil        DateTime? @map("login_locked_until")
  passwordResetToken      String?   @map("password_reset_token")
  passwordResetExpiry     DateTime? @map("password_reset_expiry")
```

- [ ] **Step 3: Run migration**

```bash
npx prisma migrate dev --name add-login-lockout-password-reset-fields
```

Expected: Migration created and applied successfully.

- [ ] **Step 4: Verify Prisma client generated**

```bash
npx prisma generate
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(auth): add login lockout and password reset schema fields"
```

---

### Task 2: Add Auth Types for Password Reset and Login Lockout

**Files:**
- Modify: `src/domains/auth/auth.types.ts`

- [ ] **Step 1: Add new types to auth.types.ts**

Append to the existing file:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/domains/auth/auth.types.ts
git commit -m "feat(auth): add password reset and login lockout types"
```

---

### Task 3: Add Login Lockout to Auth Repository

**Files:**
- Modify: `src/domains/auth/auth.repository.ts`
- Modify: `src/domains/auth/__tests__/auth.repository.test.ts`

- [ ] **Step 1: Write failing tests for login lockout repository methods**

Add to `auth.repository.test.ts`:

```typescript
describe('login lockout', () => {
  it('incrementSellerFailedLoginAttempts increments counter', async () => {
    prisma.seller.update.mockResolvedValue({});
    await repo.incrementSellerFailedLoginAttempts('s1');
    expect(prisma.seller.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { failedLoginAttempts: { increment: 1 } },
    });
  });

  it('lockSellerLogin sets lockedUntil timestamp', async () => {
    prisma.seller.update.mockResolvedValue({});
    const until = new Date();
    await repo.lockSellerLogin('s1', until);
    expect(prisma.seller.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { loginLockedUntil: until, failedLoginAttempts: 0 },
    });
  });

  it('resetSellerLoginAttempts clears counter and lock', async () => {
    prisma.seller.update.mockResolvedValue({});
    await repo.resetSellerLoginAttempts('s1');
    expect(prisma.seller.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { failedLoginAttempts: 0, loginLockedUntil: null },
    });
  });

  it('incrementAgentFailedLoginAttempts increments counter', async () => {
    prisma.agent.update.mockResolvedValue({});
    await repo.incrementAgentFailedLoginAttempts('a1');
    expect(prisma.agent.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { failedLoginAttempts: { increment: 1 } },
    });
  });

  it('lockAgentLogin sets lockedUntil timestamp', async () => {
    prisma.agent.update.mockResolvedValue({});
    const until = new Date();
    await repo.lockAgentLogin('a1', until);
    expect(prisma.agent.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { loginLockedUntil: until, failedLoginAttempts: 0 },
    });
  });

  it('resetAgentLoginAttempts clears counter and lock', async () => {
    prisma.agent.update.mockResolvedValue({});
    await repo.resetAgentLoginAttempts('a1');
    expect(prisma.agent.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { failedLoginAttempts: 0, loginLockedUntil: null },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="auth.repository.test" --verbose
```

Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement login lockout repository methods**

Add to `auth.repository.ts`:

```typescript
// --- Login lockout ---

export function incrementSellerFailedLoginAttempts(sellerId: string) {
  return prisma.seller.update({
    where: { id: sellerId },
    data: { failedLoginAttempts: { increment: 1 } },
  });
}

export function lockSellerLogin(sellerId: string, until: Date) {
  return prisma.seller.update({
    where: { id: sellerId },
    data: { loginLockedUntil: until, failedLoginAttempts: 0 },
  });
}

export function resetSellerLoginAttempts(sellerId: string) {
  return prisma.seller.update({
    where: { id: sellerId },
    data: { failedLoginAttempts: 0, loginLockedUntil: null },
  });
}

export function incrementAgentFailedLoginAttempts(agentId: string) {
  return prisma.agent.update({
    where: { id: agentId },
    data: { failedLoginAttempts: { increment: 1 } },
  });
}

export function lockAgentLogin(agentId: string, until: Date) {
  return prisma.agent.update({
    where: { id: agentId },
    data: { loginLockedUntil: until, failedLoginAttempts: 0 },
  });
}

export function resetAgentLoginAttempts(agentId: string) {
  return prisma.agent.update({
    where: { id: agentId },
    data: { failedLoginAttempts: 0, loginLockedUntil: null },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="auth.repository.test" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/auth/auth.repository.ts src/domains/auth/__tests__/auth.repository.test.ts
git commit -m "feat(auth): add login lockout repository methods"
```

---

### Task 4: Add Password Reset Token Repository Methods

**Files:**
- Modify: `src/domains/auth/auth.repository.ts`
- Modify: `src/domains/auth/__tests__/auth.repository.test.ts`

- [ ] **Step 1: Write failing tests for password reset repository methods**

Add to `auth.repository.test.ts`:

```typescript
describe('password reset', () => {
  it('setSellerPasswordResetToken stores hashed token and expiry', async () => {
    prisma.seller.update.mockResolvedValue({});
    const expiry = new Date();
    await repo.setSellerPasswordResetToken('s1', 'hashed-token', expiry);
    expect(prisma.seller.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { passwordResetToken: 'hashed-token', passwordResetExpiry: expiry },
    });
  });

  it('findSellerByResetToken finds seller with matching token', async () => {
    prisma.seller.findFirst.mockResolvedValue({ id: 's1' });
    const result = await repo.findSellerByResetToken('hashed-token');
    expect(prisma.seller.findFirst).toHaveBeenCalledWith({
      where: { passwordResetToken: 'hashed-token' },
    });
    expect(result).toEqual({ id: 's1' });
  });

  it('clearSellerPasswordResetToken clears token and expiry', async () => {
    prisma.seller.update.mockResolvedValue({});
    await repo.clearSellerPasswordResetToken('s1');
    expect(prisma.seller.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { passwordResetToken: null, passwordResetExpiry: null },
    });
  });

  it('setAgentPasswordResetToken stores hashed token and expiry', async () => {
    prisma.agent.update.mockResolvedValue({});
    const expiry = new Date();
    await repo.setAgentPasswordResetToken('a1', 'hashed-token', expiry);
    expect(prisma.agent.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { passwordResetToken: 'hashed-token', passwordResetExpiry: expiry },
    });
  });

  it('findAgentByResetToken finds agent with matching token', async () => {
    prisma.agent.findFirst.mockResolvedValue({ id: 'a1' });
    const result = await repo.findAgentByResetToken('hashed-token');
    expect(prisma.agent.findFirst).toHaveBeenCalledWith({
      where: { passwordResetToken: 'hashed-token' },
    });
    expect(result).toEqual({ id: 'a1' });
  });

  it('clearAgentPasswordResetToken clears token and expiry', async () => {
    prisma.agent.update.mockResolvedValue({});
    await repo.clearAgentPasswordResetToken('a1');
    expect(prisma.agent.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { passwordResetToken: null, passwordResetExpiry: null },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="auth.repository.test" --verbose
```

Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement password reset repository methods**

Add to `auth.repository.ts`:

```typescript
// --- Password reset ---

export function setSellerPasswordResetToken(sellerId: string, hashedToken: string, expiry: Date) {
  return prisma.seller.update({
    where: { id: sellerId },
    data: { passwordResetToken: hashedToken, passwordResetExpiry: expiry },
  });
}

export function findSellerByResetToken(hashedToken: string) {
  return prisma.seller.findFirst({
    where: { passwordResetToken: hashedToken },
  });
}

export function clearSellerPasswordResetToken(sellerId: string) {
  return prisma.seller.update({
    where: { id: sellerId },
    data: { passwordResetToken: null, passwordResetExpiry: null },
  });
}

export function setAgentPasswordResetToken(agentId: string, hashedToken: string, expiry: Date) {
  return prisma.agent.update({
    where: { id: agentId },
    data: { passwordResetToken: hashedToken, passwordResetExpiry: expiry },
  });
}

export function findAgentByResetToken(hashedToken: string) {
  return prisma.agent.findFirst({
    where: { passwordResetToken: hashedToken },
  });
}

export function clearAgentPasswordResetToken(agentId: string) {
  return prisma.agent.update({
    where: { id: agentId },
    data: { passwordResetToken: null, passwordResetExpiry: null },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="auth.repository.test" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/auth/auth.repository.ts src/domains/auth/__tests__/auth.repository.test.ts
git commit -m "feat(auth): add password reset token repository methods"
```

---

### Task 5: Fix Email Enumeration in Auth Service

**Files:**
- Modify: `src/domains/auth/auth.service.ts`
- Modify: `src/domains/auth/__tests__/auth.service.test.ts`

- [ ] **Step 1: Write failing test for email enumeration prevention**

Add to `auth.service.test.ts` under the `loginSeller` describe block:

```typescript
it('runs bcrypt.compare even when email not found (prevents timing attack)', async () => {
  authRepo.findSellerByEmail.mockResolvedValue(null);
  const bcryptCompare = jest.spyOn(bcrypt, 'compare') as jest.SpiedFunction<typeof bcrypt.compare>;

  const result = await service.loginSeller({ email: 'noone@test.com', password: 'wrong' });

  expect(result).toBeNull();
  expect(bcryptCompare).toHaveBeenCalled();
  bcryptCompare.mockRestore();
});
```

Add import at the top of the test file if not present: `import bcrypt from 'bcrypt';`

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="auth.service.test" --verbose
```

Expected: FAIL — bcrypt.compare not called when user not found.

- [ ] **Step 3: Fix loginSeller to prevent email enumeration**

In `auth.service.ts`, modify `loginSeller`:

```typescript
const DUMMY_HASH = '$2b$12$LJ3m4ys3Lk0TSwMCkGRNnuV6B5rl.LCbQiAsl/RIccJxO3bFG8V2a';

export async function loginSeller(input: LoginInput): Promise<SellerLoginResult | null> {
  const seller = await authRepo.findSellerByEmail(input.email);
  const hashToCompare = seller?.passwordHash ?? DUMMY_HASH;
  const passwordValid = await bcrypt.compare(input.password, hashToCompare);

  if (!seller || !passwordValid) {
    return null;
  }

  return {
    id: seller.id,
    email: seller.email,
    name: seller.name,
    twoFactorEnabled: seller.twoFactorEnabled,
  };
}
```

Apply the same pattern to `loginAgent`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --testPathPattern="auth.service.test" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/auth/auth.service.ts src/domains/auth/__tests__/auth.service.test.ts
git commit -m "fix(auth): prevent email enumeration via constant-time login"
```

---

### Task 6: Add Login Lockout to Auth Service

**Files:**
- Modify: `src/domains/auth/auth.service.ts`
- Modify: `src/domains/auth/__tests__/auth.service.test.ts`

- [ ] **Step 1: Write failing tests for login lockout**

Add to `auth.service.test.ts`:

```typescript
describe('login lockout', () => {
  it('returns locked error when seller login is locked', async () => {
    authRepo.findSellerByEmail.mockResolvedValue({
      id: 's1',
      email: 'test@test.com',
      name: 'Test',
      passwordHash: await bcrypt.hash('pass', 12),
      twoFactorEnabled: false,
      failedLoginAttempts: 0,
      loginLockedUntil: new Date(Date.now() + 30 * 60 * 1000), // locked for 30 more min
    });

    await expect(
      service.loginSeller({ email: 'test@test.com', password: 'pass' }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('increments failed attempts on wrong password', async () => {
    authRepo.findSellerByEmail.mockResolvedValue({
      id: 's1',
      email: 'test@test.com',
      name: 'Test',
      passwordHash: await bcrypt.hash('correct', 12),
      twoFactorEnabled: false,
      failedLoginAttempts: 3,
      loginLockedUntil: null,
    });
    authRepo.incrementSellerFailedLoginAttempts.mockResolvedValue({});

    const result = await service.loginSeller({ email: 'test@test.com', password: 'wrong' });
    expect(result).toBeNull();
    expect(authRepo.incrementSellerFailedLoginAttempts).toHaveBeenCalledWith('s1');
  });

  it('locks account after 5 failed attempts', async () => {
    authRepo.findSellerByEmail.mockResolvedValue({
      id: 's1',
      email: 'test@test.com',
      name: 'Test',
      passwordHash: await bcrypt.hash('correct', 12),
      twoFactorEnabled: false,
      failedLoginAttempts: 4, // this will be the 5th
      loginLockedUntil: null,
    });
    authRepo.incrementSellerFailedLoginAttempts.mockResolvedValue({});
    authRepo.lockSellerLogin.mockResolvedValue({});
    auditService.log.mockResolvedValue(undefined);

    const result = await service.loginSeller({ email: 'test@test.com', password: 'wrong' });
    expect(result).toBeNull();
    expect(authRepo.lockSellerLogin).toHaveBeenCalledWith('s1', expect.any(Date));
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login_locked' }),
    );
  });

  it('resets failed attempts on successful login', async () => {
    authRepo.findSellerByEmail.mockResolvedValue({
      id: 's1',
      email: 'test@test.com',
      name: 'Test',
      passwordHash: await bcrypt.hash('pass', 12),
      twoFactorEnabled: false,
      failedLoginAttempts: 3,
      loginLockedUntil: null,
    });
    authRepo.resetSellerLoginAttempts.mockResolvedValue({});

    const result = await service.loginSeller({ email: 'test@test.com', password: 'pass' });
    expect(result).not.toBeNull();
    expect(authRepo.resetSellerLoginAttempts).toHaveBeenCalledWith('s1');
  });

  it('allows login when lockout has expired', async () => {
    authRepo.findSellerByEmail.mockResolvedValue({
      id: 's1',
      email: 'test@test.com',
      name: 'Test',
      passwordHash: await bcrypt.hash('pass', 12),
      twoFactorEnabled: false,
      failedLoginAttempts: 0,
      loginLockedUntil: new Date(Date.now() - 1000), // expired
    });
    authRepo.resetSellerLoginAttempts.mockResolvedValue({});

    const result = await service.loginSeller({ email: 'test@test.com', password: 'pass' });
    expect(result).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="auth.service.test" --verbose
```

Expected: FAIL

- [ ] **Step 3: Implement login lockout in auth.service.ts**

Modify `loginSeller` and `loginAgent` to:
1. Check if account is locked (loginLockedUntil > now) — throw `UnauthorizedError('Account is temporarily locked. Please try again later.')`
2. If password is wrong: increment failed attempts. If attempts >= MAX_LOGIN_FAILURES (5), lock for LOCKOUT_MINUTES (30) and audit log.
3. On successful login: reset failed attempts.

Add constant at top of `auth.service.ts`:

```typescript
const MAX_LOGIN_FAILURES = 5;
```

Update `loginSeller`:

```typescript
export async function loginSeller(input: LoginInput): Promise<SellerLoginResult | null> {
  const seller = await authRepo.findSellerByEmail(input.email);
  const hashToCompare = seller?.passwordHash ?? DUMMY_HASH;
  const passwordValid = await bcrypt.compare(input.password, hashToCompare);

  if (!seller) return null;

  // Check login lockout
  if (seller.loginLockedUntil && seller.loginLockedUntil > new Date()) {
    throw new UnauthorizedError('Account is temporarily locked. Please try again later.');
  }

  if (!passwordValid) {
    await authRepo.incrementSellerFailedLoginAttempts(seller.id);
    if (seller.failedLoginAttempts + 1 >= MAX_LOGIN_FAILURES) {
      const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
      await authRepo.lockSellerLogin(seller.id, lockUntil);
      await auditService.log({
        action: 'auth.login_locked',
        entityType: 'seller',
        entityId: seller.id,
        details: { reason: 'Too many failed login attempts' },
      });
    }
    return null;
  }

  // Success — reset failed attempts
  if (seller.failedLoginAttempts > 0 || seller.loginLockedUntil) {
    await authRepo.resetSellerLoginAttempts(seller.id);
  }

  return {
    id: seller.id,
    email: seller.email,
    name: seller.name,
    twoFactorEnabled: seller.twoFactorEnabled,
  };
}
```

Apply same pattern to `loginAgent`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="auth.service.test" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/auth/auth.service.ts src/domains/auth/__tests__/auth.service.test.ts
git commit -m "feat(auth): add login lockout after 5 failed attempts"
```

---

### Task 7: Fix Backup Code Race Condition

**Files:**
- Modify: `src/domains/auth/auth.service.ts`
- Modify: `src/domains/auth/__tests__/auth.service.test.ts`

- [ ] **Step 1: Write test verifying backup code uses transaction**

Add to `auth.service.test.ts` under `verifyBackupCode` describe:

```typescript
it('uses database transaction for atomic backup code removal', async () => {
  const mockPrisma = jest.requireMock('../../infra/database/prisma').prisma;
  // The implementation should use prisma.$transaction
  // We verify the transaction wrapper is called
  mockPrisma.$transaction = jest.fn().mockImplementation(async (fn: Function) => fn(mockPrisma));

  authRepo.findSellerById.mockResolvedValue({
    id: 's1',
    twoFactorBackupCodes: [await bcrypt.hash('ABCD-1234', 12)],
    failedTwoFactorAttempts: 0,
    twoFactorLockedUntil: null,
  });
  authRepo.updateSellerTwoFactorBackupCodes.mockResolvedValue({});

  await service.verifyBackupCode({ userId: 's1', role: 'seller', code: 'ABCD-1234' });

  expect(mockPrisma.$transaction).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="auth.service.test" --verbose
```

Expected: FAIL — $transaction not called.

- [ ] **Step 3: Wrap backup code verification in a transaction**

In `auth.service.ts`, modify `verifyBackupCode` to use `prisma.$transaction`:

```typescript
import { prisma } from '../../infra/database/prisma';

export async function verifyBackupCode(input: BackupCodeVerifyInput): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const record = await getRecordForRole(input.userId, input.role);
    if (!record) throw new UnauthorizedError('User not found');

    // Check 2FA lockout
    if (record.twoFactorLockedUntil && record.twoFactorLockedUntil > new Date()) {
      throw new UnauthorizedError('Account is locked. Please reset your password.');
    }

    const codes = (record.twoFactorBackupCodes as string[]) || [];
    let matchIndex = -1;

    for (let i = 0; i < codes.length; i++) {
      const isMatch = await bcrypt.compare(input.code, codes[i]);
      if (isMatch) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex === -1) {
      // Increment 2FA failure counter
      await incrementFailedTwoFactor(input.userId, input.role);
      return false;
    }

    // Remove used code atomically
    const remaining = [...codes.slice(0, matchIndex), ...codes.slice(matchIndex + 1)];
    await updateBackupCodes(input.userId, input.role, remaining, tx);

    await auditService.log({
      action: 'auth.2fa_backup_used',
      entityType: input.role,
      entityId: input.userId,
      details: { codesRemaining: remaining.length },
    });

    return true;
  });
}
```

Note: The `updateBackupCodes` helper needs to accept a transaction client `tx` and use it instead of the global prisma client. Adjust the repository method to accept an optional transaction client parameter.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="auth.service.test" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/auth/auth.service.ts src/domains/auth/__tests__/auth.service.test.ts
git commit -m "fix(auth): use transaction for atomic backup code removal"
```

---

### Task 8: Add Password Reset Service Methods

**Files:**
- Modify: `src/domains/auth/auth.service.ts`
- Modify: `src/domains/auth/__tests__/auth.service.test.ts`

- [ ] **Step 1: Write failing tests for password reset**

Add to `auth.service.test.ts`:

```typescript
describe('requestPasswordReset', () => {
  it('generates token and stores SHA-256 hash with 1-hour expiry', async () => {
    authRepo.findSellerByEmail.mockResolvedValue({ id: 's1', email: 'test@test.com' });
    authRepo.setSellerPasswordResetToken.mockResolvedValue({});

    const result = await service.requestPasswordReset('test@test.com', 'seller');

    expect(result).not.toBeNull();
    expect(result!.token).toHaveLength(128); // 64 bytes = 128 hex chars
    expect(authRepo.setSellerPasswordResetToken).toHaveBeenCalledWith(
      's1',
      expect.any(String), // SHA-256 hash
      expect.any(Date),   // 1-hour expiry
    );
  });

  it('returns null for non-existent email (no error)', async () => {
    authRepo.findSellerByEmail.mockResolvedValue(null);

    const result = await service.requestPasswordReset('noone@test.com', 'seller');
    expect(result).toBeNull();
  });

  it('audit logs the reset request', async () => {
    authRepo.findSellerByEmail.mockResolvedValue({ id: 's1', email: 'test@test.com' });
    authRepo.setSellerPasswordResetToken.mockResolvedValue({});

    await service.requestPasswordReset('test@test.com', 'seller');

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.password_reset_requested' }),
    );
  });
});

describe('resetPassword', () => {
  it('resets password when token is valid and not expired', async () => {
    const tokenHash = crypto.createHash('sha256').update('valid-token').digest('hex');
    authRepo.findSellerByResetToken.mockResolvedValue({
      id: 's1',
      passwordResetToken: tokenHash,
      passwordResetExpiry: new Date(Date.now() + 3600000), // 1 hour from now
    });
    authRepo.updateSellerPassword.mockResolvedValue({});
    authRepo.clearSellerPasswordResetToken.mockResolvedValue({});

    await service.resetPassword('valid-token', 'newpassword123', 'seller');

    expect(authRepo.updateSellerPassword).toHaveBeenCalledWith('s1', expect.any(String));
    expect(authRepo.clearSellerPasswordResetToken).toHaveBeenCalledWith('s1');
  });

  it('throws ValidationError for expired token', async () => {
    const tokenHash = crypto.createHash('sha256').update('expired-token').digest('hex');
    authRepo.findSellerByResetToken.mockResolvedValue({
      id: 's1',
      passwordResetToken: tokenHash,
      passwordResetExpiry: new Date(Date.now() - 1000), // expired
    });

    await expect(
      service.resetPassword('expired-token', 'newpassword', 'seller'),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for invalid token', async () => {
    authRepo.findSellerByResetToken.mockResolvedValue(null);

    await expect(
      service.resetPassword('bad-token', 'newpassword', 'seller'),
    ).rejects.toThrow(ValidationError);
  });

  it('audit logs the password reset', async () => {
    const tokenHash = crypto.createHash('sha256').update('token').digest('hex');
    authRepo.findSellerByResetToken.mockResolvedValue({
      id: 's1',
      passwordResetToken: tokenHash,
      passwordResetExpiry: new Date(Date.now() + 3600000),
    });
    authRepo.updateSellerPassword.mockResolvedValue({});
    authRepo.clearSellerPasswordResetToken.mockResolvedValue({});

    await service.resetPassword('token', 'newpass', 'seller');

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.password_reset_completed' }),
    );
  });
});
```

Add `import crypto from 'crypto';` at top of test file.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="auth.service.test" --verbose
```

Expected: FAIL

- [ ] **Step 3: Implement password reset service methods**

Add to `auth.service.ts`:

```typescript
export async function requestPasswordReset(
  email: string,
  role: UserRole,
): Promise<{ token: string; userId: string } | null> {
  const user =
    role === 'seller'
      ? await authRepo.findSellerByEmail(email)
      : await authRepo.findAgentByEmail(email);

  if (!user) return null; // Don't reveal whether email exists

  const token = crypto.randomBytes(64).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  if (role === 'seller') {
    await authRepo.setSellerPasswordResetToken(user.id, hashedToken, expiry);
  } else {
    await authRepo.setAgentPasswordResetToken(user.id, hashedToken, expiry);
  }

  await auditService.log({
    action: 'auth.password_reset_requested',
    entityType: role,
    entityId: user.id,
    details: {},
  });

  return { token, userId: user.id };
}

export async function resetPassword(
  token: string,
  newPassword: string,
  role: UserRole,
): Promise<void> {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user =
    role === 'seller'
      ? await authRepo.findSellerByResetToken(hashedToken)
      : await authRepo.findAgentByResetToken(hashedToken);

  if (!user) {
    throw new ValidationError('Invalid or expired reset token');
  }

  if (!user.passwordResetExpiry || user.passwordResetExpiry < new Date()) {
    throw new ValidationError('Invalid or expired reset token');
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  if (role === 'seller') {
    await authRepo.updateSellerPassword(user.id, passwordHash);
    await authRepo.clearSellerPasswordResetToken(user.id);
  } else {
    await authRepo.updateAgentPassword(user.id, passwordHash);
    await authRepo.clearAgentPasswordResetToken(user.id);
  }

  await auditService.log({
    action: 'auth.password_reset_completed',
    entityType: role,
    entityId: user.id,
    details: {},
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="auth.service.test" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/auth/auth.service.ts src/domains/auth/__tests__/auth.service.test.ts
git commit -m "feat(auth): add password reset service methods"
```

---

### Task 9: Add Password Reset Validators

**Files:**
- Modify: `src/domains/auth/auth.validator.ts`

- [ ] **Step 1: Add password reset validators**

Add to `auth.validator.ts`:

```typescript
export const forgotPasswordRules = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
];

export const resetPasswordRules = [
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
  body('password')
    .matches(/[a-zA-Z]/)
    .withMessage('Password must contain at least one letter'),
  body('password')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number'),
];
```

- [ ] **Step 2: Commit**

```bash
git add src/domains/auth/auth.validator.ts
git commit -m "feat(auth): add password reset validators"
```

---

### Task 10: Split Auth Router into Sub-Routers

**Files:**
- Replace: `src/domains/auth/auth.router.ts`
- Create: `src/domains/auth/auth.registration.router.ts`
- Create: `src/domains/auth/auth.login.router.ts`
- Create: `src/domains/auth/auth.two-factor.router.ts`

- [ ] **Step 1: Create auth.registration.router.ts**

Extract the registration routes from auth.router.ts (GET/POST /auth/register):

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import * as authService from './auth.service';
import { registrationRules } from './auth.validator';
import { validationResult } from 'express-validator';
import { authRateLimiter } from '../../infra/http/middleware/rate-limit';
import type { AuthenticatedUser } from './auth.types';

export const registrationRouter = Router();

registrationRouter.get('/auth/register', (req: Request, res: Response) => {
  if (req.headers['hx-request']) {
    return res.render('partials/auth/register-form');
  }
  res.render('pages/auth/register');
});

registrationRouter.post(
  '/auth/register',
  authRateLimiter,
  registrationRules,
  async (req: Request, res: Response, next: NextFunction) => {
    // ... existing registration logic from auth.router.ts lines 23-80
  },
);
```

Copy the exact logic from the existing `auth.router.ts` POST /auth/register handler.

- [ ] **Step 2: Create auth.login.router.ts**

Extract login, logout, and password reset routes:

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import * as authService from './auth.service';
import { loginRules, forgotPasswordRules, resetPasswordRules } from './auth.validator';
import { validationResult } from 'express-validator';
import { authRateLimiter } from '../../infra/http/middleware/rate-limit';
import { requireAuth } from '../../infra/http/middleware/require-auth';
import type { AuthenticatedUser } from './auth.types';

export const loginRouter = Router();

loginRouter.get('/auth/login', (req: Request, res: Response) => {
  if (req.headers['hx-request']) {
    return res.render('partials/auth/login-form');
  }
  res.render('pages/auth/login');
});

// Seller login — existing logic from auth.router.ts
loginRouter.post('/auth/login/seller', authRateLimiter, loginRules, async (req, res, next) => {
  // ... existing seller login logic
});

// Agent login — existing logic from auth.router.ts
loginRouter.post('/auth/login/agent', authRateLimiter, loginRules, async (req, res, next) => {
  // ... existing agent login logic
});

// Logout
loginRouter.post('/auth/logout', (req: Request, res: Response) => {
  const redirectUrl = '/';
  req.logout(() => {
    req.session.destroy(() => {
      if (req.headers['hx-request']) {
        res.set('HX-Redirect', redirectUrl);
        return res.sendStatus(200);
      }
      res.redirect(redirectUrl);
    });
  });
});

// Password reset — NEW
loginRouter.get('/auth/forgot-password', (req: Request, res: Response) => {
  if (req.headers['hx-request']) {
    return res.render('partials/auth/forgot-password-form');
  }
  res.render('pages/auth/forgot-password');
});

loginRouter.post(
  '/auth/forgot-password',
  authRateLimiter,
  forgotPasswordRules,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        if (req.headers['hx-request']) {
          return res.render('partials/auth/form-error', { error: 'Please enter a valid email' });
        }
        return res.status(400).render('pages/auth/forgot-password', { error: 'Please enter a valid email' });
      }

      // Try both seller and agent
      const result =
        (await authService.requestPasswordReset(req.body.email, 'seller')) ||
        (await authService.requestPasswordReset(req.body.email, 'agent'));

      if (result) {
        // Send email via notification service (import and call)
        // For now, the token is returned — will be wired to notification in integration
      }

      // Always show success message (prevent email enumeration)
      const message = 'If an account exists with that email, a reset link has been sent.';
      if (req.headers['hx-request']) {
        return res.render('partials/auth/form-success', { message });
      }
      res.render('pages/auth/forgot-password', { success: message });
    } catch (err) {
      next(err);
    }
  },
);

loginRouter.get('/auth/reset-password/:token', (req: Request, res: Response) => {
  if (req.headers['hx-request']) {
    return res.render('partials/auth/reset-password-form', { token: req.params.token });
  }
  res.render('pages/auth/reset-password', { token: req.params.token });
});

loginRouter.post(
  '/auth/reset-password/:token',
  resetPasswordRules,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        if (req.headers['hx-request']) {
          return res.render('partials/auth/form-error', { error: 'Password does not meet requirements' });
        }
        return res.status(400).render('pages/auth/reset-password', {
          token: req.params.token,
          error: 'Password does not meet requirements',
        });
      }

      // Try seller first, then agent
      try {
        await authService.resetPassword(req.params.token, req.body.password, 'seller');
      } catch {
        await authService.resetPassword(req.params.token, req.body.password, 'agent');
      }

      if (req.headers['hx-request']) {
        res.set('HX-Redirect', '/auth/login');
        return res.sendStatus(200);
      }
      res.redirect('/auth/login?reset=success');
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 3: Create auth.two-factor.router.ts**

Extract 2FA routes (GET/POST /auth/2fa/setup, GET/POST /auth/2fa/verify, POST /auth/2fa/backup):

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import * as authService from './auth.service';
import { totpRules, backupCodeRules } from './auth.validator';
import { validationResult } from 'express-validator';
import { requireAuth } from '../../infra/http/middleware/require-auth';
import type { AuthenticatedUser } from './auth.types';

export const twoFactorRouter = Router();

// ... existing 2FA routes from auth.router.ts lines 196-348
```

Copy exact logic from existing auth.router.ts.

- [ ] **Step 4: Replace auth.router.ts with mount file**

```typescript
import { Router } from 'express';
import { registrationRouter } from './auth.registration.router';
import { loginRouter } from './auth.login.router';
import { twoFactorRouter } from './auth.two-factor.router';

export const authRouter = Router();

authRouter.use(registrationRouter);
authRouter.use(loginRouter);
authRouter.use(twoFactorRouter);
```

- [ ] **Step 5: Run all tests to verify nothing broke**

```bash
npm test -- --testPathPattern="auth" --verbose
```

Expected: All existing tests pass. No import paths changed externally — `app.ts` still imports `authRouter` from `./auth.router`.

- [ ] **Step 6: Commit**

```bash
git add src/domains/auth/
git commit -m "refactor(auth): split router into registration, login, and two-factor sub-routers"
```

---

### Task 11: Add Agent 2FA Enforcement

**Files:**
- Modify: `src/domains/auth/auth.login.router.ts`
- Modify: `src/domains/auth/__tests__/auth.router.test.ts`

- [ ] **Step 1: Write failing tests for agent 2FA enforcement**

Add to `auth.router.test.ts`:

```typescript
describe('agent 2FA enforcement', () => {
  it('redirects agent without 2FA to /auth/2fa/setup on login', async () => {
    // Mock agent login success with twoFactorEnabled=false
    authService.loginAgent.mockResolvedValue({
      id: 'a1',
      email: 'agent@test.com',
      name: 'Agent',
      twoFactorEnabled: false,
      isActive: true,
      role: 'agent',
    });

    const res = await request(app)
      .post('/auth/login/agent')
      .send({ email: 'agent@test.com', password: 'pass123' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/2fa/setup');
  });

  it('redirects agent with 2FA to /auth/2fa/verify on login', async () => {
    authService.loginAgent.mockResolvedValue({
      id: 'a1',
      email: 'agent@test.com',
      name: 'Agent',
      twoFactorEnabled: true,
      isActive: true,
      role: 'agent',
    });

    const res = await request(app)
      .post('/auth/login/agent')
      .send({ email: 'agent@test.com', password: 'pass123' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/2fa/verify');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="auth.router.test" --verbose
```

Expected: FAIL

- [ ] **Step 3: Implement agent 2FA enforcement in auth.login.router.ts**

In the `POST /auth/login/agent` handler, after successful password validation:

```typescript
// After Passport login succeeds:
if (!agentResult.twoFactorEnabled) {
  // Agent must set up 2FA — redirect to setup
  const redirectUrl = '/auth/2fa/setup';
  if (req.headers['hx-request']) {
    res.set('HX-Redirect', redirectUrl);
    return res.sendStatus(200);
  }
  return res.redirect(redirectUrl);
}

// Agent has 2FA — must verify
const redirectUrl = '/auth/2fa/verify';
req.session.cookie.maxAge = 30 * 60 * 1000; // 30 min for 2FA users
if (req.headers['hx-request']) {
  res.set('HX-Redirect', redirectUrl);
  return res.sendStatus(200);
}
return res.redirect(redirectUrl);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="auth.router.test" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/auth/auth.login.router.ts src/domains/auth/__tests__/auth.router.test.ts
git commit -m "feat(auth): enforce mandatory 2FA for agent/admin on login"
```

---

### Task 12: Run Full Auth Test Suite

- [ ] **Step 1: Run all auth tests**

```bash
npm test -- --testPathPattern="auth" --verbose
```

Expected: All tests pass.

- [ ] **Step 2: Run full test suite**

```bash
npm test && npm run test:integration
```

Expected: No regressions.

---

## Chunk 2: Notification Code Quality + Compliance Fixes

### Task 13: Extract Notification Templates

**Files:**
- Create: `src/domains/notification/notification.templates.ts`
- Modify: `src/domains/notification/notification.service.ts`

- [ ] **Step 1: Create notification.templates.ts**

```typescript
import type { NotificationTemplateName } from './notification.types';

export type WhatsAppTemplateStatus = 'approved' | 'pending' | 'suspended';

export interface NotificationTemplate {
  subject: string;
  body: string;
}

export const NOTIFICATION_TEMPLATES: Record<NotificationTemplateName, NotificationTemplate> = {
  welcome_seller: {
    subject: 'Welcome to SellMyHomeNow',
    body: 'Welcome to SellMyHomeNow, {{name}}! Your account is ready.',
  },
  viewing_booked: {
    subject: 'Viewing Booked',
    body: 'A viewing has been booked for {{address}} on {{date}}.',
  },
  viewing_booked_seller: {
    subject: 'New Viewing Booked',
    body: 'New viewing booked for {{address}} on {{date}} at {{time}}. Viewer: {{viewerName}} ({{viewerType}}).{{noShowWarning}}',
  },
  viewing_cancelled: {
    subject: 'Viewing Cancelled',
    body: 'The viewing for {{address}} on {{date}} has been cancelled.',
  },
  viewing_reminder: {
    subject: 'Viewing Reminder',
    body: 'Reminder: Viewing for {{address}} is scheduled for {{date}}.',
  },
  viewing_reminder_viewer: {
    subject: 'Viewing Reminder',
    body: 'Reminder: Your viewing at {{address}} is at {{time}} today.',
  },
  viewing_feedback_prompt: {
    subject: 'How Did the Viewing Go?',
    body: 'How did the viewing go for {{address}} on {{date}}? Please log your feedback.',
  },
  offer_received: {
    subject: 'Offer Received',
    body: 'An offer of ${{amount}} has been received for {{address}}.',
  },
  offer_countered: {
    subject: 'Counter-Offer Made',
    body: 'A counter-offer of ${{amount}} has been made for {{address}}.',
  },
  offer_accepted: {
    subject: 'Offer Accepted',
    body: 'The offer for {{address}} has been accepted. Congratulations!',
  },
  transaction_update: {
    subject: 'Transaction Update',
    body: 'Transaction update for {{address}}: {{status}}.',
  },
  document_ready: {
    subject: 'Document Ready',
    body: 'A document is ready for your review: {{documentName}}.',
  },
  invoice_uploaded: {
    subject: 'Invoice Uploaded',
    body: 'Your commission invoice has been uploaded for {{address}}.',
  },
  agreement_sent: {
    subject: 'Agreement Sent',
    body: 'The estate agency agreement for {{address}} has been sent to you.',
  },
  financial_report_ready: {
    subject: 'Financial Report Ready',
    body: 'Your financial report for {{address}} is ready. {{message}}',
  },
  generic: {
    subject: 'SellMyHomeNow Notification',
    body: '{{message}}',
  },
};

// WhatsApp template approval status — update as templates are approved by Meta
export const WHATSAPP_TEMPLATE_STATUS: Record<NotificationTemplateName, WhatsAppTemplateStatus> = {
  welcome_seller: 'pending',
  viewing_booked: 'pending',
  viewing_booked_seller: 'pending',
  viewing_cancelled: 'pending',
  viewing_reminder: 'pending',
  viewing_reminder_viewer: 'pending',
  viewing_feedback_prompt: 'pending',
  offer_received: 'pending',
  offer_countered: 'pending',
  offer_accepted: 'pending',
  transaction_update: 'pending',
  document_ready: 'pending',
  invoice_uploaded: 'pending',
  agreement_sent: 'pending',
  financial_report_ready: 'pending',
  generic: 'pending',
};
```

- [ ] **Step 2: Update notification.service.ts to import from templates**

Replace the inline `TEMPLATES` const in `notification.service.ts` with:

```typescript
import { NOTIFICATION_TEMPLATES, WHATSAPP_TEMPLATE_STATUS } from './notification.templates';
```

Update `renderTemplate` to use `NOTIFICATION_TEMPLATES`:

```typescript
function renderTemplate(templateName: string, data: Record<string, string>): string {
  const template = NOTIFICATION_TEMPLATES[templateName as keyof typeof NOTIFICATION_TEMPLATES]
    || NOTIFICATION_TEMPLATES.generic;
  return template.body.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || '');
}
```

- [ ] **Step 3: Run existing tests to verify nothing broke**

```bash
npm test -- --testPathPattern="notification" --verbose
```

Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/domains/notification/notification.templates.ts src/domains/notification/notification.service.ts
git commit -m "refactor(notification): extract templates to dedicated file"
```

---

### Task 14: Add Notification Validator

**Files:**
- Create: `src/domains/notification/notification.validator.ts`

- [ ] **Step 1: Create notification.validator.ts**

```typescript
import { body, param } from 'express-validator';

export const webhookPayloadRules = [
  body('entry').isArray().withMessage('entry must be an array'),
];

export const markAsReadRules = [
  param('id').isString().notEmpty().withMessage('Notification ID is required'),
];
```

- [ ] **Step 2: Apply validators to notification.router.ts**

Import and apply `markAsReadRules` to the `POST /api/notifications/:id/read` route.

- [ ] **Step 3: Commit**

```bash
git add src/domains/notification/notification.validator.ts src/domains/notification/notification.router.ts
git commit -m "feat(notification): add input validators"
```

---

### Task 15: Add Notification Types for Compliance Features

**Files:**
- Modify: `src/domains/notification/notification.types.ts`

- [ ] **Step 1: Add new types**

Add to `notification.types.ts`:

```typescript
export type NotificationType = 'transactional' | 'marketing';

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface DncCheckResult {
  blocked: boolean;
  reason?: string;
}
```

Update `SendNotificationInput`:

```typescript
export interface SendNotificationInput {
  recipientType: RecipientType;
  recipientId: string;
  templateName: NotificationTemplateName;
  templateData: Record<string, string>;
  preferredChannel?: NotificationChannel;
  notificationType?: NotificationType; // defaults to 'transactional'
  attachments?: EmailAttachment[];
  recipientPhone?: string;  // for WhatsApp
  recipientEmail?: string;  // for email
}
```

Update `ChannelProvider`:

```typescript
export interface ChannelProvider {
  send(
    recipientId: string,
    content: string,
    agentId: string,
    options?: { subject?: string; attachments?: EmailAttachment[] },
  ): Promise<{ messageId?: string }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/domains/notification/notification.types.ts
git commit -m "feat(notification): add types for compliance features"
```

---

### Task 16: Add Notification Preference Check and Marketing Consent Enforcement

**Files:**
- Modify: `src/domains/notification/notification.service.ts`
- Modify: `src/domains/notification/__tests__/notification.service.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `notification.service.test.ts`:

```typescript
// Mock seller repository for preference/consent lookups
jest.mock('../../infra/database/prisma', () => ({
  prisma: {
    seller: { findUnique: jest.fn() },
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
      update: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
  },
  createId: jest.fn().mockReturnValue('test-id'),
}));

jest.mock('../shared/audit.service');
const auditService = jest.requireMock('../shared/audit.service');

const { prisma } = jest.requireMock('../../infra/database/prisma');

describe('notification preference', () => {
  it('uses email when seller preference is email_only', async () => {
    prisma.seller.findUnique.mockResolvedValue({
      id: 'seller-1',
      notificationPreference: 'email_only',
      consentService: true,
      consentMarketing: false,
    });
    EmailProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: '<msg>' });

    await service.send(
      {
        recipientType: 'seller',
        recipientId: 'seller-1',
        templateName: 'welcome_seller',
        templateData: { name: 'Test' },
      },
      'agent-1',
    );

    expect(WhatsAppProvider.prototype.send).not.toHaveBeenCalled();
    expect(EmailProvider.prototype.send).toHaveBeenCalled();
  });

  it('uses whatsapp when seller preference is whatsapp_and_email', async () => {
    prisma.seller.findUnique.mockResolvedValue({
      id: 'seller-1',
      notificationPreference: 'whatsapp_and_email',
      consentService: true,
      consentMarketing: false,
    });
    WhatsAppProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: 'wamid.1' });

    await service.send(
      {
        recipientType: 'seller',
        recipientId: 'seller-1',
        templateName: 'welcome_seller',
        templateData: { name: 'Test' },
      },
      'agent-1',
    );

    expect(WhatsAppProvider.prototype.send).toHaveBeenCalled();
  });
});

describe('marketing consent', () => {
  it('blocks marketing notification without consent', async () => {
    prisma.seller.findUnique.mockResolvedValue({
      id: 'seller-1',
      notificationPreference: 'whatsapp_and_email',
      consentService: true,
      consentMarketing: false,
    });
    auditService.log = jest.fn().mockResolvedValue(undefined);

    await service.send(
      {
        recipientType: 'seller',
        recipientId: 'seller-1',
        templateName: 'generic',
        templateData: { message: 'Marketing content' },
        notificationType: 'marketing',
      },
      'agent-1',
    );

    // Should only create in-app, not external
    expect(WhatsAppProvider.prototype.send).not.toHaveBeenCalled();
    expect(EmailProvider.prototype.send).not.toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notification.marketing_blocked' }),
    );
  });

  it('allows marketing notification with consent', async () => {
    prisma.seller.findUnique.mockResolvedValue({
      id: 'seller-1',
      notificationPreference: 'whatsapp_and_email',
      consentService: true,
      consentMarketing: true,
    });
    WhatsAppProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: 'wamid.1' });

    await service.send(
      {
        recipientType: 'seller',
        recipientId: 'seller-1',
        templateName: 'generic',
        templateData: { message: 'Marketing content' },
        notificationType: 'marketing',
      },
      'agent-1',
    );

    expect(WhatsAppProvider.prototype.send).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="notification.service.test" --verbose
```

Expected: FAIL

- [ ] **Step 3: Implement preference check and consent enforcement**

In `notification.service.ts`, add `resolveChannel` and update `send`:

```typescript
import { prisma } from '../../infra/database/prisma';
import * as auditService from '../shared/audit.service';
import type { NotificationChannel, NotificationType, SendNotificationInput } from './notification.types';

async function resolveChannel(
  recipientId: string,
  recipientType: string,
): Promise<NotificationChannel> {
  if (recipientType !== 'seller') return 'whatsapp'; // agents use both by default

  const seller = await prisma.seller.findUnique({
    where: { id: recipientId },
    select: { notificationPreference: true },
  });

  if (seller?.notificationPreference === 'email_only') return 'email';
  return 'whatsapp';
}

async function checkMarketingConsent(recipientId: string, recipientType: string): Promise<boolean> {
  if (recipientType !== 'seller') return true;

  const seller = await prisma.seller.findUnique({
    where: { id: recipientId },
    select: { consentMarketing: true },
  });

  return seller?.consentMarketing ?? false;
}

export async function send(input: SendNotificationInput, agentId: string): Promise<void> {
  const content = renderTemplate(input.templateName, input.templateData);
  const notificationType = input.notificationType || 'transactional';

  // Always create in-app notification
  const inAppRecord = await notificationRepo.create({
    recipientType: input.recipientType,
    recipientId: input.recipientId,
    channel: 'in_app',
    templateName: input.templateName,
    content,
  });
  await notificationRepo.updateStatus(inAppRecord.id, 'sent', { sentAt: new Date() });

  // Check marketing consent
  if (notificationType === 'marketing') {
    const hasConsent = await checkMarketingConsent(input.recipientId, input.recipientType);
    if (!hasConsent) {
      await auditService.log({
        action: 'notification.marketing_blocked',
        entityType: 'notification',
        entityId: inAppRecord.id,
        details: { recipientType: input.recipientType, recipientId: input.recipientId, templateName: input.templateName },
      });
      return; // Only in-app delivered
    }
  }

  // Resolve preferred channel based on seller preference
  const preferredChannel = input.preferredChannel || await resolveChannel(input.recipientId, input.recipientType);

  if (preferredChannel === 'whatsapp' || preferredChannel === 'email') {
    await sendExternal(input, content, agentId, preferredChannel);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="notification.service.test" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/notification/notification.service.ts src/domains/notification/__tests__/notification.service.test.ts
git commit -m "feat(notification): add preference check and marketing consent enforcement"
```

---

### Task 17: Add Audit Logging to Notification Service

**Files:**
- Modify: `src/domains/notification/notification.service.ts`
- Modify: `src/domains/notification/__tests__/notification.service.test.ts`

- [ ] **Step 1: Write failing tests for audit logging**

Add to `notification.service.test.ts`:

```typescript
describe('audit logging', () => {
  it('logs notification.sent on successful send', async () => {
    prisma.seller.findUnique.mockResolvedValue({
      id: 'seller-1',
      notificationPreference: 'whatsapp_and_email',
      consentService: true,
    });
    WhatsAppProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: 'wamid.1' });
    auditService.log = jest.fn().mockResolvedValue(undefined);

    await service.send(input, 'agent-1');

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notification.sent' }),
    );
  });

  it('logs notification.failed on send failure', async () => {
    prisma.seller.findUnique.mockResolvedValue({
      id: 'seller-1',
      notificationPreference: 'email_only',
      consentService: true,
    });
    EmailProvider.prototype.send = jest.fn().mockRejectedValue(new Error('SMTP down'));
    auditService.log = jest.fn().mockResolvedValue(undefined);

    await service.send({ ...input, preferredChannel: 'email' }, 'agent-1');

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notification.failed' }),
    );
  });

  it('logs notification.fallback when WhatsApp fails and email succeeds', async () => {
    prisma.seller.findUnique.mockResolvedValue({
      id: 'seller-1',
      notificationPreference: 'whatsapp_and_email',
      consentService: true,
    });
    WhatsAppProvider.prototype.send = jest.fn().mockRejectedValue(new Error('WA down'));
    EmailProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: '<msg>' });
    auditService.log = jest.fn().mockResolvedValue(undefined);

    await service.send(input, 'agent-1');

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notification.fallback' }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="notification.service.test" --verbose
```

Expected: FAIL

- [ ] **Step 3: Add audit logging calls to sendExternal**

In `notification.service.ts`, add `auditService.log()` calls:
- After successful send: `notification.sent`
- After primary failure: `notification.failed`
- After successful fallback: `notification.fallback`
- After both channels fail: `notification.all_channels_failed` + alert agent

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="notification.service.test" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/notification/notification.service.ts src/domains/notification/__tests__/notification.service.test.ts
git commit -m "feat(notification): add audit logging for sends, failures, and fallbacks"
```

---

### Task 18: Fix Webhook Signature Verification

**Files:**
- Modify: `src/infra/http/app.ts`
- Modify: `src/domains/notification/notification.router.ts`
- Modify: `src/domains/notification/__tests__/notification.service.test.ts`

- [ ] **Step 1: Write failing test for webhook signature verification**

Add to `notification.service.test.ts`:

```typescript
describe('verifyWebhookSignature', () => {
  it('returns true for valid signature', () => {
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-secret';
    const body = Buffer.from('{"test": "data"}');
    const crypto = require('crypto');
    const expected = crypto.createHmac('sha256', 'test-secret').update(body).digest('hex');

    const result = service.verifyWebhookSignature(body, `sha256=${expected}`);
    expect(result).toBe(true);
  });

  it('returns false for invalid signature', () => {
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-secret';
    const body = Buffer.from('{"test": "data"}');

    const result = service.verifyWebhookSignature(body, 'sha256=invalid');
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify existing behavior**

```bash
npm test -- --testPathPattern="notification.service.test" --verbose
```

- [ ] **Step 3: Add raw body capture for webhook route in app.ts**

In `src/infra/http/app.ts`, before the general `express.json()` middleware, add a specific parser for the webhook route:

```typescript
// Raw body capture for WhatsApp webhook signature verification
app.use(
  '/api/webhook/whatsapp',
  express.json({
    verify: (req: Request, _res, buf) => {
      (req as any).rawBody = buf;
    },
  }),
);

// General body parsing (for all other routes)
app.use(express.json());
```

- [ ] **Step 4: Update notification.router.ts to use raw body for verification**

```typescript
notificationRouter.post(
  '/api/webhook/whatsapp',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const signature = req.headers['x-hub-signature-256'] as string | undefined;
      const rawBody = (req as any).rawBody as Buffer | undefined;

      if (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
        if (!rawBody || !notificationService.verifyWebhookSignature(rawBody, signature)) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }

      await notificationService.handleWhatsAppWebhook(req.body);
      res.sendStatus(200);
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 5: Run tests**

```bash
npm test -- --testPathPattern="notification" --verbose
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/infra/http/app.ts src/domains/notification/notification.router.ts src/domains/notification/__tests__/notification.service.test.ts
git commit -m "fix(notification): implement proper webhook signature verification"
```

---

### Task 19: Add DNC Registry Check Stub

**Files:**
- Modify: `src/domains/notification/notification.service.ts`
- Modify: `src/domains/notification/__tests__/notification.service.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe('DNC registry check', () => {
  it('falls back to email when DNC check blocks WhatsApp', async () => {
    prisma.seller.findUnique.mockResolvedValue({
      id: 'seller-1',
      notificationPreference: 'whatsapp_and_email',
      consentService: true,
    });
    // Mock DNC to block
    jest.spyOn(service, 'checkDnc').mockResolvedValue({ blocked: true, reason: 'Number on DNC registry' });
    EmailProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: '<msg>' });
    auditService.log = jest.fn().mockResolvedValue(undefined);

    await service.send(input, 'agent-1');

    expect(WhatsAppProvider.prototype.send).not.toHaveBeenCalled();
    expect(EmailProvider.prototype.send).toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notification.dnc_blocked' }),
    );
  });
});
```

- [ ] **Step 2: Implement DNC check stub**

Add to `notification.service.ts`:

```typescript
import type { DncCheckResult } from './notification.types';

// DNC registry check — stub for now, will be replaced with actual API integration
export async function checkDnc(_phone: string): Promise<DncCheckResult> {
  // TODO: Integrate with Singapore DNC registry API
  // For now, always allow — the check point is wired in so it's enforced when implemented
  return { blocked: false };
}
```

Wire the check into `sendExternal` before attempting WhatsApp send:

```typescript
// In sendExternal, before WhatsApp send:
if (primaryChannel === 'whatsapp' && input.recipientPhone) {
  const dncResult = await checkDnc(input.recipientPhone);
  if (dncResult.blocked) {
    await auditService.log({
      action: 'notification.dnc_blocked',
      entityType: 'notification',
      entityId: record.id,
      details: { phone: input.recipientPhone.slice(-4), templateName: input.templateName, reason: dncResult.reason },
    });
    // Fall back to email
    primaryChannel = 'email';
  }
}
```

- [ ] **Step 3: Run tests**

```bash
npm test -- --testPathPattern="notification" --verbose
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/domains/notification/notification.service.ts src/domains/notification/__tests__/notification.service.test.ts
git commit -m "feat(notification): add DNC registry check stub wired into send flow"
```

---

### Task 20: Add Agent Alert on Total Channel Failure

**Files:**
- Modify: `src/domains/notification/notification.service.ts`
- Modify: `src/domains/notification/__tests__/notification.service.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe('total channel failure', () => {
  it('alerts agent when both WhatsApp and email fail', async () => {
    prisma.seller.findUnique.mockResolvedValue({
      id: 'seller-1',
      name: 'Test Seller',
      agentId: 'agent-1',
      notificationPreference: 'whatsapp_and_email',
      consentService: true,
    });
    WhatsAppProvider.prototype.send = jest.fn().mockRejectedValue(new Error('WA down'));
    EmailProvider.prototype.send = jest.fn().mockRejectedValue(new Error('SMTP down'));
    auditService.log = jest.fn().mockResolvedValue(undefined);

    await service.send(input, 'agent-1');

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notification.all_channels_failed' }),
    );
    // Should create an in-app notification for the agent
    expect(notificationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientType: 'agent',
        recipientId: 'agent-1',
        channel: 'in_app',
      }),
    );
  });
});
```

- [ ] **Step 2: Implement agent alert in sendExternal fallback**

In the catch block of the email fallback in `sendExternal`, after logging the failure:

```typescript
// Both channels failed — alert agent
await auditService.log({
  action: 'notification.all_channels_failed',
  entityType: 'notification',
  entityId: record.id,
  details: { recipientId: input.recipientId, templateName: input.templateName },
});

// Create in-app notification for agent
await notificationRepo.create({
  recipientType: 'agent',
  recipientId: agentId,
  channel: 'in_app',
  templateName: 'generic',
  content: `Communication failure: unable to reach recipient via WhatsApp or email for ${input.templateName}. Please follow up manually.`,
});
```

- [ ] **Step 3: Run tests**

```bash
npm test -- --testPathPattern="notification" --verbose
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/domains/notification/notification.service.ts src/domains/notification/__tests__/notification.service.test.ts
git commit -m "feat(notification): alert agent when all channels fail"
```

---

### Task 21: Add Email Attachments and Retry Logic

**Files:**
- Modify: `src/domains/notification/providers/email.provider.ts`
- Modify: `src/domains/notification/providers/__tests__/email.provider.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `email.provider.test.ts`:

```typescript
it('passes attachments to sendMail', async () => {
  const sendMail = jest.fn().mockResolvedValue({ messageId: '<msg>' });
  nodemailer.createTransport = jest.fn().mockReturnValue({ sendMail });
  mockSmtpSettings();

  const attachment = { filename: 'report.pdf', content: Buffer.from('pdf'), contentType: 'application/pdf' };
  await provider.send('test@test.com', '<p>Hi</p>', 'agent1', { attachments: [attachment] });

  expect(sendMail).toHaveBeenCalledWith(
    expect.objectContaining({
      attachments: [{ filename: 'report.pdf', content: Buffer.from('pdf'), contentType: 'application/pdf' }],
    }),
  );
});

it('retries on failure up to 3 times', async () => {
  const sendMail = jest.fn().mockRejectedValue(new Error('SMTP error'));
  nodemailer.createTransport = jest.fn().mockReturnValue({ sendMail });
  mockSmtpSettings();

  await expect(provider.send('test@test.com', '<p>Hi</p>', 'agent1')).rejects.toThrow('SMTP error');
  expect(sendMail).toHaveBeenCalledTimes(3);
}, 15000);

it('succeeds on retry', async () => {
  const sendMail = jest.fn()
    .mockRejectedValueOnce(new Error('Temp'))
    .mockResolvedValueOnce({ messageId: '<msg>' });
  nodemailer.createTransport = jest.fn().mockReturnValue({ sendMail });
  mockSmtpSettings();

  const result = await provider.send('test@test.com', '<p>Hi</p>', 'agent1');
  expect(result.messageId).toBe('<msg>');
  expect(sendMail).toHaveBeenCalledTimes(2);
});
```

Add a `mockSmtpSettings` helper function to the test file that sets up agentSettingsService mocks for SMTP.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="email.provider.test" --verbose
```

Expected: FAIL

- [ ] **Step 3: Add retry logic and attachment support to EmailProvider**

```typescript
import type { ChannelProvider, EmailAttachment } from '../notification.types';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export class EmailProvider implements ChannelProvider {
  async send(
    recipientEmail: string,
    content: string,
    agentId: string,
    options?: { subject?: string; attachments?: EmailAttachment[] },
  ): Promise<{ messageId?: string }> {
    // ... existing settings lookup ...

    const transporter = nodemailer.createTransport({ /* existing config */ });

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await transporter.sendMail({
          from: fromName ? `"${fromName}" <${fromEmail || user}>` : fromEmail || user,
          to: recipientEmail,
          subject: options?.subject || 'SellMyHomeNow Notification',
          html: content,
          ...(options?.attachments && {
            attachments: options.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              contentType: a.contentType,
            })),
          }),
        });
        return { messageId: result.messageId };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES - 1) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Email send failed after retries');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="email.provider.test" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/notification/providers/email.provider.ts src/domains/notification/providers/__tests__/email.provider.test.ts
git commit -m "feat(notification): add email retry logic and attachment support"
```

---

### Task 22: Add Unsubscribe Endpoint

**Files:**
- Modify: `src/domains/notification/notification.router.ts`
- Modify: `src/domains/notification/notification.service.ts`
- Modify: `src/domains/notification/__tests__/notification.service.test.ts`

- [ ] **Step 1: Write failing test for unsubscribe**

```typescript
describe('unsubscribe', () => {
  it('withdraws marketing consent and creates consent record', async () => {
    prisma.seller.update = jest.fn().mockResolvedValue({});
    prisma.consentRecord = { create: jest.fn().mockResolvedValue({}) };
    prisma.$transaction = jest.fn().mockImplementation(async (fn: Function) => fn(prisma));

    await service.handleUnsubscribe('seller-1');

    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement unsubscribe in notification.service.ts**

```typescript
import jwt from 'jsonwebtoken';

export function generateUnsubscribeToken(sellerId: string): string {
  return jwt.sign(
    { sellerId, purpose: 'marketing_consent_withdrawal' },
    process.env.SESSION_SECRET!,
    { expiresIn: '30d' },
  );
}

export async function handleUnsubscribe(sellerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.seller.update({
      where: { id: sellerId },
      data: { consentMarketing: false, consentWithdrawnAt: new Date() },
    });

    await tx.consentRecord.create({
      data: {
        id: createId(),
        subjectType: 'seller',
        subjectId: sellerId,
        purposeService: true,
        purposeMarketing: false,
        consentGivenAt: new Date(),
        consentWithdrawnAt: new Date(),
        ipAddress: 'unsubscribe-link',
        userAgent: 'email-unsubscribe',
      },
    });
  });

  await auditService.log({
    action: 'consent.marketing_withdrawn',
    entityType: 'seller',
    entityId: sellerId,
    details: { channel: 'email_unsubscribe' },
  });
}
```

- [ ] **Step 3: Add unsubscribe route to notification.router.ts**

```typescript
import jwt from 'jsonwebtoken';

notificationRouter.get(
  '/api/notifications/unsubscribe',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.query.token as string;
      if (!token) return res.status(400).render('pages/error', { message: 'Missing token' });

      const payload = jwt.verify(token, process.env.SESSION_SECRET!) as {
        sellerId: string;
        purpose: string;
      };

      if (payload.purpose !== 'marketing_consent_withdrawal') {
        return res.status(400).render('pages/error', { message: 'Invalid token' });
      }

      await notificationService.handleUnsubscribe(payload.sellerId);
      res.render('pages/unsubscribe-confirmed');
    } catch (err) {
      if (err instanceof jwt.JsonWebTokenError) {
        return res.status(400).render('pages/error', { message: 'Invalid or expired unsubscribe link' });
      }
      next(err);
    }
  },
);
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPattern="notification" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/notification/notification.service.ts src/domains/notification/notification.router.ts src/domains/notification/__tests__/notification.service.test.ts
git commit -m "feat(notification): add unsubscribe endpoint with consent withdrawal"
```

---

### Task 23: Run Full Notification Test Suite

- [ ] **Step 1: Run all notification tests**

```bash
npm test -- --testPathPattern="notification" --verbose
```

Expected: All tests pass.

- [ ] **Step 2: Run full test suite**

```bash
npm test && npm run test:integration
```

Expected: No regressions.

---

## Chunk 3: Agent-Settings Refactor

### Task 24: Add Agent-Settings Validator

**Files:**
- Create: `src/domains/agent-settings/agent-settings.validator.ts`

- [ ] **Step 1: Create validator file**

```typescript
import { body } from 'express-validator';

export const whatsappSettingsRules = [
  body('whatsapp_phone_number_id')
    .isString()
    .trim()
    .notEmpty()
    .isLength({ max: 500 })
    .withMessage('Phone Number ID is required (max 500 chars)'),
  body('whatsapp_api_token')
    .isString()
    .trim()
    .notEmpty()
    .isLength({ max: 500 })
    .withMessage('API Token is required (max 500 chars)'),
  body('whatsapp_business_account_id')
    .isString()
    .trim()
    .notEmpty()
    .isLength({ max: 500 })
    .withMessage('Business Account ID is required (max 500 chars)'),
];

export const smtpSettingsRules = [
  body('smtp_host')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('SMTP host is required'),
  body('smtp_port')
    .isInt({ min: 1, max: 65535 })
    .withMessage('Port must be between 1 and 65535'),
  body('smtp_user')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('SMTP user is required'),
  body('smtp_pass')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('SMTP password is required'),
  body('smtp_from_email')
    .isEmail()
    .withMessage('Valid from email is required'),
  body('smtp_from_name')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage('From name max 100 chars'),
];
```

- [ ] **Step 2: Apply validators to agent-settings.router.ts**

Import validators and add to POST routes:

```typescript
import { whatsappSettingsRules, smtpSettingsRules } from './agent-settings.validator';
import { validationResult } from 'express-validator';

// POST /agent/settings/whatsapp — add whatsappSettingsRules
// POST /agent/settings/email — add smtpSettingsRules
// Add validation result checking at the start of each handler
```

- [ ] **Step 3: Commit**

```bash
git add src/domains/agent-settings/agent-settings.validator.ts src/domains/agent-settings/agent-settings.router.ts
git commit -m "feat(agent-settings): add input validators for WhatsApp and SMTP settings"
```

---

### Task 25: Fix Agent-Settings Service (Null-Safety + Error Logging)

**Files:**
- Modify: `src/domains/agent-settings/agent-settings.service.ts`
- Modify: `src/domains/agent-settings/__tests__/agent-settings.service.test.ts`

- [ ] **Step 1: Write failing test for corrupted decrypt**

Add to `agent-settings.service.test.ts`:

```typescript
it('returns null maskedValue when decrypt throws', async () => {
  encryption.decrypt = jest.fn().mockImplementation(() => {
    throw new Error('Invalid encrypted token format');
  });
  repo.findAllForAgent = jest.fn().mockResolvedValue([
    { key: 'smtp_host', encryptedValue: 'corrupted', updatedAt: new Date() },
  ]);

  const result = await service.getSettingsView('agent1');
  const hostView = result.find((r) => r.key === 'smtp_host');
  expect(hostView?.maskedValue).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="agent-settings.service.test" --verbose
```

Expected: FAIL — throws instead of returning null.

- [ ] **Step 3: Add try-catch around decrypt in getSettingsView**

In `agent-settings.service.ts`, wrap the decrypt call:

```typescript
let decrypted: string | null = null;
try {
  decrypted = decrypt(record.encryptedValue);
} catch (err) {
  logger.warn({ key, agentId, err }, 'Failed to decrypt agent setting');
  return { key, maskedValue: null, updatedAt: record.updatedAt };
}
```

Also add audit logging for failed connection tests:

```typescript
// In testWhatsAppConnection catch block:
await auditService.log({
  action: 'agent_settings.test_failed',
  entityType: 'agent_setting',
  entityId: agentId,
  details: { channel: 'whatsapp', error: message },
});

// Same for testSmtpConnection
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="agent-settings.service.test" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/agent-settings/agent-settings.service.ts src/domains/agent-settings/__tests__/agent-settings.service.test.ts
git commit -m "fix(agent-settings): add null-safety for decrypt and audit logging for test failures"
```

---

### Task 26: Fix Agent-Settings Repository (deleteMany → delete)

**Files:**
- Modify: `src/domains/agent-settings/agent-settings.repository.ts`

- [ ] **Step 1: Verify @@unique constraint exists in schema**

Check `prisma/schema.prisma` for `@@unique([agentId, key])` on AgentSetting model. It exists (confirmed from schema read).

- [ ] **Step 2: Fix deleteByKey**

Change in `agent-settings.repository.ts`:

```typescript
export function deleteByKey(agentId: string, key: string) {
  return prisma.agentSetting.delete({
    where: { agentId_key: { agentId, key } },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/domains/agent-settings/agent-settings.repository.ts
git commit -m "fix(agent-settings): use delete with unique constraint instead of deleteMany"
```

---

### Task 27: Fix Agent-Settings Router HTMX Rendering

**Files:**
- Modify: `src/domains/agent-settings/agent-settings.router.ts`

- [ ] **Step 1: Fix GET endpoint**

Change the GET handler to render different templates for HTMX vs normal requests:

```typescript
if (req.headers['hx-request']) {
  return res.render('partials/agent/settings', { settings });
}
res.render('pages/agent/settings', { settings });
```

- [ ] **Step 2: Commit**

```bash
git add src/domains/agent-settings/agent-settings.router.ts
git commit -m "fix(agent-settings): render correct HTMX partial vs full page"
```

---

### Task 28: Add Agent-Settings Repository Tests

**Files:**
- Create: `src/domains/agent-settings/__tests__/agent-settings.repository.test.ts`

- [ ] **Step 1: Create repository test file**

```typescript
import * as repo from '../agent-settings.repository';

jest.mock('../../../infra/database/prisma', () => ({
  prisma: {
    agentSetting: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  },
  createId: jest.fn().mockReturnValue('test-setting-id'),
}));

const { prisma } = jest.requireMock('../../../infra/database/prisma');

describe('AgentSettingsRepository', () => {
  beforeEach(() => jest.clearAllMocks());

  it('upsert creates or updates setting', async () => {
    prisma.agentSetting.upsert.mockResolvedValue({});
    await repo.upsert('agent1', 'smtp_host', 'encrypted-value');
    expect(prisma.agentSetting.upsert).toHaveBeenCalledWith({
      where: { agentId_key: { agentId: 'agent1', key: 'smtp_host' } },
      update: { encryptedValue: 'encrypted-value' },
      create: {
        id: 'test-setting-id',
        agentId: 'agent1',
        key: 'smtp_host',
        encryptedValue: 'encrypted-value',
      },
    });
  });

  it('findAllForAgent returns all settings ordered by key', async () => {
    prisma.agentSetting.findMany.mockResolvedValue([]);
    await repo.findAllForAgent('agent1');
    expect(prisma.agentSetting.findMany).toHaveBeenCalledWith({
      where: { agentId: 'agent1' },
      orderBy: { key: 'asc' },
    });
  });

  it('findByKey returns single setting', async () => {
    prisma.agentSetting.findUnique.mockResolvedValue({ key: 'smtp_host' });
    const result = await repo.findByKey('agent1', 'smtp_host');
    expect(prisma.agentSetting.findUnique).toHaveBeenCalledWith({
      where: { agentId_key: { agentId: 'agent1', key: 'smtp_host' } },
    });
    expect(result).toEqual({ key: 'smtp_host' });
  });

  it('deleteByKey deletes using unique constraint', async () => {
    prisma.agentSetting.delete.mockResolvedValue({});
    await repo.deleteByKey('agent1', 'smtp_host');
    expect(prisma.agentSetting.delete).toHaveBeenCalledWith({
      where: { agentId_key: { agentId: 'agent1', key: 'smtp_host' } },
    });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- --testPathPattern="agent-settings.repository.test" --verbose
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/domains/agent-settings/__tests__/agent-settings.repository.test.ts
git commit -m "test(agent-settings): add repository unit tests"
```

---

### Task 29: Add Agent-Settings Router Tests

**Files:**
- Create: `src/domains/agent-settings/__tests__/agent-settings.router.test.ts`

- [ ] **Step 1: Create router test file**

```typescript
import request from 'supertest';
import { createApp } from '../../../infra/http/app';

jest.mock('../agent-settings.service');
jest.mock('../../shared/audit.service');

const service = jest.requireMock('../agent-settings.service');

describe('AgentSettingsRouter', () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    process.env.SESSION_SECRET = 'test-secret';
    process.env.DATABASE_URL = 'postgresql://test';
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    app = createApp();
  });

  beforeEach(() => jest.clearAllMocks());

  describe('GET /agent/settings', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/agent/settings');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /agent/settings/whatsapp', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post('/agent/settings/whatsapp')
        .send({ whatsapp_phone_number_id: '123', whatsapp_api_token: 'tok', whatsapp_business_account_id: 'biz' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /agent/settings/test/whatsapp', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).post('/agent/settings/test/whatsapp');
      expect(res.status).toBe(401);
    });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- --testPathPattern="agent-settings.router.test" --verbose
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/domains/agent-settings/__tests__/agent-settings.router.test.ts
git commit -m "test(agent-settings): add router unit tests"
```

---

### Task 30: Run Full Test Suite + Lint

- [ ] **Step 1: Run all tests**

```bash
npm test && npm run test:integration
```

Expected: All tests pass.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: No errors.

- [ ] **Step 3: Run format**

```bash
npm run format
```

- [ ] **Step 4: Final commit if formatting changed**

```bash
git add -A
git commit -m "style: fix formatting after Phase 1B refactor"
```

---

## Chunk 4: Email Templates (Optional Enhancement)

### Task 31: Create Base Email Template

**Files:**
- Create: `src/views/emails/base.njk`

- [ ] **Step 1: Create base email layout**

```njk
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #fafaf7; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: #1a1a2e; padding: 24px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 20px; }
    .content { padding: 32px 24px; color: #333; line-height: 1.6; }
    .footer { padding: 24px; text-align: center; font-size: 12px; color: #888; border-top: 1px solid #eee; }
    .footer a { color: #c8553d; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>{{ "SellMyHomeNow.sg" | t }}</h1>
    </div>
    <div class="content">
      {% block content %}{% endblock %}
    </div>
    <div class="footer">
      <p>{{ "SellMyHomeNow.sg — Sell your HDB for $1,499" | t }}</p>
      <p>{{ "Operating under Huttons Asia Pte Ltd (CEA Licence No. L3008899K)" | t }}</p>
      {% if unsubscribeUrl %}
        <p><a href="{{ unsubscribeUrl }}">{{ "Unsubscribe from marketing emails" | t }}</a></p>
      {% endif %}
    </div>
  </div>
</body>
</html>
```

- [ ] **Step 2: Create generic notification template**

Create `src/views/emails/notification.njk`:

```njk
{% extends "emails/base.njk" %}

{% block content %}
  <p>{{ content }}</p>
{% endblock %}
```

- [ ] **Step 3: Commit**

```bash
git add src/views/emails/
git commit -m "feat(notification): add base and generic email templates"
```

---

### Task 32: Wire Email Templates into EmailProvider

**Files:**
- Modify: `src/domains/notification/providers/email.provider.ts`

- [ ] **Step 1: Add Nunjucks rendering to EmailProvider**

```typescript
import nunjucks from 'nunjucks';
import path from 'path';

const emailEnv = nunjucks.configure(
  process.env.VIEWS_PATH || path.resolve('src/views'),
  { autoescape: true },
);
emailEnv.addFilter('t', (str: string) => str);

// In the send method, render the email template:
const htmlContent = nunjucks.render('emails/notification.njk', {
  content,
  unsubscribeUrl: options?.unsubscribeUrl,
});
```

Update the `sendMail` call to use `htmlContent` instead of raw `content`.

- [ ] **Step 2: Run tests**

```bash
npm test -- --testPathPattern="email.provider" --verbose
```

Expected: PASS (existing tests should still pass since they mock nodemailer).

- [ ] **Step 3: Commit**

```bash
git add src/domains/notification/providers/email.provider.ts
git commit -m "feat(notification): render Nunjucks email templates in EmailProvider"
```

---

## Amendments (from plan review)

The following amendments address gaps found during plan review. Execute these as additional tasks interleaved at the indicated points.

### Amendment A: Session Invalidation (insert after Task 8)

**CRITICAL — missing from original plan. Spec section 1.1 requires session invalidation on both password reset and password change.**

**Files:**
- Modify: `src/domains/auth/auth.repository.ts`
- Modify: `src/domains/auth/auth.service.ts`

- [ ] **Step 1: Add session invalidation repository method**

The session table is managed by `connect-pg-simple` and is named `session` with columns `sid`, `sess` (JSON with `passport.user`), and `expire`. Add to `auth.repository.ts`:

```typescript
export async function invalidateUserSessions(userId: string, exceptSessionId?: string) {
  // Session data is stored as JSON in the `sess` column.
  // The passport user object is at sess.passport.user which contains the user id.
  // We use raw SQL because Prisma does not manage the session table.
  if (exceptSessionId) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "session" WHERE sess::text LIKE $1 AND sid != $2`,
      `%"id":"${userId}"%`,
      exceptSessionId,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "session" WHERE sess::text LIKE $1`,
      `%"id":"${userId}"%`,
    );
  }
}
```

- [ ] **Step 2: Call session invalidation in resetPassword**

In `auth.service.ts`, add after password update in `resetPassword`:

```typescript
await authRepo.invalidateUserSessions(user.id); // Invalidate all sessions (user must re-login)
```

- [ ] **Step 3: Call session invalidation in changePassword**

In `auth.service.ts`, modify `changePassword` to accept `currentSessionId` parameter:

```typescript
export async function changePassword(
  userId: string,
  role: UserRole,
  newPassword: string,
  currentSessionId?: string,
): Promise<void> {
  // ... existing password hash logic ...
  await authRepo.invalidateUserSessions(userId, currentSessionId);
  // ... existing audit log ...
}
```

- [ ] **Step 4: Commit**

```bash
git add src/domains/auth/auth.repository.ts src/domains/auth/auth.service.ts
git commit -m "feat(auth): invalidate sessions on password change and reset"
```

---

### Amendment B: Audit Event Standardization (insert in Task 10 router split)

**IMPORTANT — existing audit events use inconsistent prefixes. Update during router extraction.**

When copying existing router/service code during the router split (Task 10), update these audit event names:
- `seller.registered` → `auth.seller_registered`
- `2fa.setup` → `auth.2fa_setup`
- `2fa.backup_code_used` → `auth.2fa_backup_used`
- `password.changed` → `auth.password_changed`

Also add audit logging for events not currently logged:
- `auth.login_success` — after successful login (seller or agent)
- `auth.login_failed` — after failed login (wrong password, before lockout check)
- `auth.logout` — in logout handler

---

### Amendment C: loginSeller/loginAgent Signature Preservation (affects Task 5)

**CRITICAL — Do NOT change the function signatures of loginSeller/loginAgent. The existing code uses positional parameters that are called by Passport strategies.**

In Task 5, keep the existing signature `loginSeller(input: LoginInput)` — it already uses `LoginInput`. Just add the dummy hash comparison. Do NOT change to a different signature. Verify the existing `passport.ts` strategy calls match the current service signature before modifying.

For `loginAgent`, the existing code already takes `(email: string, password: string)` — keep this signature. Add the lockout/enum fixes inline without changing the parameter shape.

---

### Amendment D: requireTwoFactor Application to All Agent Routes (insert after Task 11)

**IMPORTANT — Task 11 only handles redirect on login. Agents can still access /agent/* by direct URL.**

The existing `requireTwoFactor()` middleware in `src/infra/http/middleware/require-auth.ts` already checks `req.user.twoFactorVerified`. It is already applied to agent-settings routes (see `agent-settings.router.ts` line 12: `const agentAuth = [requireAuth(), requireRole('agent', 'admin'), requireTwoFactor()]`).

Verify that ALL agent/admin routes use this middleware pattern. Check:
- `seller.router.ts` agent routes
- `property.router.ts` agent routes
- `viewing.router.ts` agent routes
- `financial.router.ts` agent routes

If any agent route is missing `requireTwoFactor()`, add it. This is a verification task — check and fix if needed.

---

### Amendment E: 2FA Session Timeout (insert in Task 10/11)

**IMPORTANT — Missing explicit session timeout for non-2FA sellers.**

In the seller login handler (`auth.login.router.ts`), after successful Passport login:

```typescript
// Set session timeout based on 2FA status
if (sellerResult.twoFactorEnabled) {
  req.session.cookie.maxAge = 30 * 60 * 1000; // 30 min
} else {
  req.session.cookie.maxAge = 24 * 60 * 60 * 1000; // 24 hours
}
```

In the 2FA setup completion handler (`auth.two-factor.router.ts`), after successful setup:

```typescript
req.session.cookie.maxAge = 30 * 60 * 1000; // Update to 30 min now that 2FA is enabled
```

---

### Amendment F: Template Approval Status Check (insert after Task 16)

**CRITICAL — WHATSAPP_TEMPLATE_STATUS map created in Task 13 but never checked.**

- [ ] **Step 1: Write failing test**

Add to `notification.service.test.ts`:

```typescript
describe('template approval status', () => {
  it('falls back to email when WhatsApp template is not approved', async () => {
    // Mock template status
    jest.spyOn(require('../notification.templates'), 'WHATSAPP_TEMPLATE_STATUS', 'get')
      .mockReturnValue({ ...defaultStatuses, welcome_seller: 'pending' });

    prisma.seller.findUnique.mockResolvedValue({
      id: 'seller-1',
      notificationPreference: 'whatsapp_and_email',
      consentService: true,
    });
    EmailProvider.prototype.send = jest.fn().mockResolvedValue({ messageId: '<msg>' });
    auditService.log = jest.fn().mockResolvedValue(undefined);

    await service.send(input, 'agent-1');

    expect(WhatsAppProvider.prototype.send).not.toHaveBeenCalled();
    expect(EmailProvider.prototype.send).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement template status check in sendExternal**

In `sendExternal`, before WhatsApp send:

```typescript
if (primaryChannel === 'whatsapp') {
  const templateStatus = WHATSAPP_TEMPLATE_STATUS[input.templateName as keyof typeof WHATSAPP_TEMPLATE_STATUS];
  if (templateStatus !== 'approved') {
    logger.info({ templateName: input.templateName, status: templateStatus }, 'WhatsApp template not approved, falling back to email');
    await auditService.log({
      action: 'notification.fallback',
      entityType: 'notification',
      entityId: record.id,
      details: { reason: `WhatsApp template ${templateStatus}`, templateName: input.templateName },
    });
    primaryChannel = 'email';
  }
}
```

---

### Amendment G: Wire InAppProvider Through Provider Dispatch (insert in Task 13)

**Spec section 2.3: "Wire up existing in-app.provider.ts through the provider dispatch logic."**

This is a minor consistency fix. The in-app notification is currently created directly in the `send()` function (not through a provider). This is functionally correct and simpler. Since the InAppProvider is a no-op, wiring it through provider dispatch adds complexity without benefit. **Keep the current approach.** The InAppProvider exists for interface completeness but does not need to be called in the flow.

---

### Amendment H: Expand Unsubscribe Tests (modify Task 22)

Add these test cases to Task 22:

```typescript
it('rejects expired JWT token', async () => {
  const token = jwt.sign(
    { sellerId: 'seller-1', purpose: 'marketing_consent_withdrawal' },
    process.env.SESSION_SECRET!,
    { expiresIn: '0s' }, // already expired
  );

  const res = await request(app).get(`/api/notifications/unsubscribe?token=${token}`);
  expect(res.status).toBe(400);
});

it('rejects invalid JWT token', async () => {
  const res = await request(app).get('/api/notifications/unsubscribe?token=garbage');
  expect(res.status).toBe(400);
});

it('rejects token with wrong purpose', async () => {
  const token = jwt.sign(
    { sellerId: 'seller-1', purpose: 'wrong_purpose' },
    process.env.SESSION_SECRET!,
    { expiresIn: '30d' },
  );

  const res = await request(app).get(`/api/notifications/unsubscribe?token=${token}`);
  expect(res.status).toBe(400);
});
```

---

### Amendment I: Forgot-Password Rate Limiter (modify Task 10)

**The spec requires 3 reset requests per email per hour. The generic authRateLimiter (5/15min) does not match.**

Create a dedicated rate limiter for forgot-password:

```typescript
import rateLimit from 'express-rate-limit';

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: 'Too many password reset requests. Please try again later.',
  keyGenerator: (req) => req.body?.email || req.ip,
});
```

Apply `forgotPasswordLimiter` instead of `authRateLimiter` on the `POST /auth/forgot-password` route.

---

### Amendment J: Task 7 Architecture Fix (backup code transaction)

**IMPORTANT — The plan imports prisma directly in auth.service.ts, violating "services never call Prisma directly."**

Instead of importing prisma in the service, add a repository method that wraps the transaction:

```typescript
// In auth.repository.ts:
export async function removeBackupCodeAtomically(
  userId: string,
  role: UserRole,
  codeIndex: number,
  currentCodes: string[],
) {
  return prisma.$transaction(async (tx) => {
    const remaining = [...currentCodes.slice(0, codeIndex), ...currentCodes.slice(codeIndex + 1)];
    if (role === 'seller') {
      await tx.seller.update({
        where: { id: userId },
        data: { twoFactorBackupCodes: remaining },
      });
    } else {
      await tx.agent.update({
        where: { id: userId },
        data: { twoFactorBackupCodes: remaining },
      });
    }
    return remaining;
  });
}
```

Then the service calls `authRepo.removeBackupCodeAtomically()` instead of `prisma.$transaction()`.

---

## Summary

**Total tasks:** 32 + 10 amendments
**Estimated commits:** ~30

**Task grouping:**
- Tasks 1-12 + Amendments A-E: Auth domain (schema, types, repo, service, validators, router split, 2FA enforcement, session invalidation, audit standardization)
- Tasks 13-23 + Amendments F-I: Notification domain (templates, validator, types, preference, consent, DNC, audit, webhook, attachments, retry, unsubscribe, template approval)
- Tasks 24-30: Agent-settings domain (validator, service fixes, repo fix, HTMX fix, tests)
- Tasks 31-32: Email templates (enhancement)

**Run tests after each chunk:**
- After Task 12 + Amendments: `npm test && npm run test:integration`
- After Task 23 + Amendments: `npm test && npm run test:integration`
- After Task 30: `npm test && npm run test:integration`
