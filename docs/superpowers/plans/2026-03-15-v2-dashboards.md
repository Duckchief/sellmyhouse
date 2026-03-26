# V2 Dashboard Enhancement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the seller, agent, and admin dashboards to match V1's rich content patterns, with brand colors, Chart.js charts, HTMX auto-refresh, and mobile responsiveness.

**Architecture:** Enhance existing Nunjucks templates and Express route handlers. Add brand colors to Tailwind config. Add new service/repository methods for dashboard data. Chart.js loaded via CDN for admin analytics only. HTMX `every 30s` polling for stats cards.

**Tech Stack:** TypeScript, Express, Nunjucks, Tailwind CSS, HTMX, Chart.js (CDN), Prisma, PostgreSQL

**Spec:** `docs/superpowers/specs/2026-03-15-v2-dashboards-design.md`

---

## Chunk 1: Brand Colors & Shared Components

### Task 1: Add Brand Colors to Tailwind Config

**Files:**
- Modify: `tailwind.config.ts`

- [ ] **Step 1: Update tailwind.config.ts with brand colors**

```typescript
// tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/views/**/*.njk', './src/views/**/*.html'],
  theme: {
    extend: {
      colors: {
        ink: '#1a1a2e',
        accent: {
          DEFAULT: '#c8553d',
          dark: '#a8432f',
        },
        bg: {
          DEFAULT: '#fafaf7',
          alt: '#f0efe9',
        },
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 2: Rebuild CSS to verify no errors**

Run: `npm run build:css`
Expected: Exit 0, `public/css/output.css` regenerated

- [ ] **Step 3: Commit**

```bash
git add tailwind.config.ts
git commit -m "feat: add brand colors to Tailwind config (ink, accent, bg)"
```

### Task 2: Add Component Classes to input.css

**Files:**
- Modify: `src/views/styles/input.css`

- [ ] **Step 1: Add component layer with btn-primary, btn-secondary, btn-outline, input-field, card**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer components {
  .btn-primary {
    @apply bg-accent text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-accent-dark transition;
  }
  .btn-secondary {
    @apply bg-ink text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-opacity-90 transition;
  }
  .btn-outline {
    @apply border border-accent text-accent px-4 py-2 rounded-md text-sm font-medium hover:bg-accent hover:text-white transition;
  }
  .input-field {
    @apply w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-accent;
  }
  .card {
    @apply bg-white rounded-lg border border-gray-200 shadow-sm p-6;
  }
}
```

- [ ] **Step 2: Rebuild CSS**

Run: `npm run build:css`
Expected: Exit 0

- [ ] **Step 3: Commit**

```bash
git add src/views/styles/input.css
git commit -m "feat: add component classes (btn-primary, card, input-field)"
```

### Task 3: Create Status Badge Partial

**Files:**
- Create: `src/views/partials/status-badge.njk`

- [ ] **Step 1: Create the status badge partial**

The partial expects a `badgeStatus` variable to be set before including it. This follows the codebase convention of using `{% include %}` (no macros exist in the codebase).

```njk
{# Usage: {% set badgeStatus = seller.status %}{% include "partials/status-badge.njk" %} #}
{% set badgeColors = {
  'lead': 'bg-blue-100 text-blue-800',
  'engaged': 'bg-yellow-100 text-yellow-800',
  'active': 'bg-green-100 text-green-800',
  'offer_received': 'bg-indigo-100 text-indigo-800',
  'under_option': 'bg-orange-100 text-orange-800',
  'completed': 'bg-purple-100 text-purple-800',
  'archived': 'bg-gray-100 text-gray-600',
  'draft': 'bg-gray-100 text-gray-600',
  'listed': 'bg-blue-100 text-blue-800',
  'delisted': 'bg-red-100 text-red-800'
} %}
<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {{ badgeColors[badgeStatus] or 'bg-gray-100 text-gray-600' }}">
  {{ badgeStatus | replace("_", " ") | capitalize | t }}
</span>
```

- [ ] **Step 2: Verify the template compiles**

Run: `npm run build:css`
Expected: Exit 0 (Tailwind scans .njk files for class names)

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/status-badge.njk
git commit -m "feat: add status-badge partial with color mapping"
```

### Task 4: Update Layouts with Brand Colors

**Files:**
- Modify: `src/views/layouts/seller.njk`
- Modify: `src/views/layouts/agent.njk`
- Modify: `src/views/layouts/admin.njk` (read first — not yet read)
- Modify: `src/views/layouts/base.njk`

- [ ] **Step 1: Update base.njk body class**

Change `bg-gray-50` → `bg-bg` in the `<body>` tag:
```html
<body class="min-h-screen bg-bg text-gray-900">
```

- [ ] **Step 2: Update seller.njk sidebar link colors**

Replace `text-blue-600` → `text-accent` in the logo link.
Replace `bg-blue-50 text-blue-700` → `bg-accent/10 text-accent` for active nav items.

- [ ] **Step 3: Update agent.njk sidebar**

Replace `bg-gray-900` → `bg-ink` for the sidebar aside.
Replace `hover:bg-gray-800` → `hover:bg-white/10` for nav links.
Replace `bg-gray-800` → `bg-white/10` for active nav link.
Replace `bg-gray-50` → `bg-bg` for the main content area.

- [ ] **Step 4: Read and update admin.njk sidebar**

Read `src/views/layouts/admin.njk` first.
Replace `bg-indigo-900` → `bg-ink` for the sidebar aside.
Apply same hover/active patterns as agent sidebar.
Replace main content `bg-gray-50` → `bg-bg`.

- [ ] **Step 5: Rebuild CSS and verify**

Run: `npm run build:css`
Expected: Exit 0

- [ ] **Step 6: Commit**

```bash
git add src/views/layouts/base.njk src/views/layouts/seller.njk src/views/layouts/agent.njk src/views/layouts/admin.njk
git commit -m "feat: apply brand colors to all layouts"
```

### Task 5: Add Mobile Responsive Sidebar to All Layouts

**Files:**
- Modify: `src/views/layouts/seller.njk`
- Modify: `src/views/layouts/agent.njk`
- Modify: `src/views/layouts/admin.njk`
- Modify: `public/js/app.js`

The mobile sidebar pattern:
1. Hamburger button visible on `md:hidden`
2. Sidebar hidden on mobile by default (`hidden md:flex`)
3. JS toggles a `mobile-open` class that makes sidebar an overlay
4. Clicking overlay backdrop or a nav link closes the sidebar

- [ ] **Step 1: Update seller.njk with mobile sidebar**

Replace the current `<div class="flex min-h-screen">` wrapper with:

```njk
{% block body %}
<div class="flex min-h-screen">
  {# Mobile hamburger #}
  <div class="md:hidden fixed top-0 left-0 right-0 z-30 bg-white border-b border-gray-200 px-4 py-3 flex items-center">
    <button data-action="toggle-sidebar" class="text-gray-700 hover:text-gray-900">
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
    </button>
    <a href="/seller/dashboard" class="ml-3 text-lg font-bold text-accent">{{ "SellMyHouse" | t }}</a>
  </div>

  {# Sidebar backdrop (mobile) #}
  <div id="sidebar-backdrop" class="hidden fixed inset-0 bg-black/40 z-40 md:hidden" data-action="toggle-sidebar"></div>

  {# Sidebar #}
  <aside id="sidebar" class="hidden md:flex w-64 bg-white border-r border-gray-200 flex-col fixed md:static inset-y-0 left-0 z-50 transform transition-transform">
    {# ... existing sidebar content unchanged ... #}
  </aside>

  {# Main content #}
  <main class="flex-1 p-8 pt-16 md:pt-8">
    {% block content %}{% endblock %}
  </main>
</div>
{% endblock %}
```

Note: `pt-16 md:pt-8` accounts for the mobile header height.

- [ ] **Step 2: Apply same pattern to agent.njk and admin.njk**

Same mobile hamburger + backdrop + sidebar structure, adapted for each layout's color scheme. Agent/admin use `bg-ink` sidebar with white text.

- [ ] **Step 3: Add toggle-sidebar action to app.js**

Add to the click handler's switch statement in `public/js/app.js`:

```javascript
case 'toggle-sidebar': {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar && backdrop) {
    const isOpen = !sidebar.classList.contains('hidden') && window.innerWidth < 768;
    if (isOpen) {
      sidebar.classList.add('hidden');
      backdrop.classList.add('hidden');
    } else {
      sidebar.classList.remove('hidden');
      backdrop.classList.remove('hidden');
    }
  }
  break;
}
```

Also add: close sidebar on any nav link click (mobile only):
```javascript
// After existing DOMContentLoaded setup
document.querySelectorAll('#sidebar a').forEach(link => {
  link.addEventListener('click', () => {
    if (window.innerWidth < 768) {
      document.getElementById('sidebar')?.classList.add('hidden');
      document.getElementById('sidebar-backdrop')?.classList.add('hidden');
    }
  });
});
```

- [ ] **Step 4: Rebuild CSS**

Run: `npm run build:css`
Expected: Exit 0

- [ ] **Step 5: Commit**

```bash
git add src/views/layouts/seller.njk src/views/layouts/agent.njk src/views/layouts/admin.njk public/js/app.js
git commit -m "feat: add mobile responsive sidebar to all layouts"
```

---

## Chunk 2: Seller Dashboard Enhancement

### Task 6: Enhance Seller Types

**Files:**
- Modify: `src/domains/seller/seller.types.ts`

- [ ] **Step 1: Read the current types file**

Read: `src/domains/seller/seller.types.ts`

- [ ] **Step 2: Update DashboardOverview interface**

The current interface returns `propertyStatus: string | null` and `transactionStatus: string | null`. Enhance it to include the full property object, case flags, and viewing counts:

```typescript
export interface DashboardOverview {
  seller: Pick<Seller, 'id' | 'name' | 'email' | 'phone' | 'status' | 'onboardingStep'>;
  onboarding: OnboardingStatus;
  property: {
    block: string;
    street: string;
    town: string;
    flatType: string;
    floorAreaSqm: number;
    askingPrice: number;
    status: string;
  } | null;
  propertyStatus: string | null; // keep for backward compat (used by milestones, documents)
  transactionStatus: string | null;
  caseFlags: Array<{ id: string; flagType: string; description: string }>;
  upcomingViewings: number;
  totalViewings: number;
  unreadNotificationCount: number;
  nextSteps: NextStep[];
}

// Update existing NextStep interface — add `completed` field:
export interface NextStep {
  label: string;
  description: string;
  href: string;
  priority: number;
  completed: boolean; // NEW: true if step is done, false if pending
}

export interface DashboardStats {
  upcomingViewings: number;
  totalViewings: number;
  unreadNotificationCount: number;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/domains/seller/seller.types.ts
git commit -m "feat: enhance DashboardOverview type with property, caseFlags, viewings"
```

### Task 7: Write Failing Tests for Enhanced Seller Service

**Files:**
- Modify: `src/domains/seller/__tests__/seller.service.test.ts`

- [ ] **Step 1: Read the existing test file**

Read: `src/domains/seller/__tests__/seller.service.test.ts`

- [ ] **Step 2: Add test for getDashboardOverview returning enhanced data**

Add tests that verify:
1. `getDashboardOverview` returns property object with block/street/town/flatType/floorAreaSqm/askingPrice
2. Returns caseFlags array from seller relations
3. Returns upcomingViewings and totalViewings from viewing service
4. Returns unreadNotificationCount from notification service

```typescript
describe('getDashboardOverview - enhanced', () => {
  it('returns property details when seller has a property', async () => {
    mockedSellerRepo.getSellerWithRelations.mockResolvedValue({
      id: 'seller-1',
      name: 'John',
      email: 'john@test.com',
      phone: '91234567',
      status: 'active',
      onboardingStep: 5,
      properties: [{
        id: 'prop-1',
        block: '123',
        street: 'Ang Mo Kio Ave 3',
        town: 'ANG MO KIO',
        flatType: '4 ROOM',
        floorAreaSqm: new Decimal(93),
        askingPrice: new Decimal(500000),
        status: 'listed',
        storeyRange: '07 TO 09',
        flatModel: 'New Generation',
        leaseCommenceDate: 1986,
      }],
      transactions: [],
      consentRecords: [],
      caseFlags: [{ id: 'cf-1', flagType: 'undischarged_bankruptcy', description: 'Pending', status: 'open' }],
    } as unknown as SellerWithRelations);

    mockedNotificationService.countUnreadNotifications.mockResolvedValue(3);
    // Mock viewing service
    mockedViewingService.getViewingStats.mockResolvedValue({
      totalViewings: 10,
      upcomingCount: 2,
      noShowCount: 1,
      averageInterestRating: 3.5,
    });

    const result = await sellerService.getDashboardOverview('seller-1');

    expect(result.property).toEqual({
      block: '123',
      street: 'Ang Mo Kio Ave 3',
      town: 'ANG MO KIO',
      flatType: '4 ROOM',
      floorAreaSqm: 93,
      askingPrice: 500000,
      status: 'listed',
    });
    expect(result.caseFlags).toEqual([
      { id: 'cf-1', flagType: 'undischarged_bankruptcy', description: 'Pending' },
    ]);
    expect(result.upcomingViewings).toBe(2);
    expect(result.totalViewings).toBe(10);
    expect(result.unreadNotificationCount).toBe(3);
  });

  it('returns null property when seller has no properties', async () => {
    mockedSellerRepo.getSellerWithRelations.mockResolvedValue({
      id: 'seller-1',
      name: 'John',
      email: 'john@test.com',
      phone: '91234567',
      status: 'lead',
      onboardingStep: 5,
      properties: [],
      transactions: [],
      consentRecords: [],
      caseFlags: [],
    } as unknown as SellerWithRelations);

    mockedNotificationService.countUnreadNotifications.mockResolvedValue(0);

    const result = await sellerService.getDashboardOverview('seller-1');

    expect(result.property).toBeNull();
    expect(result.caseFlags).toEqual([]);
    expect(result.upcomingViewings).toBe(0);
    expect(result.totalViewings).toBe(0);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- --testPathPattern="seller.service.test" --no-coverage`
Expected: FAIL — new assertions fail because getDashboardOverview doesn't return the enhanced fields yet

- [ ] **Step 4: Commit failing tests**

```bash
git add src/domains/seller/__tests__/seller.service.test.ts
git commit -m "test: add failing tests for enhanced seller dashboard overview"
```

### Task 8: Implement Enhanced Seller Service

**Files:**
- Modify: `src/domains/seller/seller.service.ts`

- [ ] **Step 1: Read the current service file**

Read: `src/domains/seller/seller.service.ts`

- [ ] **Step 2: Enhance getDashboardOverview to return property, caseFlags, viewings**

Import viewingService at top:
```typescript
import * as viewingService from '../viewing/viewing.service';
```

In `getDashboardOverview`, after fetching seller with relations:

```typescript
export async function getDashboardOverview(sellerId: string): Promise<DashboardOverview> {
  const seller = await sellerRepo.getSellerWithRelations(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);

  const firstProperty = seller.properties[0] ?? null;
  const propertyStatus = firstProperty?.status ?? null;
  const transactionStatus = seller.transactions[0]?.status ?? null;

  // Fetch viewing stats if property exists
  let upcomingViewings = 0;
  let totalViewings = 0;
  if (firstProperty) {
    const stats = await viewingService.getViewingStats(firstProperty.id, sellerId);
    upcomingViewings = stats.upcomingCount;
    totalViewings = stats.totalViewings;
  }

  const unreadNotificationCount = await notificationService.countUnreadNotifications(
    'seller',
    sellerId,
  );

  const onboarding = buildOnboardingStatus(seller.onboardingStep);
  const nextSteps = buildNextSteps(onboarding, propertyStatus);

  return {
    seller: {
      id: seller.id,
      name: seller.name,
      email: seller.email,
      phone: seller.phone,
      status: seller.status,
      onboardingStep: seller.onboardingStep,
    },
    onboarding,
    property: firstProperty
      ? {
          block: firstProperty.block,
          street: firstProperty.street,
          town: firstProperty.town,
          flatType: firstProperty.flatType,
          floorAreaSqm: Number(firstProperty.floorAreaSqm),
          askingPrice: firstProperty.askingPrice ? Number(firstProperty.askingPrice) : 0,
          status: firstProperty.status,
        }
      : null,
    propertyStatus,
    transactionStatus,
    caseFlags: (seller.caseFlags ?? []).map((f) => ({
      id: f.id,
      flagType: f.flagType,
      description: f.description ?? '',
    })),
    upcomingViewings,
    totalViewings,
    unreadNotificationCount,
    nextSteps,
  };
}
```

- [ ] **Step 3: Add getDashboardStats method**

```typescript
export async function getDashboardStats(sellerId: string): Promise<DashboardStats> {
  const seller = await sellerRepo.getSellerWithRelations(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);

  const firstProperty = seller.properties[0] ?? null;
  let upcomingViewings = 0;
  let totalViewings = 0;
  if (firstProperty) {
    const stats = await viewingService.getViewingStats(firstProperty.id, sellerId);
    upcomingViewings = stats.upcomingCount;
    totalViewings = stats.totalViewings;
  }

  const unreadNotificationCount = await notificationService.countUnreadNotifications(
    'seller',
    sellerId,
  );

  return { upcomingViewings, totalViewings, unreadNotificationCount };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="seller.service.test" --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/seller/seller.service.ts src/domains/seller/seller.types.ts
git commit -m "feat: enhance getDashboardOverview with property, caseFlags, viewings"
```

### Task 9: Add Seller Dashboard Stats Route

**Files:**
- Modify: `src/domains/seller/seller.router.ts`

- [ ] **Step 1: Add GET /seller/dashboard/stats endpoint**

Add after the existing `/seller/dashboard` route:

```typescript
// Dashboard stats partial (HTMX auto-refresh)
sellerRouter.get('/seller/dashboard/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as AuthenticatedUser;
    const stats = await sellerService.getDashboardStats(user.id);
    res.render('partials/seller/dashboard-stats', { stats });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add src/domains/seller/seller.router.ts
git commit -m "feat: add /seller/dashboard/stats HTMX endpoint"
```

### Task 10: Create Seller Dashboard Stats Partial

**Files:**
- Create: `src/views/partials/seller/dashboard-stats.njk`

- [ ] **Step 1: Create the stats partial**

```njk
{# Auto-refreshed via hx-get="/seller/dashboard/stats" hx-trigger="load, every 30s" #}
<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
  <div class="card text-center">
    <p class="text-3xl font-bold text-accent">{{ stats.upcomingViewings }}</p>
    <p class="text-sm text-gray-500 mt-1">{{ "Upcoming Viewings" | t }}</p>
  </div>
  <div class="card text-center">
    <p class="text-3xl font-bold text-ink">{{ stats.totalViewings }}</p>
    <p class="text-sm text-gray-500 mt-1">{{ "Total Viewings" | t }}</p>
  </div>
  <div class="card text-center">
    <p class="text-3xl font-bold text-ink">{{ stats.unreadNotificationCount }}</p>
    <p class="text-sm text-gray-500 mt-1">{{ "Unread Notifications" | t }}</p>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/partials/seller/dashboard-stats.njk
git commit -m "feat: add seller dashboard stats partial"
```

### Task 11: Enhance Seller Dashboard Page and Overview Partial

**Files:**
- Modify: `src/views/pages/seller/dashboard.njk`
- Modify: `src/views/partials/seller/dashboard-overview.njk`

- [ ] **Step 1: Update dashboard.njk**

Replace the existing content with enhanced version including case flag alert, stats auto-refresh, and transaction quick links:

```njk
{% extends "layouts/seller.njk" %}

{% block title %}{{ "Dashboard" | t }} — SellMyHouse.sg{% endblock %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "Welcome back, " | t }}{{ overview.seller.name }}</h1>

{# Case flag alert #}
{% if overview.caseFlags.length > 0 %}
<div class="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
  <div class="flex">
    <div class="flex-1">
      <p class="text-sm font-medium text-yellow-800">
        {{ "Your property has special circumstances that may affect the transaction." | t }}
      </p>
      <a href="/seller/case-flags" class="text-sm text-yellow-700 underline hover:text-yellow-900 mt-1 inline-block">
        {{ "Review guidance" | t }} &rarr;
      </a>
    </div>
  </div>
</div>
{% endif %}

<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
  {# Main content - 2 cols #}
  <div class="lg:col-span-2">
    {% include "partials/seller/dashboard-overview.njk" %}

    {# Quick stats - auto-refresh #}
    <div id="dashboard-stats"
         hx-get="/seller/dashboard/stats"
         hx-trigger="load, every 30s"
         hx-swap="innerHTML">
      <div class="text-gray-400 text-sm py-4">{{ "Loading stats..." | t }}</div>
    </div>

    {# Transaction quick links #}
    {% if overview.property and overview.property.status in ['offer_received', 'under_option', 'completed'] %}
    <div class="card mb-6">
      <h2 class="font-semibold mb-3">{{ "Transaction" | t }}</h2>
      <div class="flex flex-wrap gap-3">
        <a href="/seller/offers" class="btn-outline">{{ "View received offers" | t }}</a>
        <a href="/seller/transaction" class="btn-outline">{{ "View transaction status" | t }}</a>
      </div>
    </div>
    {% endif %}

    {# Notifications preview #}
    {% if overview.unreadNotificationCount > 0 %}
    <div class="card">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold">{{ "Notifications" | t }}</h2>
        <a href="/seller/notifications" class="text-sm text-accent hover:underline">{{ "View all" | t }}</a>
      </div>
      <p class="text-sm text-gray-600">
        {{ "You have" | t }} {{ overview.unreadNotificationCount }} {{ "unread notification(s)" | t }}
      </p>
    </div>
    {% endif %}
  </div>

  {# Sidebar - 1 col #}
  <div class="space-y-6">
    {% include "partials/seller/timeline.njk" %}
  </div>
</div>
{% endblock %}
```

- [ ] **Step 2: Update dashboard-overview.njk with enhanced status card**

```njk
{# Transaction Status Card #}
<div class="card mb-6">
  <h2 class="font-semibold mb-3">{{ "Transaction Status" | t }}</h2>

  {% if overview.property %}
  <div class="space-y-2 mb-4">
    <p class="text-lg font-medium text-gray-900">
      {{ overview.property.block }} {{ overview.property.street }}
    </p>
    <p class="text-sm text-gray-500">{{ overview.property.town }}</p>
    <div class="flex flex-wrap gap-4 text-sm text-gray-600">
      <span>{{ overview.property.flatType }}</span>
      <span>{{ overview.property.floorAreaSqm }} sqm</span>
    </div>
    {% if overview.property.askingPrice %}
    <p class="text-xl font-bold text-accent">${{ overview.property.askingPrice | formatPrice }}</p>
    {% endif %}
  </div>
  <div class="flex items-center gap-2">
    {% set badgeStatus = overview.property.status %}{% include "partials/status-badge.njk" %}
    {% set badgeStatus = overview.seller.status %}{% include "partials/status-badge.njk" %}
  </div>
  {% else %}
  <p class="text-gray-500 mb-4">{{ "No property registered yet." | t }}</p>
  <a href="/seller/onboarding" class="btn-primary inline-block">{{ "Start Onboarding" | t }}</a>
  {% endif %}
</div>

{# Next steps #}
{% if overview.nextSteps.length > 0 %}
<div class="card mb-6">
  <h2 class="font-semibold mb-3">{{ "Next Steps" | t }}</h2>
  <ul class="space-y-3">
    {% for step in overview.nextSteps %}
    <li>
      <a href="{{ step.href }}" class="flex items-center justify-between p-3 rounded-md border border-gray-200 hover:bg-bg-alt transition">
        <div class="flex items-center gap-3">
          <div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
            {% if step.completed %}bg-green-100 text-green-700{% else %}bg-gray-100 text-gray-500{% endif %}">
            {% if step.completed %}&#10003;{% else %}{{ loop.index }}{% endif %}
          </div>
          <div>
            <p class="font-medium text-gray-900">{{ step.label | t }}</p>
            <p class="text-sm text-gray-500">{{ step.description | t }}</p>
          </div>
        </div>
        <span class="text-gray-400">&rarr;</span>
      </a>
    </li>
    {% endfor %}
  </ul>
</div>
{% endif %}
```

- [ ] **Step 3: Rebuild CSS**

Run: `npm run build:css`
Expected: Exit 0

- [ ] **Step 4: Commit**

```bash
git add src/views/pages/seller/dashboard.njk src/views/partials/seller/dashboard-overview.njk
git commit -m "feat: enhance seller dashboard with case flags, stats, quick links"
```

---

## Chunk 3: Agent Dashboard Pipeline

### Task 12: Enhance Agent Types

**Files:**
- Modify: `src/domains/agent/agent.types.ts`

- [ ] **Step 1: Read the current types file**

Read: `src/domains/agent/agent.types.ts`

- [ ] **Step 2: Add sellers array to PipelineStage and add PipelineOverview type alias**

The existing `PipelineStage` has `status`, `count`, `totalValue`. Add `sellers` array:

```typescript
export interface PipelineSeller {
  id: string;
  name: string;
  phone: string;
  askingPrice: number;
  status: string;
}

export interface PipelineStage {
  status: SellerStatus;
  count: number;
  totalValue: number;
  sellers: PipelineSeller[];
}

// Update existing PipelineOverview interface — add unassignedLeadCount:
export interface PipelineOverview {
  stages: PipelineStage[];
  recentActivity: ActivityItem[];
  pendingReviewCount: number;
  unassignedLeadCount: number; // NEW
}
```

- [ ] **Step 3: Commit**

```bash
git add src/domains/agent/agent.types.ts
git commit -m "feat: add PipelineSeller type and unassignedLeadCount to pipeline"
```

### Task 13: Write Failing Tests for Enhanced Agent Pipeline

**Files:**
- Modify: `src/domains/agent/__tests__/agent.service.test.ts`

- [ ] **Step 1: Read the existing test file**

Read: `src/domains/agent/__tests__/agent.service.test.ts`

- [ ] **Step 2: Add tests for enhanced getPipelineOverview**

```typescript
describe('getPipelineOverview - enhanced', () => {
  it('returns sellers array in each pipeline stage', async () => {
    mockRepo.getPipelineStages.mockResolvedValue([
      { status: 'active', count: 1, totalValue: 500000, sellers: [
        { id: 's1', name: 'John', phone: '91234567', askingPrice: 500000, status: 'active' }
      ]},
    ]);
    mockRepo.getRecentActivity.mockResolvedValue([]);
    mockRepo.getPendingReviewCount.mockResolvedValue(0);
    mockRepo.getUnassignedLeadCount.mockResolvedValue(3);

    const result = await agentService.getPipelineOverview(undefined);

    expect(result.stages[0].sellers).toHaveLength(1);
    expect(result.stages[0].sellers[0].name).toBe('John');
    expect(result.unassignedLeadCount).toBe(3);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- --testPathPattern="agent.service.test" --no-coverage`
Expected: FAIL

- [ ] **Step 4: Commit**

```bash
git add src/domains/agent/__tests__/agent.service.test.ts
git commit -m "test: add failing tests for enhanced agent pipeline with sellers"
```

### Task 14: Implement Enhanced Agent Repository and Service

**Files:**
- Modify: `src/domains/agent/agent.repository.ts`
- Modify: `src/domains/agent/agent.service.ts`

- [ ] **Step 1: Read the current repo file**

Read: `src/domains/agent/agent.repository.ts`

- [ ] **Step 2: Enhance getPipelineStages to include sellers**

The current method uses `groupBy` which doesn't return individual records. Change to:
1. Query sellers grouped by status (keep the aggregate)
2. Also query the top N sellers per stage with their property asking price

Add a new method or modify existing:

```typescript
export async function getPipelineStagesWithSellers(agentId?: string): Promise<PipelineStage[]> {
  const where = agentId ? { agentId } : {};

  // Get sellers with their first property's asking price
  const sellers = await prisma.seller.findMany({
    where: { ...where, status: { not: 'archived' } },
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      properties: {
        select: { askingPrice: true },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Group by status
  const stageMap = new Map<string, PipelineStage>();
  const stageOrder = ['lead', 'engaged', 'active', 'completed', 'archived'];

  for (const status of stageOrder) {
    stageMap.set(status, { status: status as SellerStatus, count: 0, totalValue: 0, sellers: [] });
  }

  for (const s of sellers) {
    const stage = stageMap.get(s.status);
    if (!stage) continue;
    const askingPrice = s.properties[0]?.askingPrice ? Number(s.properties[0].askingPrice) : 0;
    stage.count++;
    stage.totalValue += askingPrice;
    stage.sellers.push({
      id: s.id,
      name: s.name,
      phone: s.phone ?? '',
      askingPrice,
      status: s.status,
    });
  }

  return stageOrder.map((s) => stageMap.get(s)!);
}

export async function getUnassignedLeadCount(): Promise<number> {
  return prisma.seller.count({
    where: { status: 'lead', agentId: null },
  });
}
```

- [ ] **Step 3: Update service to use new repo methods**

In `agent.service.ts`, update `getPipelineOverview`:

```typescript
export async function getPipelineOverview(agentId?: string): Promise<PipelineOverview> {
  const [stages, recentActivity, pendingReviewCount, unassignedLeadCount] = await Promise.all([
    agentRepo.getPipelineStagesWithSellers(agentId),
    agentRepo.getRecentActivity(agentId),
    agentRepo.getPendingReviewCount(agentId),
    agentRepo.getUnassignedLeadCount(),
  ]);

  return { stages, recentActivity, pendingReviewCount, unassignedLeadCount };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern="agent.service.test" --no-coverage`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/agent/agent.repository.ts src/domains/agent/agent.service.ts
git commit -m "feat: enhance agent pipeline with sellers array and unassigned lead count"
```

### Task 15: Create Agent Pipeline Overview Partial

**Files:**
- Create: `src/views/partials/agent/pipeline-overview.njk`

- [ ] **Step 1: Create the pipeline overview partial**

```njk
{# Pipeline stage colors #}
{% set stageColors = {
  'lead': 'border-blue-500',
  'engaged': 'border-yellow-500',
  'active': 'border-green-500',
  'completed': 'border-purple-500',
  'archived': 'border-gray-400'
} %}
{% set stageBgColors = {
  'lead': 'bg-blue-50',
  'engaged': 'bg-yellow-50',
  'active': 'bg-green-50',
  'completed': 'bg-purple-50',
  'archived': 'bg-gray-50'
} %}

{# Pipeline cards #}
<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
  {% for stage in overview.stages %}
  <div class="card border-t-4 {{ stageColors[stage.status] or 'border-gray-300' }}">
    <p class="text-xs font-medium text-gray-500 uppercase">{{ stage.status | replace("_", " ") | t }}</p>
    <p class="text-2xl font-bold mt-1">{{ stage.count }}</p>
    {% if stage.totalValue > 0 %}
    <p class="text-sm text-gray-500">${{ stage.totalValue | formatPrice }}</p>
    {% endif %}
  </div>
  {% endfor %}
</div>

{# Lead queue summary #}
{% if overview.unassignedLeadCount > 0 %}
<div class="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
  <div class="flex items-center justify-between">
    <p class="text-sm font-medium text-blue-800">
      {{ overview.unassignedLeadCount }} {{ "new leads awaiting assignment" | t }}
    </p>
    <a href="/agent/leads" class="text-sm text-blue-700 underline hover:text-blue-900">
      {{ "View leads" | t }} &rarr;
    </a>
  </div>
</div>
{% endif %}

{# Detailed tables per stage #}
{% for stage in overview.stages %}
{% if stage.sellers.length > 0 %}
<div class="mb-8">
  <h3 class="text-lg font-semibold mb-3 flex items-center gap-2">
    <span class="w-3 h-3 rounded-full {{ stageBgColors[stage.status] or 'bg-gray-100' }} border-2 {{ stageColors[stage.status] or 'border-gray-300' }}"></span>
    {{ stage.status | replace("_", " ") | capitalize | t }}
    <span class="text-sm font-normal text-gray-500">({{ stage.count }})</span>
  </h3>
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="bg-gray-50 text-gray-600 uppercase text-xs">
        <tr>
          <th class="px-4 py-3 text-left">{{ "Name" | t }}</th>
          <th class="px-4 py-3 text-left">{{ "Phone" | t }}</th>
          <th class="px-4 py-3 text-right">{{ "Asking Price" | t }}</th>
          <th class="px-4 py-3 text-right">{{ "Actions" | t }}</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-200">
        {% for seller in stage.sellers %}
        <tr class="hover:bg-bg-alt transition cursor-pointer" data-action="navigate" data-url="/agent/sellers/{{ seller.id }}">
          <td class="px-4 py-3 font-medium text-gray-900">{{ seller.name }}</td>
          <td class="px-4 py-3 text-gray-600">{{ seller.phone }}</td>
          <td class="px-4 py-3 text-right">
            {% if seller.askingPrice > 0 %}${{ seller.askingPrice | formatPrice }}{% else %}-{% endif %}
          </td>
          <td class="px-4 py-3 text-right">
            <a href="/agent/sellers/{{ seller.id }}" class="text-accent hover:underline">{{ "View" | t }}</a>
          </td>
        </tr>
        {% endfor %}
      </tbody>
    </table>
  </div>
</div>
{% endif %}
{% endfor %}
```

- [ ] **Step 2: Commit**

```bash
git add src/views/partials/agent/pipeline-overview.njk
git commit -m "feat: add agent pipeline overview partial with cards and tables"
```

### Task 16: Update Agent Dashboard Page

**Files:**
- Modify: `src/views/pages/agent/dashboard.njk`
- Modify: `src/domains/agent/agent.router.ts`

- [ ] **Step 1: Update the agent dashboard page**

```njk
{% extends "layouts/agent.njk" %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "Pipeline Overview" | t }}</h1>

{# Pipeline cards auto-refresh #}
<div id="pipeline-cards"
     hx-get="/agent/dashboard/stats"
     hx-trigger="load, every 30s"
     hx-swap="innerHTML">
  <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
    {% for stage in overview.stages %}
    <div class="card border-t-4 border-gray-200 animate-pulse">
      <div class="h-4 bg-gray-200 rounded w-16 mb-2"></div>
      <div class="h-8 bg-gray-200 rounded w-10"></div>
    </div>
    {% endfor %}
  </div>
</div>

{# Full pipeline content (loaded once, not auto-refreshed) #}
<div id="pipeline-content">
  {% include "partials/agent/pipeline-overview.njk" %}
</div>
{% endblock %}
```

- [ ] **Step 2: Add /agent/dashboard/stats endpoint for card auto-refresh**

Add to `agent.router.ts` after the existing dashboard route:

```typescript
// GET /agent/dashboard/stats — Pipeline cards only (HTMX auto-refresh)
agentRouter.get(
  '/agent/dashboard/stats',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const overview = await agentService.getPipelineOverview(getAgentFilter(user));

      // Render just the pipeline cards portion
      const stageColors: Record<string, string> = {
        lead: 'border-blue-500',
        engaged: 'border-yellow-500',
        active: 'border-green-500',
        completed: 'border-purple-500',
        archived: 'border-gray-400',
      };

      res.render('partials/agent/pipeline-cards', { overview, stageColors });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 3: Create pipeline-cards.njk partial (just the stats cards)**

Create `src/views/partials/agent/pipeline-cards.njk`:

```njk
{% set stageColors = {
  'lead': 'border-blue-500',
  'engaged': 'border-yellow-500',
  'active': 'border-green-500',
  'completed': 'border-purple-500',
  'archived': 'border-gray-400'
} %}
<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
  {% for stage in overview.stages %}
  <div class="card border-t-4 {{ stageColors[stage.status] or 'border-gray-300' }}">
    <p class="text-xs font-medium text-gray-500 uppercase">{{ stage.status | replace("_", " ") | t }}</p>
    <p class="text-2xl font-bold mt-1">{{ stage.count }}</p>
    {% if stage.totalValue > 0 %}
    <p class="text-sm text-gray-500">${{ stage.totalValue | formatPrice }}</p>
    {% endif %}
  </div>
  {% endfor %}
</div>

{# Lead queue summary #}
{% if overview.unassignedLeadCount > 0 %}
<div class="bg-blue-50 border-l-4 border-blue-400 p-4">
  <div class="flex items-center justify-between">
    <p class="text-sm font-medium text-blue-800">
      {{ overview.unassignedLeadCount }} {{ "new leads awaiting assignment" | t }}
    </p>
    <a href="/agent/leads" class="text-sm text-blue-700 underline hover:text-blue-900">{{ "View leads" | t }} &rarr;</a>
  </div>
</div>
{% endif %}
```

- [ ] **Step 4: Update existing agent dashboard route to pass overview data**

In the existing `/agent/dashboard` route handler, the HTMX branch already renders the pipeline partial. Ensure it passes `overview`:

```typescript
if (req.headers['hx-request']) {
  return res.render('partials/agent/pipeline-overview', { overview });
}
res.render('pages/agent/dashboard', { overview });
```

Note: The route already fetches `repeatViewers` in parallel — keep that call but the dashboard template no longer needs it (it was for the old minimal view). The pipeline-overview partial only uses `overview`.

- [ ] **Step 5: Rebuild CSS**

Run: `npm run build:css`
Expected: Exit 0

- [ ] **Step 6: Commit**

```bash
git add src/views/pages/agent/dashboard.njk src/views/partials/agent/pipeline-overview.njk src/views/partials/agent/pipeline-cards.njk src/domains/agent/agent.router.ts
git commit -m "feat: enhance agent dashboard with pipeline cards, tables, auto-refresh"
```

---

## Chunk 4: Admin Analytics Dashboard

### Task 17: Add Admin Analytics Types

**Files:**
- Modify: `src/domains/admin/admin.types.ts`

- [ ] **Step 1: Read the current types file**

Read: `src/domains/admin/admin.types.ts`

- [ ] **Step 2: Add AnalyticsData interface**

```typescript
export interface AnalyticsData {
  revenue: {
    totalRevenue: number;
    completedCount: number;
    pipelineValue: number;
    activeTransactions: number;
    commissionPerTransaction: number;
    pendingInvoices: number;
  };
  funnel: Record<string, number>;
  timeToClose: {
    averageDays: number;
    count: number;
    byFlatType: Record<string, { averageDays: number; count: number }>;
  };
  leadSources: Record<string, { total: number; conversionRate: number }>;
  viewings: {
    totalViewings: number;
    completed: number;
    noShowRate: number;
    cancellationRate: number;
  };
  referrals: {
    totalLinks: number;
    totalClicks: number;
    leadsCreated: number;
    transactionsCompleted: number;
    conversionRate: number;
    topReferrers: Array<{ name: string; clicks: number; status: string }>;
  };
}

export interface AnalyticsFilter {
  dateFrom?: string;
  dateTo?: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/domains/admin/admin.types.ts
git commit -m "feat: add AnalyticsData and AnalyticsFilter types"
```

### Task 18: Write Failing Tests for Admin Analytics Service

**Files:**
- Create: `src/domains/admin/__tests__/admin.analytics.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
import * as adminService from '../admin.service';
import * as adminRepo from '../admin.repository';
import * as settingsService from '@/domains/shared/settings.service';

jest.mock('../admin.repository');
jest.mock('@/domains/shared/settings.service');

const mockRepo = adminRepo as jest.Mocked<typeof adminRepo>;
const mockSettings = settingsService as jest.Mocked<typeof settingsService>;

beforeEach(() => jest.clearAllMocks());

describe('getAnalytics', () => {
  it('returns analytics data with default date range (last 30 days)', async () => {
    mockRepo.getRevenueMetrics.mockResolvedValue({
      totalRevenue: 4901.73,
      completedCount: 3,
      pipelineValue: 1500000,
      activeTransactions: 2,
      pendingInvoices: 1,
    });
    mockSettings.getNumber.mockResolvedValue(1633.91);
    mockRepo.getTransactionFunnel.mockResolvedValue({
      lead: 10, engaged: 5, active: 3, option_exercised: 1, completed: 3,
    });
    mockRepo.getTimeToClose.mockResolvedValue({
      averageDays: 45,
      count: 3,
      byFlatType: { '4 ROOM': { averageDays: 42, count: 2 } },
    });
    mockRepo.getLeadSourceMetrics.mockResolvedValue({
      website: { total: 20, conversionRate: 15 },
      referral: { total: 5, conversionRate: 40 },
    });
    mockRepo.getViewingMetrics.mockResolvedValue({
      totalViewings: 50,
      completed: 40,
      noShowRate: 10,
      cancellationRate: 5,
    });
    mockRepo.getReferralMetrics.mockResolvedValue({
      totalLinks: 30,
      totalClicks: 100,
      leadsCreated: 5,
      transactionsCompleted: 1,
      conversionRate: 16.67,
      topReferrers: [{ name: 'Jane', clicks: 20, status: 'active' }],
    });

    const result = await adminService.getAnalytics({});

    expect(result.revenue.totalRevenue).toBe(4901.73);
    expect(result.revenue.commissionPerTransaction).toBe(1633.91);
    expect(result.funnel).toHaveProperty('lead', 10);
    expect(result.timeToClose.averageDays).toBe(45);
    expect(result.leadSources).toHaveProperty('website');
    expect(result.viewings.totalViewings).toBe(50);
    expect(result.referrals.topReferrers).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --testPathPattern="admin.analytics.test" --no-coverage`
Expected: FAIL — getAnalytics method doesn't exist yet

- [ ] **Step 3: Commit**

```bash
git add src/domains/admin/__tests__/admin.analytics.test.ts
git commit -m "test: add failing tests for admin analytics service"
```

### Task 19: Implement Admin Analytics Repository Methods

**Files:**
- Modify: `src/domains/admin/admin.repository.ts`

- [ ] **Step 1: Read the current repo file**

Read: `src/domains/admin/admin.repository.ts`

- [ ] **Step 2: Add analytics query methods**

These methods query across transactions, sellers, viewings, and referrals. Each returns a focused data slice.

```typescript
export async function getRevenueMetrics(dateFrom?: Date, dateTo?: Date) {
  const dateFilter = dateFrom && dateTo ? { createdAt: { gte: dateFrom, lte: dateTo } } : {};

  const [completed, active, pendingInvoices] = await Promise.all([
    prisma.transaction.aggregate({
      where: { status: 'completed', ...dateFilter },
      _sum: { agreedPrice: true },
      _count: true,
    }),
    prisma.transaction.aggregate({
      where: { status: { notIn: ['completed', 'fallen_through'] }, ...dateFilter },
      _sum: { agreedPrice: true },
      _count: true,
    }),
    prisma.commissionInvoice.count({
      where: { status: 'pending', ...dateFilter },
    }),
  ]);

  // Revenue = completed count × commission per transaction
  // Actual commission is read from SystemSetting in the service layer
  return {
    totalRevenue: 0, // computed in service
    completedCount: completed._count,
    pipelineValue: Number(active._sum.agreedPrice ?? 0),
    activeTransactions: active._count,
    pendingInvoices,
  };
}

export async function getTransactionFunnel(dateFrom?: Date, dateTo?: Date) {
  const dateFilter = dateFrom && dateTo ? { createdAt: { gte: dateFrom, lte: dateTo } } : {};

  const stages = await prisma.seller.groupBy({
    by: ['status'],
    where: dateFilter,
    _count: true,
  });

  const funnel: Record<string, number> = {};
  for (const stage of stages) {
    funnel[stage.status] = stage._count;
  }
  return funnel;
}

export async function getTimeToClose(dateFrom?: Date, dateTo?: Date) {
  const dateFilter = dateFrom && dateTo
    ? { completionDate: { gte: dateFrom, lte: dateTo } }
    : {};

  const completed = await prisma.transaction.findMany({
    where: { status: 'completed', completionDate: { not: null }, ...dateFilter },
    select: {
      createdAt: true,
      completionDate: true,
      property: { select: { flatType: true } },
    },
  });

  if (completed.length === 0) {
    return { averageDays: 0, count: 0, byFlatType: {} };
  }

  let totalDays = 0;
  const byFlatType: Record<string, { totalDays: number; count: number }> = {};

  for (const tx of completed) {
    const days = Math.round(
      (tx.completionDate!.getTime() - tx.createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    totalDays += days;

    const ft = tx.property?.flatType ?? 'Unknown';
    if (!byFlatType[ft]) byFlatType[ft] = { totalDays: 0, count: 0 };
    byFlatType[ft].totalDays += days;
    byFlatType[ft].count++;
  }

  const averageDays = Math.round(totalDays / completed.length);
  const byFlatTypeResult: Record<string, { averageDays: number; count: number }> = {};
  for (const [ft, data] of Object.entries(byFlatType)) {
    byFlatTypeResult[ft] = {
      averageDays: Math.round(data.totalDays / data.count),
      count: data.count,
    };
  }

  return { averageDays, count: completed.length, byFlatType: byFlatTypeResult };
}

export async function getLeadSourceMetrics(dateFrom?: Date, dateTo?: Date) {
  const dateFilter = dateFrom && dateTo ? { createdAt: { gte: dateFrom, lte: dateTo } } : {};

  const sources = await prisma.seller.groupBy({
    by: ['leadSource'],
    where: { leadSource: { not: null }, ...dateFilter },
    _count: true,
  });

  const converted = await prisma.seller.groupBy({
    by: ['leadSource'],
    where: { leadSource: { not: null }, status: 'completed', ...dateFilter },
    _count: true,
  });

  const convertedMap = new Map(converted.map((c) => [c.leadSource, c._count]));

  const result: Record<string, { total: number; conversionRate: number }> = {};
  for (const source of sources) {
    const key = source.leadSource ?? 'unknown';
    const total = source._count;
    const conv = convertedMap.get(source.leadSource) ?? 0;
    result[key] = {
      total,
      conversionRate: total > 0 ? Math.round((conv / total) * 100) : 0,
    };
  }

  return result;
}

export async function getViewingMetrics(dateFrom?: Date, dateTo?: Date) {
  const dateFilter = dateFrom && dateTo ? { createdAt: { gte: dateFrom, lte: dateTo } } : {};

  const [total, completed, noShows, cancelled] = await Promise.all([
    prisma.viewing.count({ where: dateFilter }),
    prisma.viewing.count({ where: { status: 'completed', ...dateFilter } }),
    prisma.viewing.count({ where: { status: 'no_show', ...dateFilter } }),
    prisma.viewing.count({ where: { status: 'cancelled', ...dateFilter } }),
  ]);

  return {
    totalViewings: total,
    completed,
    noShowRate: total > 0 ? Math.round((noShows / total) * 100) : 0,
    cancellationRate: total > 0 ? Math.round((cancelled / total) * 100) : 0,
  };
}

export async function getReferralMetrics(dateFrom?: Date, dateTo?: Date) {
  const dateFilter = dateFrom && dateTo ? { createdAt: { gte: dateFrom, lte: dateTo } } : {};

  // Schema: model Referral { id, referrerSellerId, referralCode, referredName,
  //   referredPhone, referredSellerId, status (ReferralStatus), clickCount, createdAt, convertedAt }
  const [referrals, leadsCreated, txCompleted] = await Promise.all([
    prisma.referral.findMany({
      where: dateFilter,
      select: {
        clickCount: true,
        status: true,
        referrer: { select: { name: true } },
      },
      orderBy: { clickCount: 'desc' },
    }),
    prisma.seller.count({ where: { leadSource: 'referral', ...dateFilter } }),
    prisma.seller.count({ where: { leadSource: 'referral', status: 'completed', ...dateFilter } }),
  ]);

  const totalLinks = referrals.length;
  const totalClicks = referrals.reduce((sum, r) => sum + r.clickCount, 0);
  const conversionRate = totalLinks > 0 ? Math.round((leadsCreated / totalLinks) * 100 * 100) / 100 : 0;

  const topReferrers = referrals.slice(0, 10).map((r) => ({
    name: r.referrer?.name ?? 'Unknown',
    clicks: r.clickCount,
    status: r.status ?? 'link_generated',
  }));

  return {
    totalLinks,
    totalClicks,
    leadsCreated,
    transactionsCompleted: txCompleted,
    conversionRate,
    topReferrers,
  };
}

- [ ] **Step 3: Commit**

```bash
git add src/domains/admin/admin.repository.ts
git commit -m "feat: add admin analytics repository methods"
```

### Task 20: Implement Admin Analytics Service Method

**Files:**
- Modify: `src/domains/admin/admin.service.ts`

- [ ] **Step 1: Read the current service file**

Read: `src/domains/admin/admin.service.ts`

- [ ] **Step 2: Add getAnalytics method**

```typescript
import type { AnalyticsData, AnalyticsFilter } from './admin.types';
import * as settingsService from '@/domains/shared/settings.service';

export async function getAnalytics(filter: AnalyticsFilter): Promise<AnalyticsData> {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const dateFrom = filter.dateFrom ? new Date(filter.dateFrom) : defaultFrom;
  const dateTo = filter.dateTo ? new Date(filter.dateTo) : now;

  const [revenue, funnel, timeToClose, leadSources, viewings, referrals, commission] =
    await Promise.all([
      adminRepo.getRevenueMetrics(dateFrom, dateTo),
      adminRepo.getTransactionFunnel(dateFrom, dateTo),
      adminRepo.getTimeToClose(dateFrom, dateTo),
      adminRepo.getLeadSourceMetrics(dateFrom, dateTo),
      adminRepo.getViewingMetrics(dateFrom, dateTo),
      adminRepo.getReferralMetrics(dateFrom, dateTo),
      settingsService.getNumber('commission_total_with_gst', 1633.91),
    ]);

  return {
    revenue: {
      ...revenue,
      totalRevenue: revenue.completedCount * commission,
      commissionPerTransaction: commission,
    },
    funnel,
    timeToClose,
    leadSources,
    viewings,
    referrals,
  };
}
```

- [ ] **Step 3: Run tests**

Run: `npm test -- --testPathPattern="admin.analytics.test" --no-coverage`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/domains/admin/admin.service.ts
git commit -m "feat: add getAnalytics method to admin service"
```

### Task 21: Add Admin Analytics Route

**Files:**
- Modify: `src/domains/admin/admin.router.ts`

- [ ] **Step 1: Update the dashboard route to serve analytics**

Replace the existing `/admin/dashboard` route:

```typescript
// ─── Dashboard (Analytics) ─────────────────────────────────────
adminRouter.get(
  '/admin/dashboard',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filter = {
        dateFrom: req.query['dateFrom'] as string | undefined,
        dateTo: req.query['dateTo'] as string | undefined,
      };
      const analytics = await adminService.getAnalytics(filter);

      if (req.headers['hx-request']) {
        return res.render('partials/admin/analytics', { analytics, filter });
      }
      res.render('pages/admin/dashboard', { analytics, filter });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 2: Commit**

```bash
git add src/domains/admin/admin.router.ts
git commit -m "feat: update admin dashboard route to serve analytics data"
```

### Task 22: Add Chart.js to Admin Layout and Whitelist CDN in CSP

**Files:**
- Modify: `src/views/layouts/admin.njk`
- Modify: `src/infra/http/app.ts`

- [ ] **Step 1: Read the current admin layout**

Read: `src/views/layouts/admin.njk`

- [ ] **Step 2: Add Chart.js CDN to CSP whitelist**

In `src/infra/http/app.ts`, add `'https://cdn.jsdelivr.net'` to the `scriptSrc` directives array:

```typescript
scriptSrc: [
  "'self'",
  'https://cdn.jsdelivr.net',
  (req, res) => `'nonce-${(res as express.Response).locals.cspNonce}'`,
],
```

- [ ] **Step 3: Add Chart.js CDN in admin layout head block**

Add a `{% block head %}` to the admin layout that includes Chart.js:

```njk
{% block head %}
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js" nonce="{{ cspNonce }}"></script>
{% endblock %}
```

Note: If the admin layout doesn't extend base.njk with a head block, add the script in the appropriate location within the layout.

- [ ] **Step 4: Commit**

```bash
git add src/views/layouts/admin.njk src/infra/http/app.ts
git commit -m "feat: add Chart.js CDN to admin layout and whitelist in CSP"
```

### Task 23: Create Admin Analytics Partial

**Files:**
- Create: `src/views/partials/admin/analytics.njk`

- [ ] **Step 1: Create the analytics partial**

This is the HTMX target that gets swapped on date filter changes and auto-refresh.

```njk
{# Date filter #}
<div class="flex flex-wrap items-end gap-4 mb-6">
  <div>
    <label class="block text-xs text-gray-500 mb-1">{{ "From" | t }}</label>
    <input type="date" name="dateFrom" id="dateFrom" value="{{ filter.dateFrom or '' }}" class="input-field w-40">
  </div>
  <div>
    <label class="block text-xs text-gray-500 mb-1">{{ "To" | t }}</label>
    <input type="date" name="dateTo" id="dateTo" value="{{ filter.dateTo or '' }}" class="input-field w-40">
  </div>
  <button
    hx-get="/admin/dashboard"
    hx-include="#dateFrom, #dateTo"
    hx-target="#analytics-content"
    hx-swap="innerHTML"
    class="btn-primary">
    {{ "Filter" | t }}
  </button>
</div>

{# Revenue cards #}
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
  <div class="card text-center">
    <p class="text-xs text-gray-500 uppercase">{{ "Total Revenue" | t }}</p>
    <p class="text-2xl font-bold text-accent">${{ analytics.revenue.totalRevenue | formatPrice }}</p>
    <p class="text-sm text-gray-500">{{ analytics.revenue.completedCount }} {{ "completed" | t }}</p>
  </div>
  <div class="card text-center">
    <p class="text-xs text-gray-500 uppercase">{{ "Pipeline Value" | t }}</p>
    <p class="text-2xl font-bold text-ink">${{ analytics.revenue.pipelineValue | formatPrice }}</p>
    <p class="text-sm text-gray-500">{{ analytics.revenue.activeTransactions }} {{ "active" | t }}</p>
  </div>
  <div class="card text-center">
    <p class="text-xs text-gray-500 uppercase">{{ "Per Transaction" | t }}</p>
    <p class="text-2xl font-bold text-ink">${{ analytics.revenue.commissionPerTransaction | formatPrice }}</p>
  </div>
  <div class="card text-center">
    <p class="text-xs text-gray-500 uppercase">{{ "Pending Invoices" | t }}</p>
    <p class="text-2xl font-bold text-ink">{{ analytics.revenue.pendingInvoices }}</p>
  </div>
</div>

{# Transaction funnel chart #}
<div class="card mb-8">
  <h3 class="font-semibold mb-4">{{ "Transaction Funnel" | t }}</h3>
  <canvas id="funnelChart" height="200"></canvas>
  <noscript>
    <div class="grid grid-cols-5 gap-2 text-center text-sm">
      {% for stage, count in analytics.funnel | dictsort %}
      <div>
        <p class="font-bold">{{ count }}</p>
        <p class="text-gray-500">{{ stage | replace("_", " ") | capitalize }}</p>
      </div>
      {% endfor %}
    </div>
  </noscript>
  <script nonce="{{ cspNonce }}">
    (function() {
      const ctx = document.getElementById('funnelChart');
      if (!ctx) return;
      const data = {{ analytics.funnel | dump | safe }};
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: Object.keys(data).map(s => s.replace(/_/g, ' ')),
          datasets: [{
            data: Object.values(data),
            backgroundColor: ['#3b82f6', '#eab308', '#22c55e', '#8b5cf6', '#6b7280'],
          }],
        },
        options: {
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } },
        },
      });
    })();
  </script>
</div>

{# Time to close + Lead sources (2 col) #}
<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
  {# Time to close #}
  <div class="card">
    <h3 class="font-semibold mb-4">{{ "Time to Close" | t }}</h3>
    <div class="flex items-baseline gap-2 mb-4">
      <span class="text-3xl font-bold">{{ analytics.timeToClose.averageDays }}</span>
      <span class="text-gray-500">{{ "days avg" | t }}</span>
      <span class="text-sm text-gray-400">({{ analytics.timeToClose.count }} {{ "transactions" | t }})</span>
    </div>
    <canvas id="timeToCloseChart" height="150"></canvas>
    <script nonce="{{ cspNonce }}">
      (function() {
        const ctx = document.getElementById('timeToCloseChart');
        if (!ctx) return;
        const data = {{ analytics.timeToClose.byFlatType | dump | safe }};
        const labels = Object.keys(data);
        const values = labels.map(k => data[k].averageDays);
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels,
            datasets: [{ label: 'Days', data: values, backgroundColor: '#c8553d' }],
          },
          options: {
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } },
          },
        });
      })();
    </script>
  </div>

  {# Lead sources #}
  <div class="card">
    <h3 class="font-semibold mb-4">{{ "Lead Sources" | t }}</h3>
    <canvas id="leadSourceChart" height="150"></canvas>
    <script nonce="{{ cspNonce }}">
      (function() {
        const ctx = document.getElementById('leadSourceChart');
        if (!ctx) return;
        const data = {{ analytics.leadSources | dump | safe }};
        const labels = Object.keys(data);
        const values = labels.map(k => data[k].total);
        new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels,
            datasets: [{ data: values, backgroundColor: ['#c8553d', '#1a1a2e', '#3b82f6', '#22c55e', '#eab308'] }],
          },
          options: { plugins: { legend: { position: 'bottom' } } },
        });
      })();
    </script>
    <table class="w-full text-sm mt-4">
      <thead class="text-xs text-gray-500 uppercase">
        <tr><th class="text-left py-1">{{ "Source" | t }}</th><th class="text-right py-1">{{ "Total" | t }}</th><th class="text-right py-1">{{ "Conv. %" | t }}</th></tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        {% for source, data in analytics.leadSources | dictsort %}
        <tr>
          <td class="py-1">{{ source }}</td>
          <td class="py-1 text-right">{{ data.total }}</td>
          <td class="py-1 text-right">{{ data.conversionRate }}%</td>
        </tr>
        {% endfor %}
      </tbody>
    </table>
  </div>
</div>

{# Viewings analytics #}
<div class="card mb-8">
  <h3 class="font-semibold mb-4">{{ "Viewings" | t }}</h3>
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
    <div class="text-center">
      <p class="text-2xl font-bold">{{ analytics.viewings.totalViewings }}</p>
      <p class="text-sm text-gray-500">{{ "Total" | t }}</p>
    </div>
    <div class="text-center">
      <p class="text-2xl font-bold text-green-600">{{ analytics.viewings.completed }}</p>
      <p class="text-sm text-gray-500">{{ "Completed" | t }}</p>
    </div>
    <div class="text-center">
      <p class="text-2xl font-bold text-red-500">{{ analytics.viewings.noShowRate }}%</p>
      <p class="text-sm text-gray-500">{{ "No-show Rate" | t }}</p>
    </div>
    <div class="text-center">
      <p class="text-2xl font-bold text-yellow-600">{{ analytics.viewings.cancellationRate }}%</p>
      <p class="text-sm text-gray-500">{{ "Cancellation Rate" | t }}</p>
    </div>
  </div>
</div>

{# Referral funnel #}
<div class="card">
  <h3 class="font-semibold mb-4">{{ "Referral Programme" | t }}</h3>
  <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
    <div class="text-center">
      <p class="text-2xl font-bold">{{ analytics.referrals.totalLinks }}</p>
      <p class="text-xs text-gray-500">{{ "Links" | t }}</p>
    </div>
    <div class="text-center">
      <p class="text-2xl font-bold">{{ analytics.referrals.totalClicks }}</p>
      <p class="text-xs text-gray-500">{{ "Clicks" | t }}</p>
    </div>
    <div class="text-center">
      <p class="text-2xl font-bold">{{ analytics.referrals.leadsCreated }}</p>
      <p class="text-xs text-gray-500">{{ "Leads" | t }}</p>
    </div>
    <div class="text-center">
      <p class="text-2xl font-bold">{{ analytics.referrals.transactionsCompleted }}</p>
      <p class="text-xs text-gray-500">{{ "Completed" | t }}</p>
    </div>
    <div class="text-center">
      <p class="text-2xl font-bold text-accent">{{ analytics.referrals.conversionRate }}%</p>
      <p class="text-xs text-gray-500">{{ "Conversion" | t }}</p>
    </div>
  </div>

  {% if analytics.referrals.topReferrers.length > 0 %}
  <h4 class="text-sm font-medium text-gray-700 mb-2">{{ "Top Referrers" | t }}</h4>
  <table class="w-full text-sm">
    <thead class="text-xs text-gray-500 uppercase">
      <tr>
        <th class="text-left py-1">{{ "Name" | t }}</th>
        <th class="text-right py-1">{{ "Clicks" | t }}</th>
        <th class="text-right py-1">{{ "Status" | t }}</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-gray-100">
      {% for referrer in analytics.referrals.topReferrers %}
      <tr>
        <td class="py-1">{{ referrer.name }}</td>
        <td class="py-1 text-right">{{ referrer.clicks }}</td>
        <td class="py-1 text-right">
          {% set badgeStatus = referrer.status %}{% include "partials/status-badge.njk" %}
        </td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
  {% endif %}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/partials/admin/analytics.njk
git commit -m "feat: add admin analytics partial with charts"
```

### Task 24: Update Admin Dashboard Page

**Files:**
- Modify: `src/views/pages/admin/dashboard.njk`

- [ ] **Step 1: Replace the dashboard page with analytics layout**

```njk
{% extends "layouts/admin.njk" %}

{% block content %}
<h1 class="text-2xl font-bold mb-2">{{ "Analytics Dashboard" | t }}</h1>
<p class="text-gray-500 mb-6">{{ "Platform performance overview" | t }}</p>

<div id="analytics-content">
  {% include "partials/admin/analytics.njk" %}
</div>
{% endblock %}
```

- [ ] **Step 2: Rebuild CSS**

Run: `npm run build:css`
Expected: Exit 0

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/admin/dashboard.njk
git commit -m "feat: replace admin dashboard with analytics layout"
```

---

## Chunk 5: Nunjucks Filter, Integration Testing & Final Verification

### Task 25: Verify Nunjucks Filters

**Files:**
- Verify: `src/infra/http/app.ts` (Nunjucks setup, line ~70)

The templates use `{{ value | formatPrice }}` for currency formatting — this filter already exists.
The analytics charts use `{{ data | dump | safe }}` — Nunjucks built-in `dump` filter handles JSON serialization.

- [ ] **Step 1: Verify formatPrice filter exists**

Read: `src/infra/http/app.ts`. Confirm `env.addFilter('formatPrice', ...)` is present at line ~70.

- [ ] **Step 2: No changes needed — skip to Task 26**

No changes needed — `formatPrice` filter and `dump` filter both already available.

### Task 26: Run Full Test Suite

- [ ] **Step 1: Run unit tests**

Run: `npm test --no-coverage`
Expected: All tests pass

- [ ] **Step 2: Run integration tests**

Run: `npm run test:integration`
Expected: All tests pass

- [ ] **Step 3: Fix any failures**

If tests fail, diagnose and fix. Common issues:
- Mock setup changes needed when service signatures change
- Import path changes when new dependencies added
- Type errors from enhanced interfaces

- [ ] **Step 4: Rebuild CSS one final time**

Run: `npm run build:css`
Expected: Exit 0

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "fix: resolve test failures and final CSS rebuild"
```

### Task 27: Verify TypeScript Compilation

- [ ] **Step 1: Run TypeScript build**

Run: `npm run build`
Expected: Exit 0 with no type errors

- [ ] **Step 2: Fix any type errors**

Common issues: missing exports, incorrect return types on enhanced service methods.

- [ ] **Step 3: Commit if needed**

```bash
git add -A
git commit -m "fix: resolve TypeScript compilation errors"
```
