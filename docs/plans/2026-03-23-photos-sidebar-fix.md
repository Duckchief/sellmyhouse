# Photos Sidebar Fix + Onboarding Guard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the Photos sidebar link, redirect completed sellers away from onboarding, and disable feature sidebar items until onboarding is complete.

**Architecture:** Three small changes: sidebar href fix, onboarding route guard, and conditional sidebar rendering driven by `res.locals.onboardingComplete` set in existing seller middleware.

**Tech Stack:** Express middleware, Nunjucks templates, Jest + Supertest

---

### Task 1: Fix Photos sidebar href

**Files:**
- Modify: `src/views/layouts/seller.njk:22`

**Step 1: Change the href**

In `src/views/layouts/seller.njk`, line 22, change:

```njk
<a href="/seller/onboarding" title="{{ 'Photos' | t }}"
```

to:

```njk
<a href="/seller/photos" title="{{ 'Photos' | t }}"
```

Also update the active-state check on the same line from:

```njk
{% if currentPath == '/seller/onboarding' %}
```

to:

```njk
{% if currentPath == '/seller/photos' %}
```

**Step 2: Commit**

```bash
git add src/views/layouts/seller.njk
git commit -m "fix(seller): point Photos sidebar link to /seller/photos"
```

---

### Task 2: Redirect completed onboarding to dashboard

**Files:**
- Modify: `src/domains/seller/seller.router.ts:106-115`
- Modify: `src/domains/seller/__tests__/seller.router.test.ts:162-185`

**Step 1: Update the existing test for completed onboarding**

In `src/domains/seller/__tests__/seller.router.test.ts`, find the test at line 175:

```ts
it('renders onboarding page even if onboarding is complete (allows back navigation)', async () => {
```

Replace it with:

```ts
it('redirects to dashboard when onboarding is complete', async () => {
  mockedService.getOnboardingStatus.mockResolvedValue({
    currentStep: TOTAL_ONBOARDING_STEPS,
    isComplete: true,
    completedSteps: [1, 2, 3, 4, 5],
  });

  const res = await request(app).get('/seller/onboarding');

  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/seller/dashboard');
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/domains/seller/__tests__/seller.router.test.ts --testNamePattern="redirects to dashboard when onboarding is complete" --no-coverage`

Expected: FAIL — currently returns 200, not 302.

**Step 3: Add the redirect guard**

In `src/domains/seller/seller.router.ts`, replace lines 106-115:

```ts
sellerRouter.get('/seller/onboarding', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as AuthenticatedUser;
    const status = await sellerService.getOnboardingStatus(user.id);

    res.render('pages/seller/onboarding', { status });
  } catch (err) {
    next(err);
  }
});
```

with:

```ts
sellerRouter.get('/seller/onboarding', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as AuthenticatedUser;
    const status = await sellerService.getOnboardingStatus(user.id);

    if (status.isComplete) {
      return res.redirect('/seller/dashboard');
    }

    res.render('pages/seller/onboarding', { status });
  } catch (err) {
    next(err);
  }
});
```

**Step 4: Run tests to verify they pass**

Run: `npx jest src/domains/seller/__tests__/seller.router.test.ts --no-coverage`

Expected: All onboarding tests PASS.

**Step 5: Commit**

```bash
git add src/domains/seller/seller.router.ts src/domains/seller/__tests__/seller.router.test.ts
git commit -m "fix(seller): redirect completed onboarding to dashboard"
```

---

### Task 3: Inject onboardingComplete into res.locals via middleware

**Files:**
- Modify: `src/domains/seller/seller.router.ts:27-46`
- Modify: `src/domains/seller/__tests__/seller.router.test.ts`

**Step 1: Write a test that checks onboardingComplete is available in rendered output**

This is implicitly tested in Task 4 via the sidebar rendering. No separate test needed for the middleware alone — the sidebar tests will cover it.

**Step 2: Add getOnboardingStatus call to the seller middleware**

In `src/domains/seller/seller.router.ts`, the middleware at lines 27-46, add the `getOnboardingStatus` call. Replace:

```ts
sellerRouter.use(
  '/seller',
  ...sellerAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.currentPath = req.path === '/' ? '/seller/dashboard' : `/seller${req.path}`;
      const user = req.user as AuthenticatedUser;
      res.locals.user = user;
      res.locals.hasAvatar = false;
      res.locals.unreadCount = await notificationService.countUnreadNotifications(
        'seller',
        user.id,
      );
      next();
    } catch (err) {
      next(err);
    }
  },
);
```

with:

```ts
sellerRouter.use(
  '/seller',
  ...sellerAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.currentPath = req.path === '/' ? '/seller/dashboard' : `/seller${req.path}`;
      const user = req.user as AuthenticatedUser;
      res.locals.user = user;
      res.locals.hasAvatar = false;
      const [unreadCount, onboardingStatus] = await Promise.all([
        notificationService.countUnreadNotifications('seller', user.id),
        sellerService.getOnboardingStatus(user.id),
      ]);
      res.locals.unreadCount = unreadCount;
      res.locals.onboardingComplete = onboardingStatus.isComplete;
      next();
    } catch (err) {
      next(err);
    }
  },
);
```

**Step 3: Run existing tests to verify nothing breaks**

Run: `npx jest src/domains/seller/__tests__/seller.router.test.ts --no-coverage`

Expected: All tests PASS. The existing tests already mock `getOnboardingStatus` for the route handlers, and the middleware will now also call it. Since it's mocked, it returns the mocked value.

**Step 4: Commit**

```bash
git add src/domains/seller/seller.router.ts
git commit -m "feat(seller): inject onboardingComplete into res.locals for sidebar"
```

---

### Task 4: Disable sidebar items when onboarding is incomplete

**Files:**
- Modify: `src/views/layouts/seller.njk:19-32`

**Step 1: Update sidebar template**

In `src/views/layouts/seller.njk`, replace the nav block (lines 19-32) with conditional rendering. Items that require completed onboarding use `<span>` when disabled (no href to inspect/re-enable):

```njk
    <nav class="space-y-1 flex-1">
      <a href="/seller/dashboard" title="{{ 'Overview' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/dashboard' or currentPath == '/seller/onboarding' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('home') }}<span class="sidebar-tooltip">{{ "Overview" | t }}</span><span class="sidebar-label">{{ "Overview" | t }}</span></a>

      {% if onboardingComplete %}
      <a href="/seller/property" title="{{ 'Property' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/property' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('building-office-2') }}<span class="sidebar-tooltip">{{ "Property" | t }}</span><span class="sidebar-label">{{ "Property" | t }}</span></a>
      <a href="/seller/photos" title="{{ 'Photos' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/photos' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('camera') }}<span class="sidebar-tooltip">{{ "Photos" | t }}</span><span class="sidebar-label">{{ "Photos" | t }}</span></a>
      <a href="/seller/viewings" title="{{ 'Viewings' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/viewings' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('calendar') }}<span class="sidebar-tooltip">{{ "Viewings" | t }}</span><span class="sidebar-label">{{ "Viewings" | t }}</span></a>
      <a href="/seller/documents" title="{{ 'Documents' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/documents' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('document-text') }}<span class="sidebar-tooltip">{{ "Documents" | t }}</span><span class="sidebar-label">{{ "Documents" | t }}</span></a>
      <a href="/seller/financial" title="{{ 'Financial Report' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/financial' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('banknotes') }}<span class="sidebar-tooltip">{{ "Financial Report" | t }}</span><span class="sidebar-label">{{ "Financial Report" | t }}</span></a>
      {% else %}
      <span class="flex items-center gap-2 px-3 py-2.5 rounded text-sm text-white/30 cursor-not-allowed">{{ icon('building-office-2') }}<span class="sidebar-tooltip">{{ "Property" | t }}</span><span class="sidebar-label">{{ "Property" | t }}</span></span>
      <span class="flex items-center gap-2 px-3 py-2.5 rounded text-sm text-white/30 cursor-not-allowed">{{ icon('camera') }}<span class="sidebar-tooltip">{{ "Photos" | t }}</span><span class="sidebar-label">{{ "Photos" | t }}</span></span>
      <span class="flex items-center gap-2 px-3 py-2.5 rounded text-sm text-white/30 cursor-not-allowed">{{ icon('calendar') }}<span class="sidebar-tooltip">{{ "Viewings" | t }}</span><span class="sidebar-label">{{ "Viewings" | t }}</span></span>
      <span class="flex items-center gap-2 px-3 py-2.5 rounded text-sm text-white/30 cursor-not-allowed">{{ icon('document-text') }}<span class="sidebar-tooltip">{{ "Documents" | t }}</span><span class="sidebar-label">{{ "Documents" | t }}</span></span>
      <span class="flex items-center gap-2 px-3 py-2.5 rounded text-sm text-white/30 cursor-not-allowed">{{ icon('banknotes') }}<span class="sidebar-tooltip">{{ "Financial Report" | t }}</span><span class="sidebar-label">{{ "Financial Report" | t }}</span></span>
      {% endif %}

      <a href="/seller/tutorials" title="{{ 'Video Tutorials' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/tutorials' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('academic-cap') }}<span class="sidebar-tooltip">{{ "Video Tutorials" | t }}</span><span class="sidebar-label">{{ "Video Tutorials" | t }}</span></a>
      <div class="sidebar-divider border-t border-white/10 my-2"></div>
      <a href="/seller/notifications" title="{{ 'Notifications' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/notifications' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('bell') }}<span class="sidebar-tooltip">{{ "Notifications" | t }}</span><span class="sidebar-label">{{ "Notifications" | t }}</span>
        {% if unreadCount > 0 %}<span class="ml-auto bg-red-500 text-white text-xs px-2 py-0.5 rounded-full flex-shrink-0">{{ unreadCount }}</span>{% endif %}
      </a>
      <a href="/seller/settings" title="{{ 'Settings' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/settings' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('cog-6-tooth') }}<span class="sidebar-tooltip">{{ "Settings" | t }}</span><span class="sidebar-label">{{ "Settings" | t }}</span></a>
      <a href="/seller/my-data" title="{{ 'My Data' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/my-data' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('shield-check') }}<span class="sidebar-tooltip">{{ "My Data" | t }}</span><span class="sidebar-label">{{ "My Data" | t }}</span></a>
    </nav>
```

Note: The Overview active state now also matches `/seller/onboarding` since that's where incomplete-onboarding sellers land.

**Step 2: Manually verify in browser**

- Log in as a seller with incomplete onboarding → Property, Photos, Viewings, Documents, Financial Report should be greyed out with no links
- Log in as a seller with completed onboarding → all items should be clickable links

**Step 3: Commit**

```bash
git add src/views/layouts/seller.njk
git commit -m "feat(seller): disable sidebar feature items until onboarding complete"
```

---

### Task 5: Run full test suite

**Step 1: Run seller router tests**

Run: `npx jest src/domains/seller/__tests__/seller.router.test.ts --no-coverage`

Expected: All tests PASS.

**Step 2: Run full unit test suite**

Run: `npm test`

Expected: All tests PASS.

**Step 3: Final commit (if any fixes needed)**

Only if test failures required fixes.
