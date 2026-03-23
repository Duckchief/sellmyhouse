# Viewing Calendar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the native date picker in the single slot tab with a monthly calendar (60%) + sidebar (40%) layout that shows slot indicators, existing slots summary, and smart time pre-fill.

**Architecture:** Client-side vanilla JS calendar for instant month navigation. HTMX fetches for sidebar content (existing slots + form) and month metadata. Two new GET routes on the viewing router. No external dependencies.

**Tech Stack:** Vanilla JS, Nunjucks partials, HTMX, Tailwind CSS, existing Express/Prisma stack.

**Design doc:** `docs/plans/2026-03-23-viewing-calendar-design.md`

---

### Task 1: Add Repository Method — `findSlotsByPropertyAndMonth`

**Files:**
- Modify: `src/domains/viewing/viewing.repository.ts:42-55`
- Test: `src/domains/viewing/__tests__/viewing.repository.test.ts`

**Step 1: Write the failing test**

Add to the repository test file, in the existing describe block:

```typescript
describe('findSlotsByPropertyAndMonth', () => {
  it('returns slots for the given month', async () => {
    const result = await viewingRepo.findSlotsByPropertyAndMonth('prop-1', 2026, 3);
    expect(prismaMock.viewingSlot.findMany).toHaveBeenCalledWith({
      where: {
        propertyId: 'prop-1',
        date: {
          gte: new Date('2026-03-01T00:00:00.000Z'),
          lt: new Date('2026-04-01T00:00:00.000Z'),
        },
      },
      include: { viewings: { where: { status: { not: 'cancelled' } } } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=viewing.repository.test`
Expected: FAIL — `findSlotsByPropertyAndMonth is not a function`

**Step 3: Write minimal implementation**

Add after line 55 in `viewing.repository.ts`:

```typescript
export async function findSlotsByPropertyAndMonth(
  propertyId: string,
  year: number,
  month: number, // 1-12
) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return prisma.viewingSlot.findMany({
    where: {
      propertyId,
      date: { gte: start, lt: end },
    },
    include: { viewings: { where: { status: { not: 'cancelled' } } } },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=viewing.repository.test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/viewing/viewing.repository.ts src/domains/viewing/__tests__/viewing.repository.test.ts
git commit -m "feat(viewing): add findSlotsByPropertyAndMonth repository method"
```

---

### Task 2: Add Service Methods — `getSlotsForDate` and `getMonthSlotMeta`

**Files:**
- Modify: `src/domains/viewing/viewing.service.ts:760-769`
- Test: `src/domains/viewing/__tests__/viewing.service.test.ts`

**Step 1: Write the failing tests**

Add to the service test file:

```typescript
describe('getSlotsForDate', () => {
  it('returns slots for a specific date with next available gap', async () => {
    mockedRepo.findPropertyById.mockResolvedValue({ id: 'prop-1', sellerId: 'seller-1' } as never);
    mockedRepo.findSlotsByPropertyAndDateRange.mockResolvedValue([
      {
        id: 's1',
        startTime: '10:00',
        endTime: '11:00',
        slotType: 'single',
        maxViewers: 1,
        currentBookings: 1,
        status: 'booked',
        viewings: [{ status: 'scheduled' }],
      },
      {
        id: 's2',
        startTime: '14:00',
        endTime: '15:00',
        slotType: 'group',
        maxViewers: 5,
        currentBookings: 2,
        status: 'booked',
        viewings: [{ status: 'scheduled' }, { status: 'scheduled' }],
      },
    ] as never);

    const result = await viewingService.getSlotsForDate('prop-1', '2026-03-17', 'seller-1');

    expect(result.slots).toHaveLength(2);
    expect(result.suggestedStart).toBe('11:00');
    expect(result.suggestedEnd).toBe('12:00');
  });

  it('suggests 10:00-11:00 when no slots exist', async () => {
    mockedRepo.findPropertyById.mockResolvedValue({ id: 'prop-1', sellerId: 'seller-1' } as never);
    mockedRepo.findSlotsByPropertyAndDateRange.mockResolvedValue([] as never);

    const result = await viewingService.getSlotsForDate('prop-1', '2026-03-17', 'seller-1');

    expect(result.slots).toHaveLength(0);
    expect(result.suggestedStart).toBe('10:00');
    expect(result.suggestedEnd).toBe('11:00');
  });

  it('finds gap between non-adjacent slots', async () => {
    mockedRepo.findPropertyById.mockResolvedValue({ id: 'prop-1', sellerId: 'seller-1' } as never);
    mockedRepo.findSlotsByPropertyAndDateRange.mockResolvedValue([
      { id: 's1', startTime: '10:00', endTime: '11:00', slotType: 'single', maxViewers: 1, currentBookings: 0, status: 'available', viewings: [] },
      { id: 's2', startTime: '13:00', endTime: '14:00', slotType: 'single', maxViewers: 1, currentBookings: 0, status: 'available', viewings: [] },
    ] as never);

    const result = await viewingService.getSlotsForDate('prop-1', '2026-03-17', 'seller-1');

    expect(result.suggestedStart).toBe('11:00');
    expect(result.suggestedEnd).toBe('12:00');
  });
});

describe('getMonthSlotMeta', () => {
  it('returns slot metadata grouped by date', async () => {
    mockedRepo.findPropertyById.mockResolvedValue({ id: 'prop-1', sellerId: 'seller-1' } as never);
    mockedRepo.findSlotsByPropertyAndMonth.mockResolvedValue([
      { id: 's1', date: new Date('2026-03-17'), status: 'available', slotType: 'single', maxViewers: 1, currentBookings: 0, viewings: [] },
      { id: 's2', date: new Date('2026-03-17'), status: 'full', slotType: 'single', maxViewers: 1, currentBookings: 1, viewings: [{ status: 'scheduled' }] },
      { id: 's3', date: new Date('2026-03-20'), status: 'available', slotType: 'group', maxViewers: 5, currentBookings: 2, viewings: [] },
    ] as never);

    const result = await viewingService.getMonthSlotMeta('prop-1', 2026, 3, 'seller-1');

    expect(result['2026-03-17']).toEqual({ available: 1, full: 1 });
    expect(result['2026-03-20']).toEqual({ available: 1, full: 0 });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=viewing.service.test`
Expected: FAIL — methods not defined

**Step 3: Write implementation**

Add after `getSellerDashboard` in `viewing.service.ts`:

```typescript
export async function getSlotsForDate(propertyId: string, dateStr: string, sellerId: string) {
  await verifyPropertyOwnership(propertyId, sellerId);
  const date = new Date(dateStr);
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);

  const slots = await viewingRepo.findSlotsByPropertyAndDateRange(propertyId, date, date);

  const suggestedTimes = findNextAvailableGap(slots);

  return {
    slots: slots.map((s) => ({
      id: s.id,
      startTime: s.startTime,
      endTime: s.endTime,
      slotType: s.slotType,
      maxViewers: s.maxViewers,
      currentBookings: s.currentBookings,
      status: s.status,
    })),
    suggestedStart: suggestedTimes.start,
    suggestedEnd: suggestedTimes.end,
    date: dateStr,
  };
}

export async function getMonthSlotMeta(
  propertyId: string,
  year: number,
  month: number,
  sellerId: string,
): Promise<Record<string, { available: number; full: number }>> {
  await verifyPropertyOwnership(propertyId, sellerId);
  const slots = await viewingRepo.findSlotsByPropertyAndMonth(propertyId, year, month);

  const meta: Record<string, { available: number; full: number }> = {};
  for (const slot of slots) {
    const dateKey = slot.date.toISOString().split('T')[0];
    if (!meta[dateKey]) meta[dateKey] = { available: 0, full: 0 };
    if (slot.status === 'full' || (slot.slotType === 'single' && slot.currentBookings >= 1)) {
      meta[dateKey].full++;
    } else {
      meta[dateKey].available++;
    }
  }
  return meta;
}

function findNextAvailableGap(slots: { startTime: string; endTime: string }[]): {
  start: string;
  end: string;
} {
  if (slots.length === 0) return { start: '10:00', end: '11:00' };

  const sorted = [...slots].sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Try gap after each slot
  for (let i = 0; i < sorted.length; i++) {
    const gapStart = sorted[i].endTime;
    const gapEnd = addMinutes(gapStart, 60);
    const nextSlotStart = sorted[i + 1]?.startTime ?? '23:59';

    if (gapEnd <= nextSlotStart && gapEnd <= '22:00') {
      return { start: gapStart, end: gapEnd };
    }
  }

  // Try gap before first slot
  const firstStart = sorted[0].startTime;
  if (firstStart >= '11:00') {
    const beforeEnd = firstStart;
    const beforeStart = subtractMinutes(beforeEnd, 60);
    if (beforeStart >= '08:00') return { start: beforeStart, end: beforeEnd };
  }

  // Fallback: after last slot
  const lastEnd = sorted[sorted.length - 1].endTime;
  return { start: lastEnd, end: addMinutes(lastEnd, 60) };
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function subtractMinutes(time: string, minutes: number): string {
  return addMinutes(time, -minutes);
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=viewing.service.test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/viewing/viewing.service.ts src/domains/viewing/__tests__/viewing.service.test.ts
git commit -m "feat(viewing): add getSlotsForDate and getMonthSlotMeta service methods"
```

---

### Task 3: Add Router Routes — `date-sidebar` and `month-meta`

**Files:**
- Modify: `src/domains/viewing/viewing.router.ts:29-57`
- Test: `src/domains/viewing/__tests__/viewing.router.test.ts`

**Step 1: Write the failing tests**

Add to the router test file:

```typescript
describe('GET /seller/viewings/slots/date-sidebar', () => {
  it('returns 200 with sidebar data', async () => {
    mockService.getSlotsForDate.mockResolvedValue({
      slots: [],
      suggestedStart: '10:00',
      suggestedEnd: '11:00',
      date: '2026-03-17',
    });

    const res = await request(app)
      .get('/seller/viewings/slots/date-sidebar?date=2026-03-17&propertyId=prop-1')
      .set('hx-request', 'true');

    expect(res.status).toBe(200);
    expect(mockService.getSlotsForDate).toHaveBeenCalledWith('prop-1', '2026-03-17', 'seller-1');
  });

  it('returns 400 when date is missing', async () => {
    const res = await request(app)
      .get('/seller/viewings/slots/date-sidebar?propertyId=prop-1');

    expect(res.status).toBe(400);
  });

  it('returns 400 when propertyId is missing', async () => {
    const res = await request(app)
      .get('/seller/viewings/slots/date-sidebar?date=2026-03-17');

    expect(res.status).toBe(400);
  });
});

describe('GET /seller/viewings/slots/month-meta', () => {
  it('returns JSON slot metadata for a month', async () => {
    mockService.getMonthSlotMeta.mockResolvedValue({
      '2026-03-17': { available: 2, full: 1 },
    });

    const res = await request(app)
      .get('/seller/viewings/slots/month-meta?month=2026-03&propertyId=prop-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ '2026-03-17': { available: 2, full: 1 } });
    expect(mockService.getMonthSlotMeta).toHaveBeenCalledWith('prop-1', 2026, 3, 'seller-1');
  });

  it('returns 400 when month format is invalid', async () => {
    const res = await request(app)
      .get('/seller/viewings/slots/month-meta?month=invalid&propertyId=prop-1');

    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=viewing.router.test`
Expected: FAIL — 404 not found

**Step 3: Write implementation**

Add the two routes in `viewing.router.ts` **before** the `POST /seller/viewings/slots` route (after line 57):

```typescript
viewingRouter.get(
  '/seller/viewings/slots/date-sidebar',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const date = req.query.date as string;
      const propertyId = req.query.propertyId as string;

      if (!date || !propertyId) {
        return res.status(400).json({ error: 'date and propertyId are required' });
      }

      const data = await viewingService.getSlotsForDate(propertyId, date, user.id);
      return res.render('partials/seller/viewing-date-sidebar', data);
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.get(
  '/seller/viewings/slots/month-meta',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const monthStr = req.query.month as string;
      const propertyId = req.query.propertyId as string;

      if (!propertyId || !monthStr) {
        return res.status(400).json({ error: 'month and propertyId are required' });
      }

      const match = monthStr.match(/^(\d{4})-(\d{2})$/);
      if (!match) {
        return res.status(400).json({ error: 'month must be YYYY-MM format' });
      }

      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const meta = await viewingService.getMonthSlotMeta(propertyId, year, month, user.id);
      return res.json(meta);
    } catch (err) {
      next(err);
    }
  },
);
```

**Important:** These routes must come **before** the generic `POST /seller/viewings/slots` route. Express matches routes in order, and `/seller/viewings/slots/date-sidebar` must not be caught by a parameterized route.

**Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=viewing.router.test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/viewing/viewing.router.ts src/domains/viewing/__tests__/viewing.router.test.ts
git commit -m "feat(viewing): add date-sidebar and month-meta routes"
```

---

### Task 4: Create the Date Sidebar Partial

**Files:**
- Create: `src/views/partials/seller/viewing-date-sidebar.njk`

**Step 1: Create the partial**

```njk
{#
  Variables (from getSlotsForDate):
    date: string (YYYY-MM-DD)
    slots: { id, startTime, endTime, slotType, maxViewers, currentBookings, status }[]
    suggestedStart: string (HH:MM)
    suggestedEnd: string (HH:MM)
    propertyId: string (from query param, forwarded by router)
#}

<div class="p-4">
  {# Date heading #}
  <h3 class="text-sm font-semibold text-gray-900 mb-3">{{ date }}</h3>

  {# Existing slots summary #}
  {% if slots.length > 0 %}
  <div class="mb-4">
    <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{{ "Existing Slots" | t }}</p>
    <div class="space-y-1.5">
      {% for slot in slots %}
      <div class="flex items-center justify-between text-xs bg-gray-50 rounded px-2.5 py-1.5">
        <span class="font-medium text-gray-700">{{ slot.startTime }}–{{ slot.endTime }}</span>
        <span class="text-gray-500">{{ slot.slotType | capitalize }}</span>
        {% if slot.status == 'full' or (slot.slotType == 'single' and slot.currentBookings >= 1) %}
          <span class="w-2 h-2 rounded-full bg-red-500" title="{{ 'Full' | t }}"></span>
        {% else %}
          <span class="w-2 h-2 rounded-full bg-green-500" title="{{ 'Available' | t }}"></span>
        {% endif %}
      </div>
      {% endfor %}
    </div>
  </div>
  {% endif %}

  {# Add new slot form #}
  <div class="border-t border-gray-200 pt-3">
    <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{{ "Add New Slot" | t }}</p>
    <form
      hx-post="/seller/viewings/slots"
      hx-target="#slots-list"
      hx-swap="beforeend"
      data-reset-on-success
      class="space-y-3"
    >
      <input type="hidden" name="propertyId" value="{{ propertyId }}">
      <input type="hidden" name="date" value="{{ date }}">

      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">{{ "Start" | t }}</label>
        <input type="time" name="startTime" value="{{ suggestedStart }}" required
               class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">{{ "End" | t }}</label>
        <input type="time" name="endTime" value="{{ suggestedEnd }}" required
               class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">{{ "Type" | t }}</label>
        <select name="slotType"
                class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="single">{{ "Single viewer" | t }}</option>
          <option value="group">{{ "Group viewing" | t }}</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">{{ "Max viewers (group only)" | t }}</label>
        <input type="number" name="maxViewers" min="2" max="20" placeholder="2"
               class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
      </div>
      <button type="submit"
              class="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition">
        {{ "Add Slot" | t }}
      </button>
    </form>
  </div>
</div>
```

**Step 2: Also update the router to forward `propertyId` to the template**

In the `date-sidebar` route handler, change the render call:

```typescript
return res.render('partials/seller/viewing-date-sidebar', { ...data, propertyId });
```

**Step 3: Commit**

```bash
git add src/views/partials/seller/viewing-date-sidebar.njk src/domains/viewing/viewing.router.ts
git commit -m "feat(viewing): create date sidebar partial with slot summary and add form"
```

---

### Task 5: Create the ViewingCalendar JS Module

**Files:**
- Create: `public/js/viewing-calendar.js`

**Step 1: Create the file**

```javascript
/* global htmx */

/**
 * ViewingCalendar — renders a monthly calendar grid with slot indicators.
 *
 * Usage:
 *   <div id="viewing-calendar"
 *        data-property-id="uuid"
 *        data-slots-by-date='{"2026-03-17":{"available":1,"full":2}}'
 *        data-sidebar-target="#date-sidebar"
 *   ></div>
 *
 *   new ViewingCalendar(document.getElementById('viewing-calendar'));
 */
(function () {
  'use strict';

  var DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  var MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  function ViewingCalendar(el) {
    this.el = el;
    this.propertyId = el.dataset.propertyId;
    this.sidebarTarget = el.dataset.sidebarTarget;
    this.slotsByDate = {};
    this.selectedDate = null;

    try {
      this.slotsByDate = JSON.parse(el.dataset.slotsByDate || '{}');
    } catch (_) {
      this.slotsByDate = {};
    }

    var now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth(); // 0-indexed

    this.render();
  }

  ViewingCalendar.prototype.render = function () {
    this.el.innerHTML = '';
    this.el.appendChild(this.buildHeader());
    this.el.appendChild(this.buildDayLabels());
    this.el.appendChild(this.buildGrid());
  };

  ViewingCalendar.prototype.buildHeader = function () {
    var self = this;
    var header = document.createElement('div');
    header.className = 'flex items-center justify-between mb-3';

    var prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'p-1.5 rounded hover:bg-gray-100 text-gray-600';
    prevBtn.innerHTML = '&#9664;';
    prevBtn.setAttribute('aria-label', 'Previous month');
    prevBtn.addEventListener('click', function () { self.changeMonth(-1); });

    var title = document.createElement('span');
    title.className = 'text-sm font-semibold text-gray-900';
    title.textContent = MONTHS[this.month] + ' ' + this.year;

    var todayBtn = document.createElement('button');
    todayBtn.type = 'button';
    todayBtn.className = 'px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50';
    todayBtn.textContent = 'Today';
    todayBtn.addEventListener('click', function () { self.goToToday(); });

    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'p-1.5 rounded hover:bg-gray-100 text-gray-600';
    nextBtn.innerHTML = '&#9654;';
    nextBtn.setAttribute('aria-label', 'Next month');
    nextBtn.addEventListener('click', function () { self.changeMonth(1); });

    var navLeft = document.createElement('div');
    navLeft.className = 'flex items-center gap-1';
    navLeft.appendChild(prevBtn);
    navLeft.appendChild(title);
    navLeft.appendChild(nextBtn);

    header.appendChild(navLeft);
    header.appendChild(todayBtn);

    return header;
  };

  ViewingCalendar.prototype.buildDayLabels = function () {
    var row = document.createElement('div');
    row.className = 'grid grid-cols-7 mb-1';
    for (var i = 0; i < 7; i++) {
      var cell = document.createElement('div');
      cell.className = 'text-center text-xs font-medium text-gray-400 py-1';
      cell.textContent = DAYS[i];
      row.appendChild(cell);
    }
    return row;
  };

  ViewingCalendar.prototype.buildGrid = function () {
    var self = this;
    var grid = document.createElement('div');
    grid.className = 'grid grid-cols-7';

    var firstDay = new Date(this.year, this.month, 1).getDay();
    var daysInMonth = new Date(this.year, this.month + 1, 0).getDate();
    var today = new Date();
    var todayStr = formatDate(today);

    // Empty cells before first day
    for (var e = 0; e < firstDay; e++) {
      var empty = document.createElement('div');
      empty.className = 'p-1';
      grid.appendChild(empty);
    }

    for (var d = 1; d <= daysInMonth; d++) {
      var dateObj = new Date(this.year, this.month, d);
      var dateStr = formatDate(dateObj);
      var isPast = dateObj < new Date(today.getFullYear(), today.getMonth(), today.getDate());
      var isToday = dateStr === todayStr;
      var isSelected = dateStr === this.selectedDate;
      var meta = this.slotsByDate[dateStr];

      var cell = document.createElement('button');
      cell.type = 'button';
      cell.dataset.date = dateStr;
      cell.className = 'relative flex flex-col items-center justify-center p-1.5 rounded-lg text-sm transition '
        + (isPast ? 'text-gray-300 ' : 'text-gray-700 hover:bg-blue-50 cursor-pointer ')
        + (isToday ? 'font-bold ' : '')
        + (isSelected ? 'ring-2 ring-blue-500 bg-blue-50 ' : '');

      var dayNum = document.createElement('span');
      dayNum.textContent = d;
      cell.appendChild(dayNum);

      // Dot indicators
      if (meta) {
        var dots = document.createElement('div');
        dots.className = 'flex gap-0.5 mt-0.5';
        if (meta.available > 0) {
          var greenDot = document.createElement('span');
          greenDot.className = 'w-1.5 h-1.5 rounded-full bg-green-500';
          dots.appendChild(greenDot);
        }
        if (meta.full > 0) {
          var redDot = document.createElement('span');
          redDot.className = 'w-1.5 h-1.5 rounded-full bg-red-500';
          dots.appendChild(redDot);
        }
        cell.appendChild(dots);
      }

      cell.addEventListener('click', function () {
        self.selectDate(this.dataset.date);
      });

      grid.appendChild(cell);
    }

    return grid;
  };

  ViewingCalendar.prototype.selectDate = function (dateStr) {
    this.selectedDate = dateStr;
    this.render();

    // Trigger HTMX fetch for sidebar
    var sidebar = document.querySelector(this.sidebarTarget);
    if (sidebar && typeof htmx !== 'undefined') {
      htmx.ajax('GET',
        '/seller/viewings/slots/date-sidebar?date=' + encodeURIComponent(dateStr)
        + '&propertyId=' + encodeURIComponent(this.propertyId),
        { target: this.sidebarTarget, swap: 'innerHTML' }
      );
    }
  };

  ViewingCalendar.prototype.changeMonth = function (delta) {
    this.month += delta;
    if (this.month > 11) { this.month = 0; this.year++; }
    if (this.month < 0) { this.month = 11; this.year--; }
    this.fetchMonthMeta();
    this.render();
  };

  ViewingCalendar.prototype.goToToday = function () {
    var now = new Date();
    var changed = this.year !== now.getFullYear() || this.month !== now.getMonth();
    this.year = now.getFullYear();
    this.month = now.getMonth();
    if (changed) this.fetchMonthMeta();
    this.render();
  };

  ViewingCalendar.prototype.fetchMonthMeta = function () {
    var self = this;
    var monthStr = this.year + '-' + String(this.month + 1).padStart(2, '0');
    var url = '/seller/viewings/slots/month-meta?month=' + monthStr
      + '&propertyId=' + encodeURIComponent(this.propertyId);

    fetch(url, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        // Merge new month data
        Object.keys(data).forEach(function (k) { self.slotsByDate[k] = data[k]; });
        self.render();
      })
      .catch(function () { /* ignore fetch errors, dots just won't show */ });
  };

  function formatDate(d) {
    return d.getFullYear() + '-'
      + String(d.getMonth() + 1).padStart(2, '0') + '-'
      + String(d.getDate()).padStart(2, '0');
  }

  // Expose globally
  window.ViewingCalendar = ViewingCalendar;
})();
```

**Step 2: Commit**

```bash
git add public/js/viewing-calendar.js
git commit -m "feat(viewing): add ViewingCalendar vanilla JS module"
```

---

### Task 6: Update the Dashboard Template

**Files:**
- Modify: `src/views/partials/seller/viewings-dashboard.njk:34-99`

**Step 1: Update the single slot panel**

Replace the existing `#panel-single` div (lines 52–99) with:

```njk
  {# Single slot form — calendar + sidebar layout #}
  <div id="panel-single" class="flex flex-col sm:flex-row gap-0">
    {# Calendar (60%) #}
    <div class="w-full sm:w-[60%] sm:border-r border-gray-200 sm:pr-4">
      <div id="viewing-calendar"
           data-property-id="{{ propertyId }}"
           data-slots-by-date="{{ slotsByDate | dump | safe }}"
           data-sidebar-target="#date-sidebar"
      ></div>
    </div>

    {# Sidebar (40%) #}
    <div id="date-sidebar" class="w-full sm:w-[40%] sm:pl-4 min-h-[200px] flex items-center justify-center">
      <p class="text-sm text-gray-400 text-center">{{ "Select a date on the calendar to add a viewing slot." | t }}</p>
    </div>
  </div>
```

**Step 2: Build `slotsByDate` in the dashboard route**

In `viewing.router.ts`, update the `GET /seller/viewings` handler to compute `slotsByDate` from the existing `slots` array:

```typescript
// After: const { stats, slots } = dashboard;
// Add:
const slotsByDate: Record<string, { available: number; full: number }> = {};
for (const slot of slots) {
  const dateKey = (slot.date instanceof Date ? slot.date : new Date(slot.date))
    .toISOString().split('T')[0];
  if (!slotsByDate[dateKey]) slotsByDate[dateKey] = { available: 0, full: 0 };
  if (slot.status === 'full' || (slot.slotType === 'single' && slot.currentBookings >= 1)) {
    slotsByDate[dateKey].full++;
  } else {
    slotsByDate[dateKey].available++;
  }
}

// Pass slotsByDate to both render calls:
// res.render('partials/seller/viewings-dashboard', { stats, slots, propertyId, slotsByDate });
// res.render('pages/seller/viewings', { stats, slots, propertyId, slotsByDate });
```

**Step 3: Commit**

```bash
git add src/views/partials/seller/viewings-dashboard.njk src/domains/viewing/viewing.router.ts
git commit -m "feat(viewing): replace date picker with calendar + sidebar layout"
```

---

### Task 7: Initialize ViewingCalendar in app.js

**Files:**
- Modify: `public/js/app.js`

**Step 1: Add initialization**

Add at the bottom of `app.js`, inside the existing DOMContentLoaded or init block:

```javascript
// ── Viewing Calendar ──────────────────────────────────
var calendarEl = document.getElementById('viewing-calendar');
if (calendarEl && window.ViewingCalendar) {
  new window.ViewingCalendar(calendarEl);
}
```

**Step 2: Add the script tag to base layout**

In `src/views/layouts/base.njk`, add after the `app.js` script tag (line 24):

```html
  <script src="/js/viewing-calendar.js"></script>
```

**Step 3: Commit**

```bash
git add public/js/app.js src/views/layouts/base.njk
git commit -m "feat(viewing): initialize ViewingCalendar on page load"
```

---

### Task 8: Manual Smoke Test

**Step 1:** Run the dev server

```bash
npm run dev
```

**Step 2:** Navigate to `/seller/viewings` in the browser. Verify:

- [ ] Monthly calendar renders at 60% width
- [ ] Day labels (Su–Sa) display correctly
- [ ] Month navigation arrows work (instant, no page reload)
- [ ] "Today" button highlights today and jumps back to current month
- [ ] Dates with existing slots show green/red dots
- [ ] Clicking a date shows sidebar with existing slots summary + add form
- [ ] Clicking an empty date shows form with 10:00–11:00 default
- [ ] Start/End times pre-fill with next available gap
- [ ] Adding a slot via the form works (appends to slot list)
- [ ] Switching to "Bulk (Recurring)" tab still works
- [ ] Mobile: calendar and sidebar stack vertically
- [ ] Navigating to a different month fetches dot metadata

**Step 3: Run all tests**

```bash
npm test && npm run test:integration
```

Expected: all pass

**Step 4: Commit any fixes from smoke test**

---

### Task 9: Final Review and Cleanup

**Step 1:** Review all changed files for:
- i18n: all user-facing strings wrapped in `{{ "string" | t }}`
- No hardcoded URLs — routes use proper paths
- CSP: no inline scripts; calendar JS is in external file
- Accessibility: calendar buttons have aria-labels, keyboard navigation works

**Step 2: Commit any cleanup**

```bash
git add -A
git commit -m "chore(viewing): calendar cleanup and a11y improvements"
```
