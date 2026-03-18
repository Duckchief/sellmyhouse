# User Profile Feature Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent top header with a user avatar dropdown (Profile, Log out) to both admin and agent layouts, and a shared `/profile` page with avatar upload/crop, read-only account info, 2FA status, and in-app password change.

**Architecture:** New `src/domains/profile/` domain (router + service + repository + types). The profile route is shared — both `admin` and `agent` role users access `/profile`. A new `partials/shared/top-header.njk` Nunjucks partial is included in both `admin.njk` and `agent.njk`, replacing the mobile-only header. Avatar stored in `/uploads/avatars/{agentId}.jpg`, served auth-checked.

**Tech Stack:** Express + Nunjucks + HTMX + Tailwind CSS + Prisma + bcrypt + multer + sharp (all already installed). Cropper.js via `cdn.jsdelivr.net` (already whitelisted in CSP).

---

## Chunk 1: Database + Repository + Service

### Task 1: Add `avatarPath` to Agent schema and run migration

**Files:**
- Modify: `prisma/schema.prisma` (Agent model, line ~336)
- Create: `prisma/migrations/20260318100000_add_agent_avatar_path/migration.sql`

- [ ] **Step 1.1: Add `avatarPath` field to Agent model**

Open `prisma/schema.prisma`. In the `Agent` model (line ~316), add this field after `notificationPreference`:

```prisma
  avatarPath                String?                @map("avatar_path")
```

The Agent model `updatedAt` line should now be directly below. Save the file.

- [ ] **Step 1.2: Create the shadow database**

```bash
PGPASSWORD=smhn_dev psql -U smhn -h localhost -p 5432 -d sellmyhomenow_dev -c "CREATE DATABASE smhn_shadow_tmp;"
```

Expected: `CREATE DATABASE`

- [ ] **Step 1.3: Generate migration SQL using shadow DB**

```bash
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://smhn:smhn_dev@localhost:5432/smhn_shadow_tmp" \
  --script
```

Expected output: SQL containing `ALTER TABLE "agents" ADD COLUMN "avatar_path" TEXT;`

- [ ] **Step 1.4: Create migration file manually**

```bash
mkdir -p prisma/migrations/20260318100000_add_agent_avatar_path
```

Create `prisma/migrations/20260318100000_add_agent_avatar_path/migration.sql` with the SQL from the previous step. Typical content:

```sql
-- AlterTable
ALTER TABLE "agents" ADD COLUMN "avatar_path" TEXT;
```

- [ ] **Step 1.5: Apply migration**

```bash
npx prisma migrate deploy
```

Expected: `1 migration applied`

- [ ] **Step 1.6: Regenerate Prisma client**

```bash
npx prisma generate
```

Expected: `Generated Prisma Client`

- [ ] **Step 1.7: Drop shadow database**

```bash
PGPASSWORD=smhn_dev psql -U smhn -h localhost -p 5432 -d sellmyhomenow_dev -c "DROP DATABASE smhn_shadow_tmp;"
```

Expected: `DROP DATABASE`

- [ ] **Step 1.8: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -20
```

Expected: No errors related to `avatarPath`.

- [ ] **Step 1.9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260318100000_add_agent_avatar_path/
git commit -m "feat(profile): add avatarPath to Agent schema"
```

---

### Task 2: Profile types

**Files:**
- Create: `src/domains/profile/profile.types.ts`

- [ ] **Step 2.1: Create types file**

```typescript
// src/domains/profile/profile.types.ts
import type { AgentRole } from '@prisma/client';

export interface ProfileView {
  id: string;
  name: string;
  email: string;
  role: AgentRole;
  createdAt: Date;
  twoFactorEnabled: boolean;
  avatarPath: string | null;
}
```

- [ ] **Step 2.2: Commit**

```bash
git add src/domains/profile/profile.types.ts
git commit -m "feat(profile): add profile types"
```

---

### Task 3: Profile repository — TDD

**Files:**
- Create: `src/domains/profile/profile.repository.ts`
- Create: `src/domains/profile/__tests__/profile.repository.test.ts`

- [ ] **Step 3.1: Write failing tests for the repository**

```typescript
// src/domains/profile/__tests__/profile.repository.test.ts
import * as repo from '../profile.repository';

jest.mock('@/infra/database/prisma');

const prisma = jest.requireMock('@/infra/database/prisma').prisma;

describe('ProfileRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findAgentById', () => {
    it('returns agent when found', async () => {
      const agent = {
        id: 'agent1',
        name: 'John Doe',
        email: 'john@test.com',
        role: 'agent',
        createdAt: new Date('2025-01-01'),
        twoFactorEnabled: false,
        avatarPath: null,
      };
      prisma.agent.findUnique = jest.fn().mockResolvedValue(agent);

      const result = await repo.findAgentById('agent1');

      expect(prisma.agent.findUnique).toHaveBeenCalledWith({
        where: { id: 'agent1' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          twoFactorEnabled: true,
          avatarPath: true,
        },
      });
      expect(result).toEqual(agent);
    });

    it('returns null when not found', async () => {
      prisma.agent.findUnique = jest.fn().mockResolvedValue(null);

      const result = await repo.findAgentById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('updateAvatarPath', () => {
    it('updates avatarPath for the agent', async () => {
      prisma.agent.update = jest.fn().mockResolvedValue({});

      await repo.updateAvatarPath('agent1', '/uploads/avatars/agent1.jpg');

      expect(prisma.agent.update).toHaveBeenCalledWith({
        where: { id: 'agent1' },
        data: { avatarPath: '/uploads/avatars/agent1.jpg' },
      });
    });
  });

  describe('clearAvatarPath', () => {
    it('sets avatarPath to null', async () => {
      prisma.agent.update = jest.fn().mockResolvedValue({});

      await repo.clearAvatarPath('agent1');

      expect(prisma.agent.update).toHaveBeenCalledWith({
        where: { id: 'agent1' },
        data: { avatarPath: null },
      });
    });
  });

  describe('updatePasswordHash', () => {
    it('updates passwordHash for the agent', async () => {
      prisma.agent.update = jest.fn().mockResolvedValue({});

      await repo.updatePasswordHash('agent1', 'new-hash');

      expect(prisma.agent.update).toHaveBeenCalledWith({
        where: { id: 'agent1' },
        data: { passwordHash: 'new-hash' },
      });
    });
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=profile.repository --no-coverage 2>&1 | tail -15
```

Expected: `Cannot find module '../profile.repository'`

- [ ] **Step 3.3: Implement the repository**

```typescript
// src/domains/profile/profile.repository.ts
import { prisma } from '../../infra/database/prisma';

const profileSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
  twoFactorEnabled: true,
  avatarPath: true,
} as const;

export function findAgentById(agentId: string) {
  return prisma.agent.findUnique({
    where: { id: agentId },
    select: profileSelect,
  });
}

export function updateAvatarPath(agentId: string, path: string) {
  return prisma.agent.update({
    where: { id: agentId },
    data: { avatarPath: path },
  });
}

export function clearAvatarPath(agentId: string) {
  return prisma.agent.update({
    where: { id: agentId },
    data: { avatarPath: null },
  });
}

export function updatePasswordHash(agentId: string, hash: string) {
  return prisma.agent.update({
    where: { id: agentId },
    data: { passwordHash: hash },
  });
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=profile.repository --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 5 passed`

- [ ] **Step 3.5: Commit**

```bash
git add src/domains/profile/profile.repository.ts src/domains/profile/__tests__/profile.repository.test.ts
git commit -m "feat(profile): add profile repository with TDD"
```

---

### Task 4: Profile service — TDD

**Files:**
- Create: `src/domains/profile/profile.service.ts`
- Create: `src/domains/profile/__tests__/profile.service.test.ts`

The service handles: `getProfile`, `uploadAvatar`, `deleteAvatar`, `changePassword`.

- [ ] **Step 4.1: Write failing tests for the service**

```typescript
// src/domains/profile/__tests__/profile.service.test.ts
import path from 'path';
import * as service from '../profile.service';

jest.mock('../profile.repository');
jest.mock('bcrypt');
jest.mock('fs/promises');
jest.mock('sharp');

const repo = jest.requireMock('../profile.repository');
const bcrypt = jest.requireMock('bcrypt');
const fsp = jest.requireMock('fs/promises');
const sharp = jest.requireMock('sharp');

const mockAgent = {
  id: 'agent1',
  name: 'John Doe',
  email: 'john@test.com',
  role: 'agent' as const,
  createdAt: new Date('2025-01-01'),
  twoFactorEnabled: false,
  avatarPath: null,
};

describe('ProfileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getProfile', () => {
    it('returns ProfileView for a valid agent', async () => {
      repo.findAgentById = jest.fn().mockResolvedValue(mockAgent);

      const result = await service.getProfile('agent1');

      expect(repo.findAgentById).toHaveBeenCalledWith('agent1');
      expect(result).toEqual(mockAgent);
    });

    it('throws NotFoundError when agent does not exist', async () => {
      repo.findAgentById = jest.fn().mockResolvedValue(null);

      await expect(service.getProfile('nonexistent')).rejects.toThrow('Agent not found');
    });
  });

  describe('uploadAvatar', () => {
    const mockFile = {
      buffer: Buffer.from('fake-image-data'),
      mimetype: 'image/jpeg',
      size: 1024 * 100, // 100KB
    } as Express.Multer.File;

    it('rejects non-image mime types', async () => {
      const badFile = { ...mockFile, mimetype: 'application/pdf' } as Express.Multer.File;

      await expect(service.uploadAvatar('agent1', badFile)).rejects.toThrow(
        'Only JPEG and PNG images are allowed',
      );
    });

    it('rejects files over 5MB', async () => {
      const bigFile = {
        ...mockFile,
        size: 6 * 1024 * 1024,
      } as Express.Multer.File;

      await expect(service.uploadAvatar('agent1', bigFile)).rejects.toThrow(
        'Avatar must be under 5MB',
      );
    });

    it('saves resized image and updates DB on success', async () => {
      const sharpInstance = {
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toFile: jest.fn().mockResolvedValue({}),
      };
      sharp.mockReturnValue(sharpInstance);
      fsp.mkdir = jest.fn().mockResolvedValue(undefined);
      repo.updateAvatarPath = jest.fn().mockResolvedValue({});

      await service.uploadAvatar('agent1', mockFile);

      expect(sharpInstance.resize).toHaveBeenCalledWith(256, 256, { fit: 'cover' });
      expect(sharpInstance.jpeg).toHaveBeenCalledWith({ quality: 85 });
      expect(repo.updateAvatarPath).toHaveBeenCalledWith(
        'agent1',
        expect.stringContaining('agent1.jpg'),
      );
    });
  });

  describe('deleteAvatar', () => {
    it('deletes file from disk and clears DB', async () => {
      repo.findAgentById = jest.fn().mockResolvedValue({
        ...mockAgent,
        avatarPath: path.join('uploads', 'avatars', 'agent1.jpg'),
      });
      fsp.unlink = jest.fn().mockResolvedValue(undefined);
      repo.clearAvatarPath = jest.fn().mockResolvedValue({});

      await service.deleteAvatar('agent1');

      expect(fsp.unlink).toHaveBeenCalled();
      expect(repo.clearAvatarPath).toHaveBeenCalledWith('agent1');
    });

    it('clears DB even if file does not exist on disk', async () => {
      repo.findAgentById = jest.fn().mockResolvedValue({
        ...mockAgent,
        avatarPath: path.join('uploads', 'avatars', 'agent1.jpg'),
      });
      const noEntErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      fsp.unlink = jest.fn().mockRejectedValue(noEntErr);
      repo.clearAvatarPath = jest.fn().mockResolvedValue({});

      await service.deleteAvatar('agent1');

      expect(repo.clearAvatarPath).toHaveBeenCalledWith('agent1');
    });

    it('is a no-op if agent has no avatar', async () => {
      repo.findAgentById = jest.fn().mockResolvedValue({ ...mockAgent, avatarPath: null });
      repo.clearAvatarPath = jest.fn();

      await service.deleteAvatar('agent1');

      expect(repo.clearAvatarPath).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('throws ValidationError when passwords do not match', async () => {
      await expect(
        service.changePassword('agent1', 'current', 'newpass1', 'newpass2'),
      ).rejects.toThrow('Passwords do not match');
    });

    it('throws ValidationError when new password is under 8 chars', async () => {
      await expect(
        service.changePassword('agent1', 'current', 'short', 'short'),
      ).rejects.toThrow('Password must be at least 8 characters');
    });

    it('throws ValidationError when current password is wrong', async () => {
      repo.findAgentById = jest.fn().mockResolvedValue({ ...mockAgent, passwordHash: 'hash' });
      bcrypt.compare = jest.fn().mockResolvedValue(false);

      await expect(
        service.changePassword('agent1', 'wrongpass', 'newpassword', 'newpassword'),
      ).rejects.toThrow('Current password is incorrect');
    });

    it('hashes new password at cost 12 and updates DB on success', async () => {
      repo.findAgentById = jest
        .fn()
        .mockResolvedValue({ ...mockAgent, passwordHash: 'old-hash' });
      bcrypt.compare = jest.fn().mockResolvedValue(true);
      bcrypt.hash = jest.fn().mockResolvedValue('new-hash');
      repo.updatePasswordHash = jest.fn().mockResolvedValue({});

      await service.changePassword('agent1', 'correct', 'newpassword', 'newpassword');

      expect(bcrypt.hash).toHaveBeenCalledWith('newpassword', 12);
      expect(repo.updatePasswordHash).toHaveBeenCalledWith('agent1', 'new-hash');
    });
  });
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=profile.service --no-coverage 2>&1 | tail -10
```

Expected: `Cannot find module '../profile.service'`

- [ ] **Step 4.3: Implement the service**

```typescript
// src/domains/profile/profile.service.ts
import path from 'path';
import fs from 'fs/promises';
import bcrypt from 'bcrypt';
import sharp from 'sharp';
import * as repo from './profile.repository';
import { NotFoundError, ValidationError } from '../shared/errors';
import type { ProfileView } from './profile.types';

const AVATAR_DIR = path.resolve('uploads/avatars');
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/jpg']);

export async function getProfile(agentId: string): Promise<ProfileView> {
  const agent = await repo.findAgentById(agentId);
  if (!agent) throw new NotFoundError('Agent not found');
  return agent as ProfileView;
}

export async function uploadAvatar(agentId: string, file: Express.Multer.File): Promise<void> {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    throw new ValidationError('Only JPEG and PNG images are allowed');
  }
  if (file.size > MAX_SIZE) {
    throw new ValidationError('Avatar must be under 5MB');
  }

  await fs.mkdir(AVATAR_DIR, { recursive: true });

  const outputPath = path.join(AVATAR_DIR, `${agentId}.jpg`);
  await sharp(file.buffer)
    .resize(256, 256, { fit: 'cover' })
    .jpeg({ quality: 85 })
    .toFile(outputPath);

  await repo.updateAvatarPath(agentId, outputPath);
}

export async function deleteAvatar(agentId: string): Promise<void> {
  const agent = await repo.findAgentById(agentId);
  if (!agent?.avatarPath) return;

  try {
    await fs.unlink(agent.avatarPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // File already gone — still clear the DB record
  }

  await repo.clearAvatarPath(agentId);
}

export async function changePassword(
  agentId: string,
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): Promise<void> {
  if (newPassword !== confirmPassword) {
    throw new ValidationError('Passwords do not match');
  }
  if (newPassword.length < 8) {
    throw new ValidationError('Password must be at least 8 characters');
  }

  const agent = await repo.findAgentById(agentId);
  if (!agent) throw new NotFoundError('Agent not found');

  // repo.findAgentById only selects profile fields — need passwordHash separately
  // Call prisma directly via a separate repo function
  const valid = await repo.verifyPassword(agentId, currentPassword);
  if (!valid) throw new ValidationError('Current password is incorrect');

  const hash = await bcrypt.hash(newPassword, 12);
  await repo.updatePasswordHash(agentId, hash);
}
```

> **Note:** `changePassword` requires `repo.verifyPassword` — add that to the repository in the next sub-step.

- [ ] **Step 4.4: Add `verifyPassword` to the repository**

Add to `src/domains/profile/profile.repository.ts`:

```typescript
import bcrypt from 'bcrypt';

export async function verifyPassword(agentId: string, password: string): Promise<boolean> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { passwordHash: true },
  });
  if (!agent) return false;
  return bcrypt.compare(password, agent.passwordHash);
}
```

Also add a test for it in `profile.repository.test.ts`:

```typescript
describe('verifyPassword', () => {
  it('returns true when password matches hash', async () => {
    prisma.agent.findUnique = jest.fn().mockResolvedValue({ passwordHash: 'hash' });
    const bcrypt = jest.requireMock('bcrypt');
    bcrypt.compare = jest.fn().mockResolvedValue(true);

    const result = await repo.verifyPassword('agent1', 'correct');
    expect(result).toBe(true);
  });

  it('returns false when agent not found', async () => {
    prisma.agent.findUnique = jest.fn().mockResolvedValue(null);

    const result = await repo.verifyPassword('agent1', 'any');
    expect(result).toBe(false);
  });
});
```

Add `jest.mock('bcrypt')` and `const bcrypt = jest.requireMock('bcrypt')` at the top of the repository test file.

Then update the service test to mock `repo.verifyPassword`:

In the `changePassword` describe block, replace the `repo.findAgentById` mock for the "current password wrong" test case with `repo.verifyPassword = jest.fn().mockResolvedValue(false)`, and for the success case use `repo.verifyPassword = jest.fn().mockResolvedValue(true)`. Remove the `bcrypt.compare` mock and the `repo.findAgentById` mock from those two test cases.

- [ ] **Step 4.5: Run all profile tests**

```bash
npm test -- --testPathPattern=profile --no-coverage 2>&1 | tail -15
```

Expected: All tests pass (repository + service).

- [ ] **Step 4.6: Commit**

```bash
git add src/domains/profile/
git commit -m "feat(profile): add profile service and repository with TDD"
```

---

## Chunk 2: Router + Templates

### Task 5: Avatar upload multer middleware

**Files:**
- Create: `src/domains/profile/profile.multer.ts`

- [ ] **Step 5.1: Create multer config for avatar uploads**

```typescript
// src/domains/profile/profile.multer.ts
import multer from 'multer';

// Store in memory — service pipes buffer through sharp before writing to disk
export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB hard limit
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG and PNG images are allowed'));
    }
  },
});
```

- [ ] **Step 5.2: Commit**

```bash
git add src/domains/profile/profile.multer.ts
git commit -m "feat(profile): add multer middleware for avatar upload"
```

---

### Task 6: Profile router

**Files:**
- Create: `src/domains/profile/profile.router.ts`
- Create: `src/domains/profile/__tests__/profile.router.test.ts`

- [ ] **Step 6.1: Write failing integration tests for the router**

```typescript
// src/domains/profile/__tests__/profile.router.test.ts
import request from 'supertest';
import { createApp } from '../../../infra/http/app';

jest.mock('../profile.service');

describe('ProfileRouter — unauthenticated redirects', () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    app = createApp();
  });

  it('GET /profile redirects to /auth/login when not authenticated', async () => {
    const res = await request(app).get('/profile');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/login/);
  });

  it('POST /profile/password redirects to /auth/login when not authenticated', async () => {
    const res = await request(app)
      .post('/profile/password')
      .send({ currentPassword: 'x', newPassword: 'newpass1', confirmPassword: 'newpass1' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/login/);
  });

  it('POST /profile/avatar redirects to /auth/login when not authenticated', async () => {
    const res = await request(app).post('/profile/avatar');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/login/);
  });

  it('DELETE /profile/avatar redirects to /auth/login when not authenticated', async () => {
    const res = await request(app).delete('/profile/avatar');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/login/);
  });

  it('GET /profile/avatar/:agentId redirects to /auth/login when not authenticated', async () => {
    const res = await request(app).get('/profile/avatar/agent123456789');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/login/);
  });
});
```

> **Note:** Auth-boundary tests (unauthenticated → redirect) are the appropriate integration-level coverage here. The business logic (validation errors, success paths) is fully covered by the service unit tests. The router's responsibility is wiring auth guards and calling the service — both are tested.

- [ ] **Step 6.2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=profile.router --no-coverage 2>&1 | tail -10
```

Expected: `Cannot find module` or `profileRouter` not found error.

- [ ] **Step 6.3: Implement the router**

```typescript
// src/domains/profile/profile.router.ts
import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { requireAuth, requireRole, requireTwoFactor } from '../../infra/http/middleware/require-auth';
import type { AuthenticatedUser } from '../auth/auth.types';
import * as service from './profile.service';
import { avatarUpload } from './profile.multer';

export const profileRouter = Router();

const profileAuth = [requireAuth(), requireRole('agent', 'admin'), requireTwoFactor()];

// GET /profile — render profile page
profileRouter.get(
  '/profile',
  ...profileAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const profile = await service.getProfile(user.id);
      const template =
        user.role === 'admin'
          ? 'pages/profile/index-admin.njk'
          : 'pages/profile/index.njk';

      res.render(template, {
        pageTitle: 'Profile',
        user,
        hasAvatar: !!profile.avatarPath,
        profile,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /profile/avatar — upload avatar
profileRouter.post(
  '/profile/avatar',
  ...profileAuth,
  avatarUpload.single('avatar'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      if (!req.file) {
        return res.status(400).send('No file uploaded');
      }

      await service.uploadAvatar(user.id, req.file);

      // Return HTMX partial — the avatar element with the new image
      return res.render('partials/profile/avatar-display.njk', {
        user,
        hasAvatar: true,
      });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /profile/avatar — remove avatar
profileRouter.delete(
  '/profile/avatar',
  ...profileAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await service.deleteAvatar(user.id);

      // Return HTMX partial — the initials fallback
      return res.render('partials/profile/avatar-display.njk', {
        user,
        hasAvatar: false,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /profile/password — change password
profileRouter.post(
  '/profile/password',
  ...profileAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { currentPassword, newPassword, confirmPassword } = req.body;

      await service.changePassword(user.id, currentPassword, newPassword, confirmPassword);

      if (req.headers['hx-request']) {
        return res.render('partials/profile/password-result.njk', {
          success: true,
          message: 'Password updated successfully',
        });
      }
      res.redirect('/profile');
    } catch (err) {
      next(err);
    }
  },
);

// GET /profile/avatar/:agentId — serve avatar file (auth-checked)
profileRouter.get(
  '/profile/avatar/:agentId',
  requireAuth(),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const { agentId } = req.params;
      // Sanitise: agentId must be alphanumeric/dash only (cuid2 format)
      if (!/^[a-z0-9_-]{10,32}$/i.test(agentId)) {
        return res.status(400).send('Invalid agent ID');
      }

      const avatarPath = path.resolve('uploads/avatars', `${agentId}.jpg`);
      // Ensure resolved path stays within uploads/avatars directory
      const uploadsDir = path.resolve('uploads/avatars');
      if (!avatarPath.startsWith(uploadsDir)) {
        return res.status(400).send('Invalid path');
      }

      if (!fs.existsSync(avatarPath)) {
        return res.status(404).send('Not found');
      }

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.sendFile(avatarPath);
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 6.4: Run router tests**

```bash
npm test -- --testPathPattern=profile.router --no-coverage 2>&1 | tail -10
```

Expected: Tests pass (unauthenticated redirect cases).

- [ ] **Step 6.5: Commit**

```bash
git add src/domains/profile/profile.router.ts src/domains/profile/__tests__/profile.router.test.ts src/domains/profile/profile.multer.ts
git commit -m "feat(profile): add profile router with auth-protected routes"
```

---

### Task 7: Nunjucks templates — avatar partial, password result partial, profile pages

**Files:**
- Create: `src/views/partials/profile/avatar-display.njk`
- Create: `src/views/partials/profile/password-result.njk`
- Create: `src/views/pages/profile/index.njk` (agent layout)
- Create: `src/views/pages/profile/index-admin.njk` (admin layout)

- [ ] **Step 7.1: Create avatar display partial**

This partial is used for both the initial render and HTMX swaps. It renders the avatar image or initials fallback.

```nunjucks
{# src/views/partials/profile/avatar-display.njk #}
{# Variables: user (AuthenticatedUser), hasAvatar (bool) #}
<div id="avatar-display" class="flex items-center gap-4">
  {%- if hasAvatar %}
    <img
      src="/profile/avatar/{{ user.id }}"
      alt="{{ 'Profile photo' | t }}"
      class="w-16 h-16 rounded-full object-cover border-2 border-gray-200"
    >
  {%- else %}
    {%- set initials = (user.name.split(' ')[0][0] + (user.name.split(' ')[-1][0] if user.name.split(' ') | length > 1 else user.name.split(' ')[0][0])) | upper %}
    <div class="w-16 h-16 rounded-full bg-accent flex items-center justify-center text-white text-xl font-bold select-none">
      {{ initials }}
    </div>
  {%- endif %}
  <div class="flex flex-col gap-1">
    <label for="avatar-file-input" class="cursor-pointer px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded border border-gray-200 text-gray-700">
      {{ "Upload photo" | t }}
    </label>
    {%- if hasAvatar %}
      <button
        hx-delete="/profile/avatar"
        hx-target="#avatar-display"
        hx-swap="outerHTML"
        hx-confirm="{{ 'Remove your profile photo?' | t }}"
        class="px-3 py-1.5 text-sm bg-white hover:bg-red-50 rounded border border-red-200 text-red-600"
      >
        {{ "Remove" | t }}
      </button>
    {%- endif %}
  </div>
</div>
{# Hidden file input — triggered by the Upload label #}
<input
  id="avatar-file-input"
  type="file"
  accept="image/jpeg,image/png"
  class="hidden"
  aria-label="{{ 'Upload profile photo' | t }}"
>
```

- [ ] **Step 7.2: Create password result partial**

```nunjucks
{# src/views/partials/profile/password-result.njk #}
{# Variables: success (bool), message (string) #}
<div id="password-result" class="mt-2 text-sm {% if success %}text-green-600{% else %}text-red-600{% endif %}">
  {{ message | t }}
</div>
```

- [ ] **Step 7.3: Create agent profile page**

```nunjucks
{# src/views/pages/profile/index.njk #}
{% extends "layouts/agent.njk" %}
{% from "partials/shared/icons.njk" import icon %}

{% block title %}{{ "Profile — SellMyHomeNow.sg" | t }}{% endblock %}

{% block content %}
<div class="max-w-lg space-y-6">
  <div>
    <h1 class="font-bold text-2xl text-gray-900">{{ "Profile" | t }}</h1>
    <p class="text-gray-500 text-sm mt-1">{{ "Your account information and security settings" | t }}</p>
  </div>

  {# Account Information #}
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm">
    <div class="px-6 py-4 border-b border-gray-100">
      <h2 class="font-semibold text-gray-900 flex items-center gap-2">
        {{ icon('user') }}{{ "Account Information" | t }}
      </h2>
      <p class="text-xs text-gray-500 mt-0.5">{{ "Your basic account details" | t }}</p>
    </div>
    <div class="px-6 py-4 space-y-5">

      {# Profile photo #}
      <div>
        <p class="text-xs text-gray-400 uppercase tracking-wide mb-2">{{ "Profile photo" | t }}</p>
        {% include "partials/profile/avatar-display.njk" %}
      </div>

      {# Email #}
      <div>
        <p class="text-xs text-gray-400 uppercase tracking-wide mb-1">{{ "Email" | t }}</p>
        <p class="font-medium text-gray-900">{{ profile.email }}</p>
      </div>

      {# Role #}
      <div>
        <p class="text-xs text-gray-400 uppercase tracking-wide mb-1">{{ "Role" | t }}</p>
        {% if profile.role == 'admin' %}
          <span class="inline-block text-xs font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{{ "Admin" | t }}</span>
        {% else %}
          <span class="inline-block text-xs font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{{ "Agent" | t }}</span>
        {% endif %}
      </div>

      {# Member since #}
      <div>
        <p class="text-xs text-gray-400 uppercase tracking-wide mb-1">{{ "Member since" | t }}</p>
        <p class="font-medium text-gray-900">{{ profile.createdAt | date("d MMM yyyy") }}</p>
      </div>

      {# Two-Factor Authentication #}
      <div>
        <p class="text-xs text-gray-400 uppercase tracking-wide mb-2">{{ "Two-Factor Authentication" | t }}</p>
        {% if profile.twoFactorEnabled %}
          <div class="flex items-center gap-2">
            {{ icon('shield-check') }}
            <span class="font-medium text-gray-900">{{ "Enabled" | t }}</span>
            <span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{{ "Active" | t }}</span>
          </div>
        {% else %}
          <div class="flex items-center gap-2">
            {{ icon('shield') }}
            <span class="font-medium text-gray-900">{{ "Not enabled" | t }}</span>
            <a href="/auth/2fa/setup" class="text-xs text-accent hover:underline ml-1">{{ "Set up →" | t }}</a>
          </div>
        {% endif %}
      </div>

    </div>
  </div>

  {# Change Password #}
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm">
    <div class="px-6 py-4 border-b border-gray-100">
      <h2 class="font-semibold text-gray-900">{{ "Change Password" | t }}</h2>
      <p class="text-xs text-gray-500 mt-0.5">{{ "Use at least 8 characters" | t }}</p>
    </div>
    <div class="px-6 py-4">
      <form
        hx-post="/profile/password"
        hx-target="#password-result"
        hx-swap="outerHTML"
        data-action="check-passwords"
        class="space-y-4"
      >
        <div class="space-y-1">
          <label for="currentPassword" class="text-sm text-gray-700">{{ "Current password" | t }}</label>
          <input id="currentPassword" name="currentPassword" type="password" required
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50">
        </div>
        <div class="space-y-1">
          <label for="password" class="text-sm text-gray-700">{{ "New password" | t }}</label>
          <input id="password" name="newPassword" type="password" required minlength="8"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50">
        </div>
        <div class="space-y-1">
          <label for="confirmPassword" class="text-sm text-gray-700">{{ "Confirm new password" | t }}</label>
          <input id="confirmPassword" name="confirmPassword" type="password" required minlength="8"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50">
        </div>
        <p id="password-mismatch" class="text-sm text-red-600 hidden">{{ "Passwords do not match" | t }}</p>
        <div id="password-result"></div>
        <button type="submit"
          class="w-full bg-accent hover:bg-accent-dark text-white font-medium text-sm py-2 rounded-lg transition-colors">
          {{ "Update Password" | t }}
        </button>
      </form>
    </div>
  </div>

</div>

{# Cropper.js avatar crop modal #}
<div id="crop-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/60">
  <div class="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
    <h3 class="font-semibold text-gray-900 mb-4">{{ "Crop profile photo" | t }}</h3>
    <div class="relative w-full aspect-square bg-gray-100 rounded-lg overflow-hidden mb-4">
      <img id="crop-preview" src="" alt="" class="max-w-full">
    </div>
    <div class="flex gap-2">
      <button id="crop-cancel" type="button"
        class="flex-1 py-2 text-sm border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50">
        {{ "Cancel" | t }}
      </button>
      <button id="crop-save" type="button"
        class="flex-1 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent-dark">
        {{ "Save" | t }}
      </button>
    </div>
  </div>
</div>
{% endblock %}

{% block head %}
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/cropperjs@1/dist/cropper.min.css">
<script src="https://cdn.jsdelivr.net/npm/cropperjs@1/dist/cropper.min.js" nonce="{{ cspNonce }}"></script>
<script nonce="{{ cspNonce }}">
(function () {
  var cropper = null;

  document.getElementById('avatar-file-input').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = document.getElementById('crop-preview');
      img.src = ev.target.result;
      document.getElementById('crop-modal').classList.remove('hidden');

      if (cropper) { cropper.destroy(); cropper = null; }
      cropper = new Cropper(img, {
        aspectRatio: 1,
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 1,
      });
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be re-selected
    this.value = '';
  });

  document.getElementById('crop-cancel').addEventListener('click', function () {
    document.getElementById('crop-modal').classList.add('hidden');
    if (cropper) { cropper.destroy(); cropper = null; }
  });

  document.getElementById('crop-save').addEventListener('click', function () {
    if (!cropper) return;
    cropper.getCroppedCanvas({ width: 256, height: 256 }).toBlob(function (blob) {
      var formData = new FormData();
      formData.append('avatar', blob, 'avatar.jpg');

      fetch('/profile/avatar', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin',
      })
        .then(function (res) { return res.text(); })
        .then(function (html) {
          document.getElementById('avatar-display').outerHTML = html;
          document.getElementById('crop-modal').classList.add('hidden');
          if (cropper) { cropper.destroy(); cropper = null; }
        });
    }, 'image/jpeg', 0.85);
  });
})();
</script>
{% endblock %}
```

- [ ] **Step 7.4: Create admin profile page**

```nunjucks
{# src/views/pages/profile/index-admin.njk #}
{% extends "layouts/admin.njk" %}
{% from "partials/shared/icons.njk" import icon %}

{% block title %}{{ "Profile — SellMyHomeNow.sg" | t }}{% endblock %}

{% block content %}
<div class="max-w-lg space-y-6">
  <div>
    <h1 class="font-bold text-2xl text-gray-900">{{ "Profile" | t }}</h1>
    <p class="text-gray-500 text-sm mt-1">{{ "Your account information and security settings" | t }}</p>
  </div>

  {# Account Information #}
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm">
    <div class="px-6 py-4 border-b border-gray-100">
      <h2 class="font-semibold text-gray-900 flex items-center gap-2">
        {{ icon('user') }}{{ "Account Information" | t }}
      </h2>
      <p class="text-xs text-gray-500 mt-0.5">{{ "Your basic account details" | t }}</p>
    </div>
    <div class="px-6 py-4 space-y-5">

      {# Profile photo #}
      <div>
        <p class="text-xs text-gray-400 uppercase tracking-wide mb-2">{{ "Profile photo" | t }}</p>
        {% include "partials/profile/avatar-display.njk" %}
      </div>

      {# Email #}
      <div>
        <p class="text-xs text-gray-400 uppercase tracking-wide mb-1">{{ "Email" | t }}</p>
        <p class="font-medium text-gray-900">{{ profile.email }}</p>
      </div>

      {# Role #}
      <div>
        <p class="text-xs text-gray-400 uppercase tracking-wide mb-1">{{ "Role" | t }}</p>
        {% if profile.role == 'admin' %}
          <span class="inline-block text-xs font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{{ "Admin" | t }}</span>
        {% else %}
          <span class="inline-block text-xs font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{{ "Agent" | t }}</span>
        {% endif %}
      </div>

      {# Member since #}
      <div>
        <p class="text-xs text-gray-400 uppercase tracking-wide mb-1">{{ "Member since" | t }}</p>
        <p class="font-medium text-gray-900">{{ profile.createdAt | date("d MMM yyyy") }}</p>
      </div>

      {# Two-Factor Authentication #}
      <div>
        <p class="text-xs text-gray-400 uppercase tracking-wide mb-2">{{ "Two-Factor Authentication" | t }}</p>
        {% if profile.twoFactorEnabled %}
          <div class="flex items-center gap-2">
            {{ icon('shield-check') }}
            <span class="font-medium text-gray-900">{{ "Enabled" | t }}</span>
            <span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{{ "Active" | t }}</span>
          </div>
        {% else %}
          <div class="flex items-center gap-2">
            {{ icon('shield') }}
            <span class="font-medium text-gray-900">{{ "Not enabled" | t }}</span>
            <a href="/auth/2fa/setup" class="text-xs text-accent hover:underline ml-1">{{ "Set up →" | t }}</a>
          </div>
        {% endif %}
      </div>

    </div>
  </div>

  {# Change Password #}
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm">
    <div class="px-6 py-4 border-b border-gray-100">
      <h2 class="font-semibold text-gray-900">{{ "Change Password" | t }}</h2>
      <p class="text-xs text-gray-500 mt-0.5">{{ "Use at least 8 characters" | t }}</p>
    </div>
    <div class="px-6 py-4">
      <form
        hx-post="/profile/password"
        hx-target="#password-result"
        hx-swap="outerHTML"
        data-action="check-passwords"
        class="space-y-4"
      >
        <div class="space-y-1">
          <label for="currentPassword" class="text-sm text-gray-700">{{ "Current password" | t }}</label>
          <input id="currentPassword" name="currentPassword" type="password" required
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50">
        </div>
        <div class="space-y-1">
          <label for="password" class="text-sm text-gray-700">{{ "New password" | t }}</label>
          <input id="password" name="newPassword" type="password" required minlength="8"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50">
        </div>
        <div class="space-y-1">
          <label for="confirmPassword" class="text-sm text-gray-700">{{ "Confirm new password" | t }}</label>
          <input id="confirmPassword" name="confirmPassword" type="password" required minlength="8"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50">
        </div>
        <p id="password-mismatch" class="text-sm text-red-600 hidden">{{ "Passwords do not match" | t }}</p>
        <div id="password-result"></div>
        <button type="submit"
          class="w-full bg-accent hover:bg-accent-dark text-white font-medium text-sm py-2 rounded-lg transition-colors">
          {{ "Update Password" | t }}
        </button>
      </form>
    </div>
  </div>

</div>

{# Cropper.js avatar crop modal #}
<div id="crop-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/60">
  <div class="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
    <h3 class="font-semibold text-gray-900 mb-4">{{ "Crop profile photo" | t }}</h3>
    <div class="relative w-full aspect-square bg-gray-100 rounded-lg overflow-hidden mb-4">
      <img id="crop-preview" src="" alt="" class="max-w-full">
    </div>
    <div class="flex gap-2">
      <button id="crop-cancel" type="button"
        class="flex-1 py-2 text-sm border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50">
        {{ "Cancel" | t }}
      </button>
      <button id="crop-save" type="button"
        class="flex-1 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent-dark">
        {{ "Save" | t }}
      </button>
    </div>
  </div>
</div>
{% endblock %}

{% block head %}
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/cropperjs@1/dist/cropper.min.css">
<script src="https://cdn.jsdelivr.net/npm/cropperjs@1/dist/cropper.min.js" nonce="{{ cspNonce }}"></script>
<script nonce="{{ cspNonce }}">
(function () {
  var cropper = null;

  document.getElementById('avatar-file-input').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = document.getElementById('crop-preview');
      img.src = ev.target.result;
      document.getElementById('crop-modal').classList.remove('hidden');

      if (cropper) { cropper.destroy(); cropper = null; }
      cropper = new Cropper(img, {
        aspectRatio: 1,
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 1,
      });
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be re-selected
    this.value = '';
  });

  document.getElementById('crop-cancel').addEventListener('click', function () {
    document.getElementById('crop-modal').classList.add('hidden');
    if (cropper) { cropper.destroy(); cropper = null; }
  });

  document.getElementById('crop-save').addEventListener('click', function () {
    if (!cropper) return;
    cropper.getCroppedCanvas({ width: 256, height: 256 }).toBlob(function (blob) {
      var formData = new FormData();
      formData.append('avatar', blob, 'avatar.jpg');

      fetch('/profile/avatar', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin',
      })
        .then(function (res) { return res.text(); })
        .then(function (html) {
          document.getElementById('avatar-display').outerHTML = html;
          document.getElementById('crop-modal').classList.add('hidden');
          if (cropper) { cropper.destroy(); cropper = null; }
        });
    }, 'image/jpeg', 0.85);
  });
})();
</script>
{% endblock %}
```

> **Note:** The only difference between `index.njk` and `index-admin.njk` is the `{% extends %}` line. Do not create a shared include for this — the duplication is minimal (two thin wrappers) and avoids triple-nesting complexity.

- [ ] **Step 7.5: Verify templates render without errors**

```bash
npm run dev &
sleep 3
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/profile
kill %1
```

Expected: `302` (redirect to login — template exists and router is mounted correctly).

- [ ] **Step 7.6: Commit**

```bash
git add src/views/partials/profile/ src/views/pages/profile/
git commit -m "feat(profile): add profile page templates and HTMX partials"
```

---

### Task 8: Mount profile router in app.ts

**Files:**
- Modify: `src/infra/http/app.ts`

- [ ] **Step 8.1: Add profile router import and mount**

In `src/infra/http/app.ts`, add the import near the other domain router imports (line ~29):

```typescript
import { profileRouter } from '../../domains/profile/profile.router';
```

Then in the routes section, add it after `agentSettingsRouter` (line ~166):

```typescript
app.use(agentSettingsRouter);
app.use(profileRouter);          // ← add this line
app.use('/api', apiRateLimiter);
```

- [ ] **Step 8.2: Run full test suite to check nothing broke**

```bash
npm test --no-coverage 2>&1 | tail -15
```

Expected: All existing tests still pass. New profile tests pass.

- [ ] **Step 8.3: Commit**

```bash
git add src/infra/http/app.ts
git commit -m "feat(profile): mount profile router in app"
```

---

## Chunk 3: Top Header + Layout Updates

### Task 9: Top header partial

**Files:**
- Create: `src/views/partials/shared/top-header.njk`

- [ ] **Step 9.1: Create the top header partial**

```nunjucks
{# src/views/partials/shared/top-header.njk #}
{# Variables: user (AuthenticatedUser), pageTitle (string), hasAvatar (bool) #}
{# Requires: icons partial imported in the calling layout via {% from ... import icon %} #}
<header class="fixed top-0 left-0 right-0 z-30 h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-6">

  {# Left: mobile sidebar toggle + page title #}
  <div class="flex items-center gap-3">
    <button data-action="toggle-sidebar" class="md:hidden text-gray-500 hover:text-gray-800" aria-label="{{ 'Toggle navigation' | t }}">
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
      </svg>
    </button>
    <span class="font-semibold text-gray-900 text-sm md:text-base">{{ pageTitle | t }}</span>
  </div>

  {# Right: user dropdown trigger #}
  <div class="relative">
    <button
      data-action="toggle-user-menu"
      class="flex items-center gap-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-full px-3 py-1.5 transition-colors"
      aria-haspopup="true"
      aria-expanded="false"
      id="user-menu-btn"
    >
      {%- if hasAvatar %}
        <img
          src="/profile/avatar/{{ user.id }}"
          alt="{{ 'Profile' | t }}"
          class="w-7 h-7 rounded-full object-cover"
        >
      {%- else %}
        {%- set initials = (user.name.split(' ')[0][0] + (user.name.split(' ')[-1][0] if user.name.split(' ') | length > 1 else user.name.split(' ')[0][0])) | upper %}
        <span class="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-white text-xs font-bold">{{ initials }}</span>
      {%- endif %}
      <span class="hidden md:inline text-sm font-medium text-gray-700 max-w-[120px] truncate">
        {{ user.email.split('@')[0] }}
      </span>
      <svg class="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
      </svg>
    </button>

    {# Dropdown menu — hidden by default, toggled by app.js #}
    <div
      id="user-menu-dropdown"
      class="hidden absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden"
      role="menu"
    >
      <div class="px-4 py-3 border-b border-gray-100">
        <p class="text-sm font-semibold text-gray-900 truncate">{{ user.name }}</p>
        <p class="text-xs text-gray-500 truncate">{{ user.email }}</p>
      </div>
      <div class="p-1">
        <a
          href="/profile"
          class="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded-lg hover:bg-gray-50"
          role="menuitem"
        >
          {{ icon('user') }}{{ "Profile" | t }}
        </a>
      </div>
      <div class="border-t border-gray-100 p-1">
        <a
          href="/auth/logout"
          class="flex items-center gap-2 px-3 py-2 text-sm text-red-600 rounded-lg hover:bg-red-50"
          role="menuitem"
        >
          {{ icon('arrow-right-on-rectangle') }}{{ "Log out" | t }}
        </a>
      </div>
    </div>
  </div>
</header>
```

- [ ] **Step 9.2: Commit**

```bash
git add src/views/partials/shared/top-header.njk
git commit -m "feat(profile): add top-header partial with user dropdown"
```

---

### Task 10: Update `app.js` — user menu toggle

**Files:**
- Modify: `public/js/app.js`

- [ ] **Step 10.1: Add user menu toggle to the click delegation block**

In `public/js/app.js`, inside the `document.addEventListener('click', ...)` block, add the following case **after** the `toggle-sidebar` block (around line 140):

```javascript
    // Toggle user menu dropdown open/closed
    if (action === 'toggle-user-menu') {
      var dropdown = document.getElementById('user-menu-dropdown');
      var btn = document.getElementById('user-menu-btn');
      if (dropdown) {
        var isOpen = !dropdown.classList.contains('hidden');
        dropdown.classList.toggle('hidden', isOpen);
        if (btn) btn.setAttribute('aria-expanded', String(!isOpen));
      }
    }
```

- [ ] **Step 10.2: Add outside-click handler to close the menu**

After the `document.addEventListener('click', ...)` block closes (after the `});` on line ~163), add:

```javascript
  // ── Close user menu on outside click ──────────────────────────
  document.addEventListener('click', function (e) {
    var dropdown = document.getElementById('user-menu-dropdown');
    var btn = document.getElementById('user-menu-btn');
    if (!dropdown || dropdown.classList.contains('hidden')) return;
    if (btn && (btn === e.target || btn.contains(e.target))) return;
    dropdown.classList.add('hidden');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
```

- [ ] **Step 10.3: Commit**

```bash
git add public/js/app.js
git commit -m "feat(profile): add user menu toggle to app.js"
```

---

### Task 11: Update admin and agent layouts

**Files:**
- Modify: `src/views/layouts/admin.njk`
- Modify: `src/views/layouts/agent.njk`

**Summary of changes for each layout:**

1. Remove the `md:hidden` mobile-only header `<div>` block (lines 9-15 in admin.njk, lines 5-11 in agent.njk)
2. Include `top-header.njk` partial at the top of `{% block body %}`
3. Change the flex wrapper from `<div class="flex min-h-screen">` to `<div class="flex min-h-screen pt-16">` (offset for fixed header)
4. On the `<aside>`: change `inset-y-0` to `top-16 bottom-0` (mobile sidebar starts below the header)
5. On `<main>`: remove `pt-16 md:pt-8` (the wrapper `pt-16` handles vertical offset now)
6. Remove the standalone "Sign Out" link at the bottom of the sidebar footer `<div>` (the header dropdown handles logout)

- [ ] **Step 11.1: Update admin.njk**

The updated `admin.njk` should look like this (full file):

```nunjucks
{% extends "layouts/base.njk" %}
{% from "partials/shared/icons.njk" import icon %}

{% block head %}
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js" nonce="{{ cspNonce }}"></script>
{% endblock %}

{% block body %}
{# Top header — always visible, contains user dropdown #}
{% include "partials/shared/top-header.njk" %}

{# Sidebar backdrop — mobile overlay #}
<div id="sidebar-backdrop" class="hidden fixed inset-0 bg-black/40 z-40 md:hidden" data-action="toggle-sidebar"></div>

<div class="flex min-h-screen pt-16">
  <aside id="sidebar" class="hidden md:flex w-64 bg-ink text-white p-4 flex-col flex-shrink-0 fixed md:static top-16 bottom-0 md:top-auto md:bottom-auto left-0 z-50">
    <div class="text-lg font-bold mb-6">{{ "Admin Portal" | t }}</div>
    <nav class="space-y-1 flex-1">
      <a href="/admin/dashboard" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/dashboard' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('home') }}{{ "Dashboard" | t }}</a>
      <a href="/admin/pipeline" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/pipeline' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('funnel') }}{{ "Pipeline" | t }}</a>
      <a href="/admin/leads" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/leads' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('user-plus') }}{{ "Leads" | t }}</a>
      <a href="/admin/sellers" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/sellers' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('users') }}{{ "All Sellers" | t }}</a>
      <a href="/admin/compliance/deletion-queue" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/compliance/deletion-queue' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('shield-check') }}{{ "Compliance" | t }}</a>
      <a href="/admin/content/market" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/content/market' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('chart-bar') }}{{ "Market Content" | t }}</a>
      <a href="/admin/content/testimonials" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/content/testimonials' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('star') }}{{ "Testimonials" | t }}</a>
      <a href="/admin/content/referrals" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/content/referrals' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('share') }}{{ "Referrals" | t }}</a>
      <a href="/admin/review" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/review' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('queue-list') }}{{ "Review Queue" | t }}</a>

      <div class="border-t border-white/10 my-3"></div>
      <p class="px-3 py-1 text-xs text-gray-400 uppercase tracking-wider">{{ "Admin" | t }}</p>

      <a href="/admin/team" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/team' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('user-group') }}{{ "Team" | t }}</a>
      <a href="/admin/tutorials" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/tutorials' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('academic-cap') }}{{ "Tutorials" | t }}</a>
      <a href="/admin/hdb" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/hdb' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('building-office-2') }}{{ "HDB Data" | t }}</a>
      <a href="/admin/notifications" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/notifications' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('bell') }}{{ "Notifications" | t }}</a>
      <a href="/admin/audit" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/audit' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('clipboard-document-list') }}{{ "Audit Log" | t }}</a>
      <a href="/admin/settings" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/settings' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('cog-6-tooth') }}{{ "Settings" | t }}</a>
    </nav>
    {# Sidebar footer: logout link removed — logout is now in the top-right header dropdown #}
  </aside>
  <main class="flex-1 p-8 overflow-auto">
    {% block content %}{% endblock %}
  </main>
</div>
{% endblock %}
```

- [ ] **Step 11.2: Update agent.njk**

```nunjucks
{% extends "layouts/base.njk" %}
{% from "partials/shared/icons.njk" import icon %}

{% block body %}
{# Top header — always visible, contains user dropdown #}
{% include "partials/shared/top-header.njk" %}

{# Sidebar backdrop — mobile overlay #}
<div id="sidebar-backdrop" class="hidden fixed inset-0 bg-black/40 z-40 md:hidden" data-action="toggle-sidebar"></div>

<div class="flex min-h-screen pt-16">
  <aside id="sidebar" class="hidden md:flex w-64 bg-ink text-white p-4 flex-col flex-shrink-0 fixed md:static top-16 bottom-0 md:top-auto md:bottom-auto left-0 z-50">
    <div class="text-lg font-bold mb-6">{{ "Agent Portal" | t }}</div>
    <nav class="space-y-1 flex-1">
      <a href="/agent/dashboard" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/agent/dashboard' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('home') }}{{ "Dashboard" | t }}</a>
      <div class="border-t border-white/10 my-2"></div>
      <a href="/agent/leads" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/agent/leads' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('user-plus') }}{{ "Leads" | t }}</a>
      <a href="/agent/sellers" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/agent/sellers' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('users') }}{{ "Sellers" | t }}</a>
      <a href="/agent/reviews" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/agent/reviews' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('clipboard-document-check') }}{{ "Reviews" | t }}
        {% if pendingReviewCount %}<span class="ml-auto bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">{{ pendingReviewCount }}</span>{% endif %}
      </a>
      <div class="border-t border-white/10 my-2"></div>
      <a href="/agent/settings" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/agent/settings' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('cog-6-tooth') }}{{ "Settings" | t }}</a>
    </nav>
    {# Sidebar footer: logout link removed — logout is now in the top-right header dropdown #}
  </aside>
  <main class="flex-1 p-8 bg-bg overflow-auto">
    {% block content %}{% endblock %}
  </main>
</div>
{% endblock %}
```

- [ ] **Step 11.3: Commit**

```bash
git add src/views/layouts/admin.njk src/views/layouts/agent.njk
git commit -m "feat(profile): add top header to admin and agent layouts"
```

---

### Task 12: Pass `pageTitle`, `user`, and `hasAvatar` from existing routers

**Files:**
- Modify: `src/domains/agent/agent.router.ts`
- Modify: `src/domains/admin/admin.router.ts`

The top header needs `pageTitle`, `user`, and `hasAvatar` in every render call that uses `admin.njk` or `agent.njk`. Currently these routers don't pass these variables.

- [ ] **Step 12.1: Add profile lookup helper in profile service**

Add this export to `src/domains/profile/profile.service.ts`:

```typescript
/** Lightweight check — used by routers to populate hasAvatar in the header */
export async function getHasAvatar(agentId: string): Promise<boolean> {
  const agent = await repo.findAgentById(agentId);
  return !!agent?.avatarPath;
}
```

- [ ] **Step 12.2: Update agent.router.ts — add `pageTitle` and `hasAvatar` to all `res.render` calls**

Open `src/domains/agent/agent.router.ts`. Add this import at the top of the file:

```typescript
import { getHasAvatar } from '../profile/profile.service';
```

**Pattern:** Only call `getHasAvatar` in the full-page branch (not inside `if (req.headers['hx-request'])`). Insert `const hasAvatar = await getHasAvatar(user.id);` immediately before the full-page `res.render()` call.

Apply these exact changes to each full-page render:

**`GET /agent/dashboard`** — `user` already extracted:
```typescript
// Before:
res.render('pages/agent/dashboard', { overview, repeatViewers, currentStage });
// After:
const hasAvatar = await getHasAvatar(user.id);
res.render('pages/agent/dashboard', { pageTitle: 'Dashboard', user, hasAvatar, overview, repeatViewers, currentStage });
```

**`GET /agent/leads`** — `user` already extracted:
```typescript
// Before:
res.render('pages/agent/leads', { unassigned, all });
// After:
const hasAvatar = await getHasAvatar(user.id);
res.render('pages/agent/leads', { pageTitle: 'Leads', user, hasAvatar, unassigned, all });
```

**`GET /agent/sellers`** — `user` already extracted:
```typescript
// Before:
res.render('pages/agent/sellers', { result });
// After:
const hasAvatar = await getHasAvatar(user.id);
res.render('pages/agent/sellers', { pageTitle: 'Sellers', user, hasAvatar, result });
```

**`GET /agent/sellers/:id`** — `user` already extracted:
```typescript
// Before:
res.render('pages/agent/seller-detail', { seller, compliance, notifications, milestones, sellerId: seller.id, isAdmin });
// After:
const hasAvatar = await getHasAvatar(user.id);
res.render('pages/agent/seller-detail', { pageTitle: 'Seller Detail', user, hasAvatar, seller, compliance, notifications, milestones, sellerId: seller.id, isAdmin });
```

**`GET /agent/corrections`** — `user` is NOT currently extracted; add extraction before `getHasAvatar`:
```typescript
// Add at start of handler (before existing code):
const user = req.user as AuthenticatedUser;
// Before:
return res.render('pages/agent/correction-requests', { requests, title: 'Data Correction Requests' });
// After:
const hasAvatar = await getHasAvatar(user.id);
return res.render('pages/agent/correction-requests', { pageTitle: 'Data Corrections', user, hasAvatar, requests, title: 'Data Correction Requests' });
```

- [ ] **Step 12.3: Update admin.router.ts — same pattern**

Add this import at the top of `src/domains/admin/admin.router.ts`:

```typescript
import { getHasAvatar } from '../profile/profile.service';
```

**Pattern:** Same as agent — only call `getHasAvatar` in the non-HTMX branch. For admin routes, most handlers do NOT currently extract `req.user`. Add `const user = req.user as AuthenticatedUser;` at the start of each handler that needs it, then insert `const hasAvatar = await getHasAvatar(user.id);` immediately before the full-page render.

Apply these exact changes:

**`GET /admin/dashboard`** — no user extraction currently:
```typescript
// Add before full-page render:
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
res.render('pages/admin/dashboard', { analytics, filter, currentPath: '/admin/dashboard' });
// After:
res.render('pages/admin/dashboard', { pageTitle: 'Dashboard', user, hasAvatar, analytics, filter, currentPath: '/admin/dashboard' });
```

**`GET /admin/pipeline`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
res.render('pages/admin/pipeline', { pipeline, stageCounts, stage, currentPath: '/admin/pipeline' });
// After:
res.render('pages/admin/pipeline', { pageTitle: 'Pipeline', user, hasAvatar, pipeline, stageCounts, stage, currentPath: '/admin/pipeline' });
```

**`GET /admin/leads`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
res.render('pages/admin/leads', { unassigned, all, currentPath: '/admin/leads' });
// After:
res.render('pages/admin/leads', { pageTitle: 'Leads', user, hasAvatar, unassigned, all, currentPath: '/admin/leads' });
```

**`GET /admin/review`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
res.render('pages/admin/review-queue', { queue, activeTab, currentPath: '/admin/review' });
// After:
res.render('pages/admin/review-queue', { pageTitle: 'Review Queue', user, hasAvatar, queue, activeTab, currentPath: '/admin/review' });
```

**`GET /admin/audit`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
res.render('pages/admin/audit-log', { result, filter, currentPath: '/admin/audit' });
// After:
res.render('pages/admin/audit-log', { pageTitle: 'Audit Log', user, hasAvatar, result, filter, currentPath: '/admin/audit' });
```

**`GET /admin/notifications`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
res.render('pages/admin/notifications', { result, filter, currentPath: '/admin/notifications' });
// After:
res.render('pages/admin/notifications', { pageTitle: 'Notifications', user, hasAvatar, result, filter, currentPath: '/admin/notifications' });
```

**`GET /admin/team`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
res.render('pages/admin/team', { team, currentPath: '/admin/team' });
// After:
res.render('pages/admin/team', { pageTitle: 'Team', user, hasAvatar, team, currentPath: '/admin/team' });
```

**`GET /admin/team/:id/pipeline`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
res.render('pages/admin/team-pipeline', { agent, sellers: sellersResult.sellers, sellersTotal: sellersResult.total, currentPath: '/admin/team' });
// After:
res.render('pages/admin/team-pipeline', { pageTitle: 'Team Pipeline', user, hasAvatar, agent, sellers: sellersResult.sellers, sellersTotal: sellersResult.total, currentPath: '/admin/team' });
```

**`GET /admin/sellers`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
res.render('pages/admin/sellers', { result, team, currentPath: '/admin/sellers' });
// After:
res.render('pages/admin/sellers', { pageTitle: 'Sellers', user, hasAvatar, result, team, currentPath: '/admin/sellers' });
```

**`GET /admin/sellers/:id`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
res.render('pages/admin/seller-detail', { detail });
// After:
res.render('pages/admin/seller-detail', { pageTitle: 'Seller Detail', user, hasAvatar, detail });
```

**`GET /admin/settings`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
res.render('pages/admin/settings', { groups, currentPath: '/admin/settings' });
// After:
res.render('pages/admin/settings', { pageTitle: 'Settings', user, hasAvatar, groups, currentPath: '/admin/settings' });
```

**`GET /admin/hdb`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
res.render('pages/admin/hdb', { status, currentPath: '/admin/hdb' });
// After:
res.render('pages/admin/hdb', { pageTitle: 'HDB', user, hasAvatar, status, currentPath: '/admin/hdb' });
```

**`GET /admin/compliance/deletion-queue`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
return res.render('pages/admin/compliance/deletion-queue', { requests, title: 'Data Deletion Queue', currentPath: '/admin/compliance/deletion-queue' });
// After:
return res.render('pages/admin/compliance/deletion-queue', { pageTitle: 'Deletion Queue', user, hasAvatar, requests, title: 'Data Deletion Queue', currentPath: '/admin/compliance/deletion-queue' });
```

**`GET /admin/tutorials`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
return res.render('pages/admin/tutorials', { tutorials: activeItems, activeTab, tabCounts, currentPath: '/admin/tutorials' });
// After:
return res.render('pages/admin/tutorials', { pageTitle: 'Tutorials', user, hasAvatar, tutorials: activeItems, activeTab, tabCounts, currentPath: '/admin/tutorials' });
```

**`GET /admin/tutorials/new`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
return res.render('pages/admin/tutorial-form', { tutorial: null, errors: [], preselectedCategory, currentPath: '/admin/tutorials' });
// After:
return res.render('pages/admin/tutorial-form', { pageTitle: 'New Tutorial', user, hasAvatar, tutorial: null, errors: [], preselectedCategory, currentPath: '/admin/tutorials' });
```

**`GET /admin/tutorials/:id/edit`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
return res.render('pages/admin/tutorial-form', { tutorial, errors: [], currentPath: '/admin/tutorials' });
// After:
return res.render('pages/admin/tutorial-form', { pageTitle: 'Edit Tutorial', user, hasAvatar, tutorial, errors: [], currentPath: '/admin/tutorials' });
```

**`GET /admin/content/market`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
return res.render('pages/admin/market-content', { records, error: notice, currentPath: '/admin/content/market' });
// After:
return res.render('pages/admin/market-content', { pageTitle: 'Market Content', user, hasAvatar, records, error: notice, currentPath: '/admin/content/market' });
```

**`GET /admin/content/market/:id`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
return res.render('pages/admin/market-content-detail', { record, currentPath: '/admin/content/market' });
// After:
return res.render('pages/admin/market-content-detail', { pageTitle: 'Market Content', user, hasAvatar, record, currentPath: '/admin/content/market' });
```

**`GET /admin/content/testimonials`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
return res.render('pages/admin/testimonials', { records, currentPath: '/admin/content/testimonials' });
// After:
return res.render('pages/admin/testimonials', { pageTitle: 'Testimonials', user, hasAvatar, records, currentPath: '/admin/content/testimonials' });
```

**`GET /admin/content/referrals`** — no user extraction:
```typescript
const user = req.user as AuthenticatedUser;
const hasAvatar = await getHasAvatar(user.id);
// Before:
return res.render('pages/admin/referrals', { records, funnel, topReferrers, baseUrl, currentPath: '/admin/content/referrals' });
// After:
return res.render('pages/admin/referrals', { pageTitle: 'Referrals', user, hasAvatar, records, funnel, topReferrers, baseUrl, currentPath: '/admin/content/referrals' });
```

> **Note on error-path renders (POST handlers):** The `POST /admin/tutorials`, `POST /admin/tutorials/:id`, and `POST /admin/content/market/run` handlers also call `res.render(...)` in validation-error or conflict-error branches. These render the same page templates with form values — add `user` and `hasAvatar` to these calls too (using the same pattern: extract user, call `getHasAvatar`, add to render object). Use the same `pageTitle` as the corresponding GET route.

- [ ] **Step 12.4: Run all tests**

```bash
npm test --no-coverage 2>&1 | tail -20
```

Expected: All tests pass. If any agent/admin router tests fail because of the new `getHasAvatar` call, mock `../profile/profile.service` in those test files:

```typescript
jest.mock('../profile/profile.service');
const profileService = jest.requireMock('../profile/profile.service');
profileService.getHasAvatar = jest.fn().mockResolvedValue(false);
```

- [ ] **Step 12.5: Commit**

```bash
git add src/domains/agent/agent.router.ts src/domains/admin/admin.router.ts src/domains/profile/profile.service.ts
git commit -m "feat(profile): pass pageTitle and hasAvatar to all admin/agent renders"
```

---

### Task 13: Final verification

- [ ] **Step 13.1: Run full test suite**

```bash
npm test --no-coverage 2>&1 | tail -20
```

Expected: All tests pass. Note the total test count in the output for reference.

- [ ] **Step 13.2: Build Tailwind to pick up new class names**

```bash
npm run build 2>&1 | tail -10
```

Expected: No errors. `public/css/output.css` updated.

- [ ] **Step 13.3: Smoke test manually**

> **Prerequisite:** This smoke test requires all three chunks to be implemented (Tasks 1–12). Run it only after completing Task 12.

```bash
npm run dev
```

1. Log in as an agent → verify the top header appears with your name/initials pill in the top-right
2. Click the pill → verify dropdown shows name, email, Profile link, Log out
3. Click Profile → verify profile page renders with Account Information and Change Password cards
4. Upload an avatar photo → verify crop modal appears, save → verify avatar appears in both page and header
5. Remove avatar → verify initials fallback appears
6. Change password → verify success message
7. Log in as admin → verify same top header appears on admin pages

- [ ] **Step 13.4: Final commit**

```bash
git add -A
git commit -m "feat(profile): complete user profile feature — top header, avatar upload, profile page"
```
