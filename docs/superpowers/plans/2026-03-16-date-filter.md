# Date Filter Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stub `| date` Nunjucks filter with a real implementation using native `Intl.DateTimeFormat`, hardcoded to Asia/Singapore (SGT, UTC+8).

**Architecture:** Extract a pure `dateFilter(value, format?)` function to `src/infra/http/filters/date.filter.ts`, unit-test it in isolation, then wire it into `app.ts` replacing the existing stub. No template changes needed — all existing `| date(...)` calls already use the correct format strings.

**Tech Stack:** TypeScript, native `Intl.DateTimeFormat`, Jest

---

## Chunk 1: Implement and test the filter

### Task 1: Write failing tests for `dateFilter`

**Files:**
- Create: `src/infra/http/filters/__tests__/date.filter.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// src/infra/http/filters/__tests__/date.filter.test.ts
import { dateFilter } from '../date.filter';

// Pin a known UTC timestamp: 2026-03-14T01:30:00.000Z = 14 Mar 2026 09:30 SGT
const UTC_TS = '2026-03-14T01:30:00.000Z';
const UTC_DATE = new Date(UTC_TS);

describe('dateFilter', () => {
  describe('null / undefined / empty', () => {
    it('returns empty string for null', () => {
      expect(dateFilter(null)).toBe('');
    });
    it('returns empty string for undefined', () => {
      expect(dateFilter(undefined)).toBe('');
    });
    it('returns empty string for empty string', () => {
      expect(dateFilter('')).toBe('');
    });
  });

  describe('now (copyright year)', () => {
    it('returns current year string for "now"', () => {
      const year = new Date().getFullYear().toString();
      expect(dateFilter('now')).toBe(year);
      expect(dateFilter('now', 'YYYY')).toBe(year);
    });
  });

  describe('default format (no arg) → DD MMM YYYY HH:mm SGT', () => {
    it('formats ISO string as "14 Mar 2026 09:30"', () => {
      expect(dateFilter(UTC_TS)).toBe('14 Mar 2026 09:30');
    });
    it('formats Date object', () => {
      expect(dateFilter(UTC_DATE)).toBe('14 Mar 2026 09:30');
    });
    it('normalises midnight — does not render as "24:00"', () => {
      // 2026-03-13T16:00:00.000Z = 14 Mar 2026 00:00 SGT
      expect(dateFilter('2026-03-13T16:00:00.000Z')).toBe('14 Mar 2026 00:00');
    });
  });

  describe('DD MMM YYYY (date-only)', () => {
    it('formats as "14 Mar 2026"', () => {
      expect(dateFilter(UTC_TS, 'DD MMM YYYY')).toBe('14 Mar 2026');
    });
    it('D MMM YYYY also formats as "14 Mar 2026"', () => {
      expect(dateFilter(UTC_TS, 'D MMM YYYY')).toBe('14 Mar 2026');
    });
  });

  describe('D MMM YYYY HH:mm (explicit datetime)', () => {
    it('formats as "14 Mar 2026 09:30"', () => {
      expect(dateFilter(UTC_TS, 'D MMM YYYY HH:mm')).toBe('14 Mar 2026 09:30');
    });
  });

  describe('YYYY (year only)', () => {
    it('returns "2026"', () => {
      expect(dateFilter(UTC_TS, 'YYYY')).toBe('2026');
    });
  });

  describe('short (Mon YYYY)', () => {
    it('formats as "Mar 2026"', () => {
      expect(dateFilter(UTC_TS, 'short')).toBe('Mar 2026');
    });
  });

  describe('relative', () => {
    it('returns "just now" for < 1 minute ago', () => {
      const recent = new Date(Date.now() - 30_000);
      expect(dateFilter(recent, 'relative')).toBe('just now');
    });
    it('returns "X minutes ago" for < 1 hour ago', () => {
      const ago = new Date(Date.now() - 5 * 60_000);
      expect(dateFilter(ago, 'relative')).toBe('5 minutes ago');
    });
    it('returns "1 hour ago" for ~1 hour ago', () => {
      const ago = new Date(Date.now() - 70 * 60_000);
      expect(dateFilter(ago, 'relative')).toBe('1 hour ago');
    });
    it('returns "X hours ago" for < 24 hours ago', () => {
      const ago = new Date(Date.now() - 3 * 3600_000);
      expect(dateFilter(ago, 'relative')).toBe('3 hours ago');
    });
    it('returns "1 day ago" for ~1 day ago', () => {
      const ago = new Date(Date.now() - 25 * 3600_000);
      expect(dateFilter(ago, 'relative')).toBe('1 day ago');
    });
    it('returns "X days ago" for < 30 days ago', () => {
      const ago = new Date(Date.now() - 5 * 86400_000);
      expect(dateFilter(ago, 'relative')).toBe('5 days ago');
    });
    it('falls back to default format for old dates', () => {
      // 40 days ago — should fall back to DD MMM YYYY HH:mm
      const old = new Date(Date.now() - 40 * 86400_000);
      const result = dateFilter(old, 'relative');
      // Just check it looks like a date, not "X days ago"
      expect(result).toMatch(/\d{1,2} \w{3} \d{4} \d{2}:\d{2}/);
    });
  });

  describe('invalid input', () => {
    it('returns empty string for invalid date string', () => {
      expect(dateFilter('not-a-date')).toBe('');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/infra/http/filters/__tests__/date.filter.test.ts --no-coverage
```

Expected: all tests fail with `Cannot find module '../date.filter'`

---

### Task 2: Implement `dateFilter`

**Files:**
- Create: `src/infra/http/filters/date.filter.ts`

- [ ] **Step 1: Create the filter**

```typescript
// src/infra/http/filters/date.filter.ts

const TZ = 'Asia/Singapore';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value as string | number);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function parts(d: Date) {
  // Extract date/time parts in SGT using Intl
  const fmt = new Intl.DateTimeFormat('en-SG', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map(({ type, value }) => [type, value]));
  return {
    day: parseInt(p.day, 10),
    month: parseInt(p.month, 10) - 1, // 0-indexed
    year: p.year,
    hour: p.hour === '24' ? '00' : p.hour,
    minute: p.minute,
  };
}

function formatDefault(d: Date): string {
  const { day, month, year, hour, minute } = parts(d);
  return `${day} ${MONTHS[month]} ${year} ${hour}:${minute}`;
}

function formatDateOnly(d: Date): string {
  const { day, month, year } = parts(d);
  return `${day} ${MONTHS[month]} ${year}`;
}

function formatShort(d: Date): string {
  const { month, year } = parts(d);
  return `${MONTHS[month]} ${year}`;
}

function formatYear(d: Date): string {
  return parts(d).year;
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  return formatDefault(d);
}

export function dateFilter(value: unknown, format?: string): string {
  // Special case: copyright year
  if (value === 'now') return new Date().getFullYear().toString();

  const d = toDate(value);
  if (!d) return '';

  switch (format) {
    case 'DD MMM YYYY':
    case 'D MMM YYYY':
      return formatDateOnly(d);
    case 'D MMM YYYY HH:mm':
    case 'DD MMM YYYY HH:mm':
      return formatDefault(d);
    case 'YYYY':
      return formatYear(d);
    case 'short':
      return formatShort(d);
    case 'relative':
      return formatRelative(d);
    default:
      return formatDefault(d);
  }
}
```

- [ ] **Step 2: Run tests**

```bash
npx jest src/infra/http/filters/__tests__/date.filter.test.ts --no-coverage
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/infra/http/filters/date.filter.ts src/infra/http/filters/__tests__/date.filter.test.ts
git commit -m "feat: implement date filter with SGT timezone and all format modes"
```

---

### Task 3: Wire the filter into `app.ts`

**Files:**
- Modify: `src/infra/http/app.ts`

- [ ] **Step 1: Replace the stub**

In `src/infra/http/app.ts`, add the import at the top of the file (with other imports):

```typescript
import { dateFilter } from './filters/date.filter';
```

Replace:

```typescript
  // Add date filter for templates
  env.addFilter('date', (str: string, _format: string) => {
    if (str === 'now') return new Date().getFullYear().toString();
    return str;
  });
```

With:

```typescript
  // Add date filter for templates (SGT, native Intl.DateTimeFormat)
  env.addFilter('date', dateFilter);
```

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: all tests pass. Tests in router files that mock `date` as `(d) => String(d)` are unaffected — they mock the filter entirely, so the implementation doesn't matter for those.

- [ ] **Step 3: Commit**

```bash
git add src/infra/http/app.ts
git commit -m "feat: wire dateFilter into Nunjucks env, replacing stub"
```

---

### Task 4: Smoke-test in the browser

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Check table date rendering**

Navigate to `/admin/leads` (or any table that previously showed raw ISO strings). Confirm dates now render as e.g. `14 Mar 2026 09:30` instead of `2026-03-14T01:30:00.000Z`.

- [ ] **Step 3: Check footer copyright year**

Visit any page. Confirm the footer shows the current year (e.g. `© 2026 SellMyHomeNow.sg`).

- [ ] **Step 4: Check date-only fields**

Visit a page using `| date("DD MMM YYYY")` (e.g. seller my-data page `/seller/my-data`). Confirm it renders `14 Mar 2026` without a time component.
