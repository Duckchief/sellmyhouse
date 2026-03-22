# Default Agent for Lead Assignment — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Store a `default_agent_id` system setting; auto-assign new leads to that agent at creation; add "Set Default" UI to `/admin/team` with a Default badge and a guard modal when deactivating/anonymising the default agent.

**Architecture:** `default_agent_id` stored in `SystemSetting` table (no migration needed). `lead.service.ts` reads it after atomic seller creation and calls a new `leadRepo.assignAgent`. The admin router handles the guard logic (check if agent is default before deactivate/anonymise) and renders a modal partial when a replacement is needed.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, Jest.

---

### Task 1: Add `DEFAULT_AGENT_ID` to SETTING_KEYS

**Files:**
- Modify: `src/domains/shared/settings.types.ts`

**Step 1: Add the key**

In the `SETTING_KEYS` object, add after `SUPPORT_PHONE`:

```typescript
DEFAULT_AGENT_ID: 'default_agent_id',
```

**Step 2: Run existing tests to confirm no breakage**

```bash
npm test -- --testPathPattern="settings"
```
Expected: all pass (additive change only).

**Step 3: Commit**

```bash
git add src/domains/shared/settings.types.ts
git commit -m "feat(settings): add DEFAULT_AGENT_ID setting key"
```

---

### Task 2: Add `assignAgent` to lead repository

**Files:**
- Modify: `src/domains/lead/lead.repository.ts`

**Step 1: Write the failing test**

In `src/domains/lead/__tests__/lead.repository.test.ts` (or create it if it doesn't exist), add:

```typescript
describe('assignAgent', () => {
  it('updates seller agentId', async () => {
    mockPrisma.seller.update.mockResolvedValue({ id: 'seller-1', agentId: 'agent-1' } as any);
    await assignAgent('seller-1', 'agent-1');
    expect(mockPrisma.seller.update).toHaveBeenCalledWith({
      where: { id: 'seller-1' },
      data: { agentId: 'agent-1' },
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="lead.repository"
```
Expected: FAIL — `assignAgent is not a function`

**Step 3: Implement**

In `src/domains/lead/lead.repository.ts`, add at the bottom:

```typescript
export async function assignAgent(sellerId: string, agentId: string): Promise<void> {
  await prisma.seller.update({ where: { id: sellerId }, data: { agentId } });
}
```

**Step 4: Run tests**

```bash
npm test -- --testPathPattern="lead.repository"
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/lead/lead.repository.ts src/domains/lead/__tests__/lead.repository.test.ts
git commit -m "feat(lead): add assignAgent repository function"
```

---

### Task 3: Auto-assign default agent in submitLead

**Files:**
- Modify: `src/domains/lead/lead.service.ts`
- Test: `src/domains/lead/__tests__/lead.service.test.ts`

**Step 1: Write failing tests**

In `lead.service.test.ts`, the existing `mockSettings.getNumber` covers `lead_retention_months`. Add `mockSettings.get` support and two new tests:

```typescript
// At the top of the describe block, add to beforeEach:
mockSettings.get.mockResolvedValue(''); // default: no default agent

it('auto-assigns default agent when default_agent_id is set', async () => {
  mockLeadRepo.findActiveSellerByPhone.mockResolvedValue(null);
  mockLeadRepo.submitLeadAtomically.mockResolvedValue(sellerFixture);
  mockLeadRepo.findAdminAgents.mockResolvedValue([]);
  mockLeadRepo.assignAgent = jest.fn().mockResolvedValue(undefined);
  mockAudit.log.mockResolvedValue(undefined);
  mockNotification.send.mockResolvedValue(undefined);
  mockSettings.get.mockResolvedValue('agent-default-1');

  await submitLead(validInput);

  expect(mockLeadRepo.assignAgent).toHaveBeenCalledWith('seller-1', 'agent-default-1');
  expect(mockAudit.log).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'lead.auto_assigned' }),
  );
});

it('does not assign agent when no default_agent_id is set', async () => {
  mockLeadRepo.findActiveSellerByPhone.mockResolvedValue(null);
  mockLeadRepo.submitLeadAtomically.mockResolvedValue(sellerFixture);
  mockLeadRepo.findAdminAgents.mockResolvedValue([]);
  mockLeadRepo.assignAgent = jest.fn().mockResolvedValue(undefined);
  mockAudit.log.mockResolvedValue(undefined);
  mockNotification.send.mockResolvedValue(undefined);
  mockSettings.get.mockResolvedValue('');

  await submitLead(validInput);

  expect(mockLeadRepo.assignAgent).not.toHaveBeenCalled();
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="lead.service"
```
Expected: FAIL — `assignAgent is not called` / `auto_assigned audit not found`

**Step 3: Implement in lead.service.ts**

After the marketing consent audit log block (around line 68), before the welcome notification, add:

```typescript
  // Auto-assign to default agent if configured
  const defaultAgentId = await settingsService.get('default_agent_id', '');
  if (defaultAgentId) {
    await leadRepo.assignAgent(seller.id, defaultAgentId);
    await auditService.log({
      action: 'lead.auto_assigned',
      entityType: 'Seller',
      entityId: seller.id,
      details: { agentId: defaultAgentId, reason: 'default_agent' },
      actorType: 'system' as const,
    });
  }
```

**Step 4: Run tests**

```bash
npm test -- --testPathPattern="lead.service"
```
Expected: all pass

**Step 5: Commit**

```bash
git add src/domains/lead/lead.service.ts src/domains/lead/__tests__/lead.service.test.ts
git commit -m "feat(lead): auto-assign default agent on lead creation"
```

---

### Task 4: Add setDefaultAgent and getDefaultAgentId to admin service

**Files:**
- Modify: `src/domains/admin/admin.service.ts`
- Test: `src/domains/admin/__tests__/admin.service.test.ts`

**Step 1: Write failing tests**

Add a new `describe('setDefaultAgent')` block in `admin.service.test.ts`:

```typescript
describe('setDefaultAgent', () => {
  const agentFixture = {
    id: 'agent-1', name: 'Alice', email: 'alice@test.com', phone: null,
    ceaRegNo: 'R001', role: 'agent', isActive: true,
    activeSellersCount: 0, completedCount: 0, stageCounts: {}, createdAt: new Date(),
  };

  it('upserts default_agent_id setting and writes audit log', async () => {
    mockAdminRepo.findAgentById.mockResolvedValue(agentFixture);
    mockSettingsService.upsert.mockResolvedValue(undefined as any);

    await adminService.setDefaultAgent('agent-1', 'admin-1');

    expect(mockSettingsService.upsert).toHaveBeenCalledWith(
      'default_agent_id', 'agent-1', 'Default agent for new lead assignment', 'admin-1',
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent.set_as_default', entityId: 'agent-1' }),
    );
  });

  it('throws NotFoundError if agent does not exist', async () => {
    mockAdminRepo.findAgentById.mockResolvedValue(null);
    await expect(adminService.setDefaultAgent('bad-id', 'admin-1')).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError if agent is inactive', async () => {
    mockAdminRepo.findAgentById.mockResolvedValue({ ...agentFixture, isActive: false });
    await expect(adminService.setDefaultAgent('agent-1', 'admin-1')).rejects.toThrow(ValidationError);
  });
});

describe('getDefaultAgentId', () => {
  it('returns the current default agent id', async () => {
    mockSettingsService.get.mockResolvedValue('agent-1');
    const result = await adminService.getDefaultAgentId();
    expect(result).toBe('agent-1');
    expect(mockSettingsService.get).toHaveBeenCalledWith('default_agent_id', '');
  });

  it('returns null when no default is set', async () => {
    mockSettingsService.get.mockResolvedValue('');
    const result = await adminService.getDefaultAgentId();
    expect(result).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="admin.service"
```
Expected: FAIL — functions not defined

**Step 3: Implement in admin.service.ts**

After the `getTeam` function, add:

```typescript
export async function getDefaultAgentId(): Promise<string | null> {
  const value = await settingsService.get('default_agent_id', '');
  return value || null;
}

export async function setDefaultAgent(agentId: string, adminId: string): Promise<void> {
  const agent = await adminRepo.findAgentById(agentId);
  if (!agent) throw new NotFoundError('Agent', agentId);
  if (!agent.isActive) throw new ValidationError('Cannot set an inactive agent as default');

  await settingsService.upsert(
    'default_agent_id',
    agentId,
    'Default agent for new lead assignment',
    adminId,
  );

  await auditService.log({
    agentId: adminId,
    action: 'agent.set_as_default',
    entityType: 'agent',
    entityId: agentId,
    details: { agentId, setBy: adminId },
  });
}

export async function clearDefaultAgent(adminId: string): Promise<void> {
  await settingsService.upsert('default_agent_id', '', 'Default agent for new lead assignment', adminId);
  await auditService.log({
    agentId: adminId,
    action: 'agent.default_cleared',
    entityType: 'agent',
    entityId: 'none',
    details: { clearedBy: adminId },
  });
}
```

Note: `ValidationError` takes a message string. Import is already in admin.service.ts.

**Step 4: Run tests**

```bash
npm test -- --testPathPattern="admin.service"
```
Expected: all pass

**Step 5: Commit**

```bash
git add src/domains/admin/admin.service.ts src/domains/admin/__tests__/admin.service.test.ts
git commit -m "feat(admin): add setDefaultAgent, getDefaultAgentId, clearDefaultAgent"
```

---

### Task 5: Add reassign-default-modal partial

**Files:**
- Create: `src/views/partials/admin/reassign-default-modal.njk`

**Step 1: Create the partial**

```html
<div id="reassign-default-modal" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
  <div class="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
    <h2 class="text-base font-semibold text-gray-900 mb-2">{{ "Reassign Default Agent" | t }}</h2>
    <p class="text-sm text-gray-600 mb-4">
      {{ "This agent is the default for new leads. Select a replacement before proceeding." | t }}
    </p>
    <form
      hx-post="/admin/team/{{ agentId }}/{{ action }}"
      hx-target="#action-result"
      hx-on::after-request="document.getElementById('reassign-default-modal').remove()"
    >
      <label class="block text-sm font-medium text-gray-700 mb-1">{{ "New Default Agent" | t }}</label>
      <select name="newDefaultAgentId" class="w-full border rounded px-3 py-2 text-sm mb-4">
        <option value="unassigned">{{ "— Unassigned (no default)" | t }}</option>
        {% for a in activeAgents %}
          <option value="{{ a.id }}">{{ a.name }}</option>
        {% endfor %}
      </select>
      <div class="flex gap-2 justify-end">
        <button
          type="button"
          class="text-sm text-gray-500 hover:underline"
          onclick="document.getElementById('reassign-default-modal').remove()"
        >{{ "Cancel" | t }}</button>
        <button type="submit" class="bg-red-600 text-white px-4 py-2 rounded text-sm">
          {{ "Confirm" | t }}
        </button>
      </div>
    </form>
  </div>
</div>
```

No automated test for this partial (pure HTML template). Visual review sufficient.

**Step 2: Commit**

```bash
git add src/views/partials/admin/reassign-default-modal.njk
git commit -m "feat(admin): add reassign-default-modal partial"
```

---

### Task 6: Add set-default route and guard deactivate/anonymise in admin router

**Files:**
- Modify: `src/domains/admin/admin.router.ts`

**Step 1: Write failing integration tests**

In `src/domains/admin/__tests__/admin.router.test.ts`, add:

```typescript
describe('POST /admin/team/:id/set-default', () => {
  it('sets the agent as default and returns team-list partial', async () => {
    mockAdminService.setDefaultAgent.mockResolvedValue(undefined);
    mockAdminService.getTeam.mockResolvedValue([]);
    mockAdminService.getDefaultAgentId.mockResolvedValue('agent-1');

    const res = await request(app)
      .post('/admin/team/agent-1/set-default')
      .set('hx-request', 'true')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(mockAdminService.setDefaultAgent).toHaveBeenCalledWith('agent-1', expect.any(String));
  });

  it('returns 404 for unknown agent', async () => {
    mockAdminService.setDefaultAgent.mockRejectedValue(new NotFoundError('Agent', 'bad-id'));

    const res = await request(app)
      .post('/admin/team/bad-id/set-default')
      .set('hx-request', 'true')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
  });
});

describe('POST /admin/team/:id/deactivate (default agent guard)', () => {
  it('returns modal partial when agent is default and no replacement provided', async () => {
    mockAdminService.getDefaultAgentId.mockResolvedValue('agent-1');
    mockAdminService.getTeam.mockResolvedValue([
      { id: 'agent-2', name: 'Bob', isActive: true } as any,
    ]);

    const res = await request(app)
      .post('/admin/team/agent-1/deactivate')
      .set('hx-request', 'true')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(mockAdminService.deactivateAgent).not.toHaveBeenCalled();
    expect(res.text).toContain('reassign-default-modal');
  });

  it('clears default and deactivates when newDefaultAgentId=unassigned', async () => {
    mockAdminService.getDefaultAgentId.mockResolvedValue('agent-1');
    mockAdminService.clearDefaultAgent.mockResolvedValue(undefined);
    mockAdminService.deactivateAgent.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/admin/team/agent-1/deactivate')
      .send('newDefaultAgentId=unassigned')
      .set('hx-request', 'true')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(mockAdminService.clearDefaultAgent).toHaveBeenCalled();
    expect(mockAdminService.deactivateAgent).toHaveBeenCalled();
  });

  it('sets new default and deactivates when newDefaultAgentId is a UUID', async () => {
    mockAdminService.getDefaultAgentId.mockResolvedValue('agent-1');
    mockAdminService.setDefaultAgent.mockResolvedValue(undefined);
    mockAdminService.deactivateAgent.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/admin/team/agent-1/deactivate')
      .send('newDefaultAgentId=agent-2')
      .set('hx-request', 'true')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(mockAdminService.setDefaultAgent).toHaveBeenCalledWith('agent-2', expect.any(String));
    expect(mockAdminService.deactivateAgent).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="admin.router"
```
Expected: FAIL — route doesn't exist / guard not present

**Step 3: Add set-default route to admin.router.ts**

After the existing `POST /admin/team/:id/reactivate` route (around line 354), add:

```typescript
adminRouter.post(
  '/admin/team/:id/set-default',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await adminService.setDefaultAgent(req.params['id'] as string, user.id);
      const [team, defaultAgentId] = await Promise.all([
        adminService.getTeam(),
        adminService.getDefaultAgentId(),
      ]);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-list', { team, defaultAgentId });
      }
      res.redirect('/admin/team');
    } catch (err) {
      next(err);
    }
  },
);
```

**Step 4: Update deactivate route to guard for default agent**

Replace the existing `POST /admin/team/:id/deactivate` handler body with:

```typescript
async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as AuthenticatedUser;
    const agentId = req.params['id'] as string;
    const newDefaultAgentId = req.body?.newDefaultAgentId as string | undefined;

    // Guard: if this agent is the default, require a replacement first
    const currentDefault = await adminService.getDefaultAgentId();
    if (currentDefault === agentId && !newDefaultAgentId) {
      const team = await adminService.getTeam();
      const activeAgents = team.filter((a) => a.isActive && a.id !== agentId);
      return res.render('partials/admin/reassign-default-modal', {
        agentId,
        action: 'deactivate',
        activeAgents,
      });
    }

    // Handle default replacement
    if (currentDefault === agentId && newDefaultAgentId) {
      if (newDefaultAgentId === 'unassigned') {
        await adminService.clearDefaultAgent(user.id);
      } else {
        await adminService.setDefaultAgent(newDefaultAgentId, user.id);
      }
    }

    await adminService.deactivateAgent(agentId, user.id);
    if (req.headers['hx-request']) {
      return res.render('partials/admin/team-action-result', {
        message: 'Agent deactivated.',
        type: 'success',
      });
    }
    res.redirect('/admin/team');
  } catch (err) {
    next(err);
  }
},
```

**Step 5: Apply the same guard to the anonymise route**

Same pattern as deactivate. Replace the `POST /admin/team/:id/anonymise` handler body:

```typescript
async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as AuthenticatedUser;
    const agentId = req.params['id'] as string;
    const newDefaultAgentId = req.body?.newDefaultAgentId as string | undefined;

    const currentDefault = await adminService.getDefaultAgentId();
    if (currentDefault === agentId && !newDefaultAgentId) {
      const team = await adminService.getTeam();
      const activeAgents = team.filter((a) => a.isActive && a.id !== agentId);
      return res.render('partials/admin/reassign-default-modal', {
        agentId,
        action: 'anonymise',
        activeAgents,
      });
    }

    if (currentDefault === agentId && newDefaultAgentId) {
      if (newDefaultAgentId === 'unassigned') {
        await adminService.clearDefaultAgent(user.id);
      } else {
        await adminService.setDefaultAgent(newDefaultAgentId, user.id);
      }
    }

    await adminService.anonymiseAgent(agentId, user.id);
    if (req.headers['hx-request']) {
      return res.render('partials/admin/team-action-result', {
        message: 'Agent anonymised. This action is irreversible.',
        type: 'success',
      });
    }
    res.redirect('/admin/team');
  } catch (err) {
    next(err);
  }
},
```

**Step 6: Run tests**

```bash
npm test -- --testPathPattern="admin.router"
```
Expected: all pass

**Step 7: Commit**

```bash
git add src/domains/admin/admin.router.ts src/domains/admin/__tests__/admin.router.test.ts
git commit -m "feat(admin): add set-default route and default-agent guard on deactivate/anonymise"
```

---

### Task 7: Update team page to show Default badge and Set Default button

**Files:**
- Modify: `src/domains/admin/admin.router.ts` (GET /admin/team to pass `defaultAgentId`)
- Modify: `src/views/partials/admin/team-list.njk`

**Step 1: Update GET /admin/team route to pass defaultAgentId**

In the `GET /admin/team` handler, change:

```typescript
const team = await adminService.getTeam();
```

to:

```typescript
const [team, defaultAgentId] = await Promise.all([
  adminService.getTeam(),
  adminService.getDefaultAgentId(),
]);
```

And pass `defaultAgentId` to all renders of this route:
- `res.render('partials/admin/team-list', { team, defaultAgentId })`
- `res.render('pages/admin/team', { ..., team, defaultAgentId, ... })`

**Step 2: Update team-list.njk**

Replace the Name cell and Actions cell:

Name cell — add Default badge:
```html
<td class="px-4 py-3 font-medium">
  <a href="/admin/team/{{ member.id }}/pipeline" class="text-indigo-600 hover:underline">{{ member.name }}</a>
  {% if member.id === defaultAgentId %}
    <span class="ml-2 bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-medium">{{ "Default" | t }}</span>
  {% endif %}
</td>
```

Actions cell — add Set Default button (only for active agents who are not already the default):
```html
<td class="px-4 py-3">
  <div class="flex gap-2 flex-wrap">
    {% if member.isActive %}
      <button
        class="text-xs text-amber-600 hover:underline"
        hx-post="/admin/team/{{ member.id }}/deactivate"
        hx-target="#modal-container"
        hx-confirm="{{ 'Deactivate this agent?' | t }}"
      >{{ "Deactivate" | t }}</button>
    {% else %}
      <button
        class="text-xs text-green-600 hover:underline"
        hx-post="/admin/team/{{ member.id }}/reactivate"
        hx-target="#action-result"
      >{{ "Reactivate" | t }}</button>
    {% endif %}
    <button
      class="text-xs text-red-600 hover:underline"
      hx-get="/admin/team/{{ member.id }}/anonymise-confirm"
      hx-target="#modal-container"
    >{{ "Anonymise" | t }}</button>
    {% if member.isActive and member.id !== defaultAgentId %}
      <button
        class="text-xs text-indigo-600 hover:underline"
        hx-post="/admin/team/{{ member.id }}/set-default"
        hx-target="#action-result"
      >{{ "Set Default" | t }}</button>
    {% endif %}
  </div>
</td>
```

Note: The Deactivate button's `hx-target` is changed to `#modal-container` so the guard modal renders correctly. Also remove the `hx-confirm` from Deactivate — the guard modal handles confirmation when needed, and for non-default agents the existing confirm dialog doesn't add much value (remove it to keep UI consistent). If you prefer to keep `hx-confirm` for non-default agents, that's fine too — just set target to `#modal-container` for the HTMX swap.

Actually — to avoid losing the confirm dialog for normal deactivations, keep `hx-confirm` on the button and point `hx-target="#modal-container"`. The modal swap won't fire if the user confirms and no modal is returned; the action-result response will be swapped into `#modal-container` (harmless). Better: change Deactivate's `hx-target` to `#modal-container` and add `hx-swap="outerHTML"` — or simply keep `hx-target="#action-result"` and have the route `hx-push-url` trigger a full re-render when returning the modal. Simplest: remove `hx-confirm` from Deactivate, let the modal always be the confirmation step (it's cleaner). Keep it consistent.

**Step 3: Run all tests**

```bash
npm test
```
Expected: all pass

**Step 4: Commit**

```bash
git add src/domains/admin/admin.router.ts src/views/partials/admin/team-list.njk
git commit -m "feat(admin): show Default badge and Set Default button on team list"
```

---

### Task 8: Full test run and smoke check

**Step 1: Run all tests**

```bash
npm test && npm run test:integration
```
Expected: all pass

**Step 2: Start dev server and verify manually**

```bash
npm run dev
```

Verify:
1. `/admin/team` loads without error
2. "Set Default" button visible for active agents
3. Clicking "Set Default" shows Default badge on that agent
4. Only one agent has the Default badge at a time
5. Trying to deactivate the default agent shows the reassign modal
6. Selecting "Unassigned" in modal deactivates the agent and clears the badge
7. Selecting another agent in modal sets them as new default then deactivates
8. Submitting a new lead (public form) assigns it to the default agent

**Step 3: Final commit if any fixups needed**

```bash
git add -p
git commit -m "fix(admin): address smoke check findings"
```
