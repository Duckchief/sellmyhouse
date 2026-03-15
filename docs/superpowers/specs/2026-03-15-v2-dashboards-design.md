# V2 Dashboard Enhancement Design

**Date:** 2026-03-15
**Status:** Approved
**Approach:** Enhance existing V2 templates with V1's content patterns + Chart.js + HTMX auto-refresh

## Overview

Port the rich dashboard experience from V1 (seller stats, agent pipeline, admin analytics) into V2's existing Nunjucks + HTMX + Tailwind architecture. Three dashboards: seller, agent, admin.

## 1. Brand Colors & Tailwind Config

Add V1's color scheme to `tailwind.config.ts`:

| Token        | Hex       | Usage                              |
|-------------|-----------|--------------------------------------|
| `ink`        | `#1a1a2e` | Dark navy — text, agent/admin sidebars |
| `accent`     | `#c8553d` | Rust — primary buttons, CTAs         |
| `accent-dark`| `#a8432f` | Darker rust — hover states           |
| `bg`         | `#fafaf7` | Off-white — page backgrounds         |
| `bg-alt`     | `#f0efe9` | Slightly darker — card backgrounds   |

Add Tailwind component classes in `input.css`:
- `.btn-primary` — accent bg, white text, hover accent-dark
- `.btn-secondary` — ink bg, white text, hover ink-light
- `.btn-outline` — border variant with accent text
- `.input-field` — form inputs with focus ring
- `.card` — white rounded container with border and shadow

Update layouts to use brand colors:
- `bg-gray-50` → `bg-bg`
- `bg-gray-900` → `bg-ink` (agent/admin sidebars)
- `text-blue-600` → `text-accent` (primary links/buttons)

## 2. Seller Dashboard

**File:** `src/views/pages/seller/dashboard.njk` (enhance existing)
**Partial:** `src/views/partials/seller/dashboard-overview.njk` (enhance existing)
**New partial:** `src/views/partials/seller/dashboard-stats.njk` (auto-refresh target)

### Sections (top to bottom):

1. **Case Flag Alert** (conditional)
   - Yellow warning banner when `overview.caseFlags.length > 0`
   - Links to `/seller/case-flags`

2. **Transaction Status Card** (enhance existing)
   - Property details: block, street, town, flat type, floor area (sqm)
   - Asking price displayed prominently
   - Color-coded status badge
   - "Start Onboarding" button if no property exists

3. **Quick Stats Grid** (new, 3-column)
   - Upcoming Viewings (count)
   - Total Viewings (count)
   - Unread Notifications (count)
   - Auto-refresh: `hx-get="/seller/dashboard/stats" hx-trigger="load, every 30s"`

4. **Transaction Quick Links** (new, conditional)
   - Shown when status is `offer_received`, `under_option`, or `completed`
   - "View received offers" → `/seller/offers`
   - "View transaction status" → `/seller/transaction`

5. **Next Steps Checklist** (enhance existing)
   - Numbered badges: green checkmark for completed, gray number for pending
   - Steps: Complete onboarding → Upload photos → Agent reviews listing → Schedule viewings

6. **Notifications Preview** (keep existing)

7. **Timeline Sidebar** (keep existing)

### Data Requirements

`sellerService.getDashboardOverview()` enhanced to return:
- `caseFlags: CaseFlag[]` — unresolved case flags
- `upcomingViewings: number` — count of scheduled viewings
- `totalViewings: number` — total viewings count
- Existing fields: seller, propertyStatus, nextSteps, unreadNotificationCount

New endpoint: `GET /seller/dashboard/stats` — returns stats partial only (for HTMX auto-refresh).

## 3. Agent Dashboard (Pipeline)

**File:** `src/views/pages/agent/dashboard.njk` (replace minimal placeholder)
**New partial:** `src/views/partials/agent/pipeline-overview.njk` (HTMX target)

### Sections:

1. **Pipeline Overview Cards** (5-column grid, responsive 2-col on mobile)
   - `lead` — blue top border
   - `engaged` — yellow top border
   - `active` — green top border
   - `completed` — purple top border
   - `archived` — gray top border
   - Each card: stage name, count, total property value
   - Auto-refresh: `hx-trigger="load, every 30s"`

2. **Detailed Pipeline Tables** (one per non-empty stage)
   - Section header: stage name + count
   - Columns: Name | Phone | Asking Price | Status | Actions
   - "View" link → `/agent/sellers/{id}`
   - Hover effect on rows
   - Manual refresh only (tables too heavy for auto-refresh)

3. **Lead Queue Summary** (conditional)
   - Callout card when unassigned leads exist
   - "X new leads awaiting assignment" → links to `/agent/leads`

### Data Requirements

`agentService.getPipelineOverview()` enhanced to return:
```typescript
{
  stages: {
    [stageName: string]: {
      count: number;
      totalValue: number;
      sellers: Array<{
        id: string;
        name: string;
        phone: string;
        askingPrice: number;
        status: string;
      }>;
    };
  };
  unassignedLeadCount: number;
}
```

### Layout Update

Agent sidebar: `bg-gray-900` → `bg-ink`. Active link highlight uses accent color.

## 4. Admin Dashboard (Analytics)

**File:** `src/views/pages/admin/dashboard.njk` (replace team-list-only version)
**New partial:** `src/views/partials/admin/analytics.njk` (HTMX target)
**Team list:** Moves to `/admin/team` page (route already exists)

### Chart.js Integration

- Load via CDN in admin layout `{% block head %}`
- Charts in `<canvas>` elements
- Data passed as JSON in `<script nonce="{{ cspNonce }}">` blocks
- Charts auto-update when HTMX refreshes analytics partial

### Sections:

1. **Date Filter** — date range picker (dateFrom/dateTo), submits via HTMX

2. **Revenue Cards** (4-column grid, auto-refresh every 30s)
   - Total Revenue ($) + completed count
   - Pipeline Value ($) + active transaction count
   - Per-Transaction Revenue ($1,633.91)
   - Pending Invoices (count)

3. **Transaction Funnel** — Chart.js horizontal bar chart
   - Stages: lead → engaged → active → option_exercised → completed
   - Text-only fallback grid for no-JS

4. **Time to Close** — Average days stat + Chart.js bar chart by flat type
   - Breakdown: 2-room, 3-room, 4-room, 5-room, executive

5. **Lead Sources** — Chart.js doughnut chart + table
   - Source name, total leads, conversion rate %

6. **Viewings Analytics** (4 stats cards)
   - Total viewings, Completed, No-show rate %, Cancellation rate %

7. **Referral Funnel** (5-column stats grid)
   - Links Generated → Clicks → Leads Created → Completed → Conversion Rate
   - Top referrers table

### Data Requirements

New `adminService.getAnalytics(dateFrom?, dateTo?)` method:
```typescript
{
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
```

## 5. Mobile Responsiveness

All three layouts currently lack mobile support. Add:

- **Hamburger menu button**: visible on `md:hidden`
- **Sidebar**: hidden by default on mobile, slides in as overlay on toggle
- **Toggle**: vanilla JS with CSP nonce
- **Close**: on outside click or navigation

## 6. Shared Patterns

- **Status badge macro**: `partials/status-badge.njk` — consistent color mapping across dashboards
- **Currency formatting**: `$X,XXX.XX` format
- **Date formatting**: relative ("2d 3h ago") for recent items, absolute for older
- **Auto-refresh strategy**:
  - Stats cards: `hx-trigger="load, every 30s"` with lightweight dedicated endpoints
  - Pipeline tables: manual refresh only
  - Charts: refresh with stats via HTMX swap + `Chart.update()`

## Dependencies

- **Chart.js**: loaded via CDN (admin dashboard only), ~60KB gzipped
- No other new dependencies

## Files to Create/Modify

### New files:
- `src/views/partials/seller/dashboard-stats.njk`
- `src/views/partials/agent/pipeline-overview.njk`
- `src/views/partials/admin/analytics.njk`
- `src/views/partials/status-badge.njk`

### Modified files:
- `tailwind.config.ts` — brand colors
- `src/views/styles/input.css` — component classes
- `src/views/layouts/base.njk` — mobile menu JS
- `src/views/layouts/seller.njk` — brand colors + mobile hamburger
- `src/views/layouts/agent.njk` — brand colors + mobile hamburger
- `src/views/layouts/admin.njk` — brand colors + mobile hamburger + Chart.js CDN
- `src/views/pages/seller/dashboard.njk` — enhanced content
- `src/views/partials/seller/dashboard-overview.njk` — enhanced status card + next steps
- `src/views/pages/agent/dashboard.njk` — pipeline layout
- `src/views/pages/admin/dashboard.njk` — analytics layout
- Domain service files (seller, agent, admin) — enhanced data methods
- Domain router files — new stats/analytics endpoints
