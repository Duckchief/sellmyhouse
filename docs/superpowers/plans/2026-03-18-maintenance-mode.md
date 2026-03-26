# Maintenance Mode Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated admin page to toggle maintenance mode on/off, with an Apple-style switch and optional custom message/ETA, backed by a professional public 503 page featuring the pixel-art space monkey mascot.

**Architecture:** A middleware in `src/infra/http/app.ts` checks the `maintenance_mode` SystemSetting on every request, bypassing admins and agents and serving a standalone 503 page to everyone else. The admin control page at `/admin/maintenance` uses HTMX to toggle the setting and update optional message/ETA fields in-place. Two new setting keys (`maintenance_message`, `maintenance_eta`) are added to `SETTING_KEYS`.

**Tech Stack:** Express, Nunjucks, HTMX, Tailwind CSS, Prisma (via settings service), Jest

---

## Chunk 1: Settings Keys, Middleware, and Public Page

### Task 1: Add new SystemSetting keys

**Files:**
- Modify: `src/domains/shared/settings.types.ts`

- [ ] **Step 1: Open `src/domains/shared/settings.types.ts` and add two new keys to `SETTING_KEYS`**

Add after `MAINTENANCE_MODE: 'maintenance_mode'`:

```typescript
MAINTENANCE_MESSAGE: 'maintenance_message',
MAINTENANCE_ETA: 'maintenance_eta',
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -20
```

Expected: no errors relating to settings.types.ts

- [ ] **Step 3: Commit**

```bash
git add src/domains/shared/settings.types.ts
git commit -m "feat: add maintenance_message and maintenance_eta setting keys"
```

---

### Task 2: Copy space monkey image to public directory

**Files:**
- Create: `public/images/space-monkey-maintenance.png`

- [ ] **Step 1: Copy the image**

```bash
cp /Users/david/Downloads/space-monkey-maintenance.png public/images/space-monkey-maintenance.png
```

- [ ] **Step 2: Verify**

```bash
ls -lh public/images/space-monkey-maintenance.png
```

Expected: file exists, size looks reasonable (> 10KB)

- [ ] **Step 3: Commit**

```bash
git add public/images/space-monkey-maintenance.png
git commit -m "feat: add space monkey maintenance mascot image"
```

---

### Task 3: Create maintenance middleware

**Files:**
- Create: `src/infra/http/middleware/maintenance.ts`

- [ ] **Step 1: Write the failing test**

Create `src/infra/http/middleware/__tests__/maintenance.test.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import * as settingsService from '@/domains/shared/settings.service';

jest.mock('@/domains/shared/settings.service');

const mockSettings = settingsService as jest.Mocked<typeof settingsService>;

// Import after mocking
import { maintenanceMiddleware } from '../maintenance';

function makeReq(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    path: '/seller/dashboard',
    isAuthenticated: () => false,
    user: undefined,
    headers: {},
    ...overrides,
  };
}

function makeRes(): Partial<Response> {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  res.render = jest.fn().mockReturnValue(res);
  res.locals = {};
  return res;
}

describe('maintenanceMiddleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
  });

  it('passes through when maintenance_mode is false', async () => {
    mockSettings.get.mockResolvedValue('false');
    const req = makeReq() as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.render).not.toHaveBeenCalled();
  });

  it('passes through when maintenance_mode setting is missing (defaults false)', async () => {
    mockSettings.get.mockResolvedValue('false');
    const req = makeReq() as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('passes through admin routes even when maintenance is on', async () => {
    mockSettings.get.mockResolvedValue('true');
    const req = makeReq({ path: '/admin/maintenance' }) as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.render).not.toHaveBeenCalled();
  });

  it('passes through for admin role', async () => {
    mockSettings.get.mockResolvedValue('true');
    const req = makeReq({
      path: '/seller/dashboard',
      isAuthenticated: () => true,
      user: { id: 'u1', role: 'admin' } as any,
    }) as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.render).not.toHaveBeenCalled();
  });

  it('passes through for agent role', async () => {
    mockSettings.get.mockResolvedValue('true');
    const req = makeReq({
      path: '/seller/dashboard',
      isAuthenticated: () => true,
      user: { id: 'u1', role: 'agent' } as any,
    }) as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.render).not.toHaveBeenCalled();
  });

  it('renders 503 maintenance page for public visitor when maintenance is on', async () => {
    mockSettings.get.mockImplementation(async (key: string) => {
      if (key === 'maintenance_mode') return 'true';
      return '';
    });
    const req = makeReq({ path: '/' }) as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '3600');
    expect(res.render).toHaveBeenCalledWith(
      'pages/public/maintenance',
      expect.objectContaining({ maintenanceMessage: '', maintenanceEta: '' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('renders 503 maintenance page for logged-in seller when maintenance is on', async () => {
    mockSettings.get.mockImplementation(async (key: string) => {
      if (key === 'maintenance_mode') return 'true';
      if (key === 'maintenance_message') return 'Upgrading the system.';
      return '';
    });
    const req = makeReq({
      path: '/seller/dashboard',
      isAuthenticated: () => true,
      user: { id: 'u1', role: 'seller' } as any,
    }) as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.render).toHaveBeenCalledWith(
      'pages/public/maintenance',
      expect.objectContaining({ maintenanceMessage: 'Upgrading the system.' }),
    );
  });

  it('passes error to next when settings service throws', async () => {
    const err = new Error('DB error');
    mockSettings.get.mockRejectedValue(err);
    const req = makeReq() as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx jest src/infra/http/middleware/__tests__/maintenance.test.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — "Cannot find module '../maintenance'"

- [ ] **Step 3: Create the middleware**

Create `src/infra/http/middleware/maintenance.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import * as settingsService from '@/domains/shared/settings.service';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';

export async function maintenanceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const isOn = await settingsService.get('maintenance_mode', 'false');
    if (isOn !== 'true') {
      return next();
    }

    // Admin routes always bypass
    if (req.path.startsWith('/admin')) {
      return next();
    }

    // Admins and agents bypass
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      const user = req.user as AuthenticatedUser;
      if (user.role === 'admin' || user.role === 'agent') {
        return next();
      }
    }

    const maintenanceMessage = await settingsService.get('maintenance_message', '');
    const maintenanceEta = await settingsService.get('maintenance_eta', '');

    res.status(503);
    res.setHeader('Retry-After', '3600');
    res.render('pages/public/maintenance', { maintenanceMessage, maintenanceEta });
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest src/infra/http/middleware/__tests__/maintenance.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — all 8 tests green

- [ ] **Step 5: Commit**

```bash
git add src/infra/http/middleware/maintenance.ts src/infra/http/middleware/__tests__/maintenance.test.ts
git commit -m "feat: add maintenance mode middleware with admin/agent bypass"
```

---

### Task 4: Create public maintenance page view

**Files:**
- Create: `src/views/pages/public/maintenance.njk`

- [ ] **Step 1: Create the Nunjucks template**

Create `src/views/pages/public/maintenance.njk`:

```nunjucks
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Scheduled Maintenance — SellMyHouse.sg</title>
  <link rel="stylesheet" href="/styles.css" />
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #ffffff;
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .maintenance-container {
      text-align: center;
      max-width: 480px;
      padding: 2rem;
    }
    .maintenance-monkey {
      width: 180px;
      height: 180px;
      object-fit: contain;
      image-rendering: pixelated;
      margin-bottom: 2rem;
    }
    .maintenance-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: #1e293b;
      margin: 0 0 0.75rem;
    }
    .maintenance-body {
      font-size: 1rem;
      color: #475569;
      line-height: 1.6;
      margin: 0 0 1.5rem;
    }
    .maintenance-message {
      font-size: 0.9rem;
      color: #64748b;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      margin-bottom: 1rem;
    }
    .maintenance-eta {
      font-size: 0.875rem;
      color: #64748b;
      margin-bottom: 1.5rem;
    }
    .maintenance-footer {
      font-size: 0.75rem;
      color: #94a3b8;
      border-top: 1px solid #f1f5f9;
      padding-top: 1.5rem;
      margin-top: 1.5rem;
    }
  </style>
</head>
<body>
  <div class="maintenance-container">
    <img
      src="/images/space-monkey-maintenance.png"
      alt="Maintenance in progress"
      class="maintenance-monkey"
    />
    <h1 class="maintenance-title">{{ "We're currently performing scheduled maintenance." | t }}</h1>
    <p class="maintenance-body">{{ "We'll be back shortly. Thank you for your patience." | t }}</p>

    {% if maintenanceMessage %}
    <div class="maintenance-message">{{ maintenanceMessage }}</div>
    {% endif %}

    {% if maintenanceEta %}
    <p class="maintenance-eta">{{ "Expected back:" | t }} {{ maintenanceEta | date }}</p>
    {% endif %}

    <div class="maintenance-footer">
      SellMyHouse.sg &middot; {{ "Powered by Huttons Asia Pte Ltd" | t }}
    </div>
  </div>
</body>
</html>
```

- [ ] **Step 2: Register middleware in `src/infra/http/app.ts`**

In `src/infra/http/app.ts`, add the import near the top with the other middleware imports:

```typescript
import { maintenanceMiddleware } from './middleware/maintenance';
```

Then register it after `passport.session()` and before routes (after line `app.use(passport.session());`):

```typescript
// Maintenance mode — after auth so req.user is populated
app.use(maintenanceMiddleware);
```

Insert this block between `app.use(passport.session());` and `app.use(requestLogger)`.

- [ ] **Step 3: Run full test suite**

```bash
npm test 2>&1 | tail -15
```

Expected: all existing tests still pass

- [ ] **Step 4: Commit**

```bash
git add src/views/pages/public/maintenance.njk src/infra/http/app.ts
git commit -m "feat: add public maintenance page and register middleware"
```

---

## Chunk 2: Admin Control Page

### Task 5: Add maintenance service functions

**Files:**
- Modify: `src/domains/admin/admin.service.ts`
- Modify: `src/domains/admin/__tests__/admin.service.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/domains/admin/__tests__/admin.service.test.ts` (append after existing describe blocks):

```typescript
// ─── getMaintenanceSettings ──────────────────────────────────

describe('getMaintenanceSettings', () => {
  it('returns current maintenance settings', async () => {
    mockSettingsService.get.mockImplementation(async (key: string) => {
      if (key === 'maintenance_mode') return 'true';
      if (key === 'maintenance_message') return 'Upgrading system.';
      if (key === 'maintenance_eta') return '2026-03-19T10:00:00.000Z';
      return '';
    });

    const result = await adminService.getMaintenanceSettings();

    expect(result).toEqual({
      isOn: true,
      message: 'Upgrading system.',
      eta: '2026-03-19T10:00:00.000Z',
    });
  });

  it('returns defaults when settings missing', async () => {
    mockSettingsService.get.mockResolvedValue('false');

    const result = await adminService.getMaintenanceSettings();

    expect(result).toEqual({ isOn: false, message: '', eta: '' });
  });
});

// ─── toggleMaintenanceMode ────────────────────────────────────

describe('toggleMaintenanceMode', () => {
  it('enables maintenance mode when currently off', async () => {
    mockSettingsService.get.mockResolvedValue('false');
    mockAdminRepo.upsertSetting.mockResolvedValue({} as any);

    const result = await adminService.toggleMaintenanceMode('agent-1');

    expect(mockAdminRepo.upsertSetting).toHaveBeenCalledWith(
      'maintenance_mode',
      'true',
      'agent-1',
    );
    expect(result).toBe(true);
  });

  it('disables maintenance mode when currently on', async () => {
    mockSettingsService.get.mockResolvedValue('true');
    mockAdminRepo.upsertSetting.mockResolvedValue({} as any);

    const result = await adminService.toggleMaintenanceMode('agent-1');

    expect(mockAdminRepo.upsertSetting).toHaveBeenCalledWith(
      'maintenance_mode',
      'false',
      'agent-1',
    );
    expect(result).toBe(false);
  });
});

// ─── setMaintenanceMessage ───────────────────────────────────

describe('setMaintenanceMessage', () => {
  it('saves the message via upsertSetting', async () => {
    mockAdminRepo.upsertSetting.mockResolvedValue({} as any);

    await adminService.setMaintenanceMessage('System upgrade in progress.', 'agent-1');

    expect(mockAdminRepo.upsertSetting).toHaveBeenCalledWith(
      'maintenance_message',
      'System upgrade in progress.',
      'agent-1',
    );
  });
});

// ─── setMaintenanceEta ───────────────────────────────────────

describe('setMaintenanceEta', () => {
  it('saves the eta via upsertSetting', async () => {
    mockAdminRepo.upsertSetting.mockResolvedValue({} as any);

    await adminService.setMaintenanceEta('2026-03-19T10:00', 'agent-1');

    expect(mockAdminRepo.upsertSetting).toHaveBeenCalledWith(
      'maintenance_eta',
      '2026-03-19T10:00',
      'agent-1',
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest src/domains/admin/__tests__/admin.service.test.ts --no-coverage 2>&1 | grep -E "FAIL|PASS|getMaintenanceSettings|toggleMaintenance|setMaintenance"
```

Expected: FAIL — "adminService.getMaintenanceSettings is not a function"

- [ ] **Step 3: Check `upsertSetting` exists in `admin.repository.ts`**

```bash
grep -n "upsertSetting" src/domains/admin/admin.repository.ts
```

If not found, add to `src/domains/admin/admin.repository.ts`:

```typescript
export async function upsertSetting(
  key: string,
  value: string,
  agentId: string,
): Promise<SettingRecord> {
  return prisma.systemSetting.upsert({
    where: { key },
    update: { value, updatedByAgentId: agentId, updatedAt: new Date() },
    create: { key, value, description: '', updatedByAgentId: agentId },
  });
}
```

(Check the existing `updateSetting` function — if it already does an upsert, use that name in the service instead.)

- [ ] **Step 4: Add service functions to `src/domains/admin/admin.service.ts`**

Add after the existing settings group functions (around line 464, after `getSettingGroups`):

```typescript
// ─── Maintenance Mode ─────────────────────────────────────────

export interface MaintenanceSettings {
  isOn: boolean;
  message: string;
  eta: string;
}

export async function getMaintenanceSettings(): Promise<MaintenanceSettings> {
  const [mode, message, eta] = await Promise.all([
    settingsService.get('maintenance_mode', 'false'),
    settingsService.get('maintenance_message', ''),
    settingsService.get('maintenance_eta', ''),
  ]);
  return { isOn: mode === 'true', message, eta };
}

export async function toggleMaintenanceMode(agentId: string): Promise<boolean> {
  const current = await settingsService.get('maintenance_mode', 'false');
  const next = current === 'true' ? 'false' : 'true';
  await adminRepo.upsertSetting('maintenance_mode', next, agentId);
  return next === 'true';
}

export async function setMaintenanceMessage(message: string, agentId: string): Promise<void> {
  await adminRepo.upsertSetting('maintenance_message', message, agentId);
}

export async function setMaintenanceEta(eta: string, agentId: string): Promise<void> {
  await adminRepo.upsertSetting('maintenance_eta', eta, agentId);
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx jest src/domains/admin/__tests__/admin.service.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — all tests green

- [ ] **Step 6: Commit**

```bash
git add src/domains/admin/admin.service.ts src/domains/admin/__tests__/admin.service.test.ts src/domains/admin/admin.repository.ts
git commit -m "feat: add maintenance mode service functions (toggle, message, eta)"
```

---

### Task 6: Add admin maintenance routes

**Files:**
- Modify: `src/domains/admin/admin.router.ts`

- [ ] **Step 1: Add routes to `src/domains/admin/admin.router.ts`**

Add after the existing settings routes (search for `'/admin/settings'` to find the right location), appending a new section:

```typescript
// ─── Maintenance Mode ─────────────────────────────────────────

adminRouter.get(
  '/admin/maintenance',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      const maintenance = await adminService.getMaintenanceSettings();
      res.render('pages/admin/maintenance', {
        pageTitle: 'Maintenance',
        user,
        hasAvatar,
        maintenance,
        currentPath: '/admin/maintenance',
      });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/maintenance/toggle',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await adminService.toggleMaintenanceMode(user.id);
      const maintenance = await adminService.getMaintenanceSettings();

      if (req.headers['hx-request']) {
        return res.render('partials/admin/maintenance-status', { maintenance });
      }
      res.redirect('/admin/maintenance');
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/maintenance/message',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const message = (req.body.message as string) ?? '';
      await adminService.setMaintenanceMessage(message, user.id);

      if (req.headers['hx-request']) {
        return res.status(200).send('Saved');
      }
      res.redirect('/admin/maintenance');
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/admin/maintenance/eta',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const eta = (req.body.eta as string) ?? '';
      await adminService.setMaintenanceEta(eta, user.id);

      if (req.headers['hx-request']) {
        return res.status(200).send('Saved');
      }
      res.redirect('/admin/maintenance');
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 2: Run full test suite**

```bash
npm test 2>&1 | tail -15
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/domains/admin/admin.router.ts
git commit -m "feat: add admin maintenance mode routes (GET + 3x POST)"
```

---

### Task 7: Create admin maintenance view and status partial

**Files:**
- Create: `src/views/pages/admin/maintenance.njk`
- Create: `src/views/partials/admin/maintenance-status.njk`

- [ ] **Step 1: Create the HTMX status partial**

Create `src/views/partials/admin/maintenance-status.njk`:

```nunjucks
{# Partial: rendered by HTMX toggle response — replaces #maintenance-status region #}
<div id="maintenance-status">
  {% if maintenance.isOn %}
  <div class="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
    <span class="font-semibold">{{ "● Maintenance is LIVE" | t }}</span>
    <span class="text-red-600">{{ "— visitors cannot access the platform." | t }}</span>
  </div>
  {% else %}
  <div class="flex items-center gap-2 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-500">
    <span>{{ "● Maintenance is off" | t }}</span>
    <span class="text-gray-400">{{ "— platform is accessible normally." | t }}</span>
  </div>
  {% endif %}

  {# Apple-style toggle #}
  <div class="flex items-center gap-4 mt-4">
    <span class="text-sm text-gray-500">{{ "Off" | t }}</span>
    <button
      type="button"
      hx-post="/admin/maintenance/toggle"
      hx-target="#maintenance-status"
      hx-swap="outerHTML"
      aria-label="{{ 'Toggle maintenance mode' | t }}"
      class="relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 {{ 'bg-red-500' if maintenance.isOn else 'bg-gray-300' }}"
    >
      <span
        class="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform {{ 'translate-x-8' if maintenance.isOn else 'translate-x-1' }}"
      ></span>
    </button>
    <span class="text-sm {{ 'font-semibold text-red-600' if maintenance.isOn else 'text-gray-500' }}">
      {{ "On" | t }}
    </span>
  </div>
</div>
```

- [ ] **Step 2: Create the admin maintenance page**

Create `src/views/pages/admin/maintenance.njk`:

```nunjucks
{% extends "layouts/admin.njk" %}
{% from "partials/shared/icons.njk" import icon %}

{% block content %}
{% set pageTitle = "Maintenance Mode" %}
{% include "partials/shared/page-header.njk" %}

<div class="max-w-2xl">
  <div class="card p-6">
    <div class="flex gap-6 items-start">

      {# Left: Monkey + status badge #}
      <div class="flex flex-col items-center gap-3 flex-shrink-0">
        <img
          src="/images/space-monkey-maintenance.png"
          alt="Maintenance monkey"
          class="w-28 h-28 object-contain"
          style="image-rendering: pixelated;"
        />
        <span class="text-xs font-medium px-2 py-1 rounded-full {{ 'bg-red-100 text-red-700' if maintenance.isOn else 'bg-gray-100 text-gray-500' }}">
          {{ "● Live" if maintenance.isOn else "● Off" }}
        </span>
      </div>

      {# Right: Controls #}
      <div class="flex-1 space-y-6">

        <div>
          <h2 class="text-base font-semibold text-gray-800">{{ "Maintenance Mode" | t }}</h2>
          <p class="text-sm text-gray-500 mt-1">
            {{ "When enabled, visitors and sellers see a maintenance page instead of the platform. Admins and agents retain full access." | t }}
          </p>
        </div>

        {# Toggle region — swapped by HTMX on toggle #}
        {% include "partials/admin/maintenance-status.njk" %}

        <hr class="border-gray-100" />

        {# Custom message #}
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="maintenance-message">
            {{ "Custom message" | t }}
            <span class="text-gray-400 font-normal">{{ "(optional — shown on maintenance page)" | t }}</span>
          </label>
          <form
            hx-post="/admin/maintenance/message"
            hx-target="#message-result"
            hx-swap="innerHTML"
            class="flex gap-2 items-start"
          >
            <textarea
              id="maintenance-message"
              name="message"
              rows="2"
              placeholder="{{ 'e.g. Upgrading our transaction processing system.' | t }}"
              class="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >{{ maintenance.message }}</textarea>
            <button type="submit" class="btn-secondary text-sm px-3 py-2">{{ "Save" | t }}</button>
          </form>
          <div id="message-result" class="text-xs text-green-600 mt-1 h-4"></div>
        </div>

        {# ETA #}
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="maintenance-eta">
            {{ "Estimated back" | t }}
            <span class="text-gray-400 font-normal">{{ "(optional)" | t }}</span>
          </label>
          <form
            hx-post="/admin/maintenance/eta"
            hx-target="#eta-result"
            hx-swap="innerHTML"
            class="flex gap-2 items-center"
          >
            <input
              id="maintenance-eta"
              type="datetime-local"
              name="eta"
              value="{{ maintenance.eta }}"
              class="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button type="submit" class="btn-secondary text-sm px-3 py-2">{{ "Save" | t }}</button>
          </form>
          <div id="eta-result" class="text-xs text-green-600 mt-1 h-4"></div>
        </div>

      </div>
    </div>
  </div>
</div>
{% endblock %}
```

- [ ] **Step 3: Add sidebar item to `src/views/layouts/admin.njk`**

In `src/views/layouts/admin.njk`, find the line for the Compliance link and insert the Maintenance link before it (between Compliance and HDB Data):

```nunjucks
<a href="/admin/maintenance" title="{{ 'Maintenance' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/maintenance' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('wrench-screwdriver') }}<span class="sidebar-label">{{ "Maintenance" | t }}</span></a>
```

Insert this **after** the Compliance `<a>` tag and **before** the HDB Data `<a>` tag.

- [ ] **Step 4: Check `wrench-screwdriver` icon exists**

```bash
grep -n "wrench-screwdriver" src/views/partials/shared/icons.njk
```

If not found, open `src/views/partials/shared/icons.njk` and add the icon. The SVG path for `wrench-screwdriver` (Heroicons outline) is:

```nunjucks
{% elif name == 'wrench-screwdriver' %}
<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="{{ class }}"><path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l5.654-4.654m5.58-3.88.642-.642a12.054 12.054 0 0 1 .574 7.273m-6.216-6.216a12.054 12.054 0 0 1 7.273.574l-.642.642m0 0-6.631 6.631" /></svg>
{% endif %}
```

Add this **before** the final `{% endif %}` in the icon macro.

- [ ] **Step 5: Run full test suite**

```bash
npm test 2>&1 | tail -15
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/views/pages/admin/maintenance.njk src/views/partials/admin/maintenance-status.njk src/views/layouts/admin.njk src/views/partials/shared/icons.njk
git commit -m "feat: add admin maintenance page, HTMX partial, and sidebar item"
```

---

### Task 8: Smoke test end-to-end

- [ ] **Step 1: Start the dev database and server**

```bash
npm run docker:dev
npm run dev
```

- [ ] **Step 2: Log in as admin and visit `/admin/maintenance`**

Verify:
- Monkey image renders
- Toggle shows "Off" state (green switch thumb on left)
- Message and ETA fields are empty

- [ ] **Step 3: Enable maintenance mode**

Click the toggle. Verify:
- Red "Maintenance is LIVE" banner appears
- Toggle thumb moves to right (red background)

- [ ] **Step 4: Open an incognito window and visit the site**

Visit `http://localhost:3000/`. Verify:
- Monkey image visible
- Text: "We're currently performing scheduled maintenance."
- HTTP status 503 (check Network tab in DevTools)

- [ ] **Step 5: Confirm agent/admin bypass**

Log in as an agent in a separate incognito window. Verify the agent can access `/agent/dashboard` normally.

- [ ] **Step 6: Disable maintenance mode and confirm public access restored**

Toggle off. Revisit `http://localhost:3000/` in incognito — should see the normal homepage.

- [ ] **Step 7: Final commit if any manual tweaks were needed**

```bash
git add -p
git commit -m "fix: maintenance mode smoke test adjustments"
```
