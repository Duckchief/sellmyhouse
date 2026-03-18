# Sidebar Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three visual defects in the collapsed sidebar: off-centre icons, no custom tooltip, and tight item spacing.

**Architecture:** Pure CSS + HTML + vanilla JS changes — no server logic, no routes, no tests. CSS is compiled from `src/views/styles/input.css` via Tailwind. JS lives in the single `public/js/app.js` IIFE. Both admin and agent layouts share the same `#sidebar` ID and CSS.

**Tech Stack:** Tailwind CSS v3, Nunjucks templates, vanilla JS

---

## Chunk 1: CSS, HTML, JS changes

### Task 1: CSS — icon centering + tooltip styles + sidebar-settled overflow

**Files:**
- Modify: `src/views/styles/input.css` (append after line 125, the end of the file)

**Context:** `input.css` already has sidebar collapse rules (lines 61–140). The `#sidebar.sidebar-collapsed nav a` rule already exists at **lines 123–129** with four properties (`justify-content: center; padding-left: 0; padding-right: 0; gap: 0;`). The `.sidebar-header` rule at lines 116–121 also already exists.

- [ ] **Step 1a: Patch the existing `#sidebar.sidebar-collapsed nav a` rule at line 124 — add `border-left-width: 0;` inside it**

Find this block (lines 123–129):
```css
/* Collapsed nav links: centre the icon in the 44px rail */
#sidebar.sidebar-collapsed nav a {
  justify-content: center;
  padding-left: 0;
  padding-right: 0;
  gap: 0;
}
```

Replace with:
```css
/* Collapsed nav links: centre the icon in the 44px rail */
#sidebar.sidebar-collapsed nav a {
  justify-content: center;
  padding-left: 0;
  padding-right: 0;
  gap: 0;
  border-left-width: 0;
}
```

- [ ] **Step 1b: Append tooltip + sidebar-settled CSS at the end of the file (after line 140)**

```css
/* Sidebar tooltips */
#sidebar nav a {
  position: relative;
}

#sidebar nav a .sidebar-tooltip {
  display: none;
  position: absolute;
  left: calc(100% + 10px);
  top: 50%;
  transform: translateY(-50%);
  background: #111827;
  color: #f9fafb;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 6px;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  z-index: 200;
  pointer-events: none;
}

#sidebar.sidebar-settled.sidebar-collapsed nav a:hover .sidebar-tooltip {
  display: block;
}

/* Allow tooltips to overflow the 44px rail once transition is complete */
#sidebar.sidebar-settled {
  overflow: visible;
}
```

- [ ] **Step 2: Rebuild the CSS**

```bash
npm run build
```

Expected: CSS compiled with no errors. Check `public/css/output.css` now contains `sidebar-tooltip` and `sidebar-settled` strings.

```bash
grep -c "sidebar-tooltip\|sidebar-settled" public/css/output.css
```

Expected: `2` (or more)

- [ ] **Step 3: Commit**

```bash
git add src/views/styles/input.css
git commit -m "feat: add sidebar icon-centering, tooltip CSS, sidebar-settled overflow rule"
```

---

### Task 2: admin.njk — sidebar-header class + tooltip spans + py-2.5

**Files:**
- Modify: `src/views/layouts/admin.njk`

**Context:** 15 nav links, one divider, one section label. The header div on line 17 is missing the `sidebar-header` class (present in agent.njk but not admin.njk), which means the existing CSS rule `#sidebar.sidebar-collapsed .sidebar-header` never fires for admin. Fix this while touching the file.

- [ ] **Step 1: Add `sidebar-header` class to the header div (line 17)**

Change:
```nunjucks
    <div class="flex items-center mb-6 min-w-0">
```
To:
```nunjucks
    <div class="sidebar-header flex items-center mb-6 min-w-0">
```

- [ ] **Step 2: Add `<span class="sidebar-tooltip">` to all 15 nav links and change `py-2` to `py-2.5`**

Each link currently looks like:
```nunjucks
<a href="/admin/dashboard" title="{{ 'Dashboard' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm ...">{{ icon('home') }}<span class="sidebar-label">{{ "Dashboard" | t }}</span></a>
```

It becomes:
```nunjucks
<a href="/admin/dashboard" title="{{ 'Dashboard' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm ...">{{ icon('home') }}<span class="sidebar-tooltip">{{ "Dashboard" | t }}</span><span class="sidebar-label">{{ "Dashboard" | t }}</span></a>
```

The pattern for every link: after the `{{ icon('...') }}` call, insert `<span class="sidebar-tooltip">LABEL</span>` (using the same label text as the `sidebar-label` span). Also change `py-2` to `py-2.5` on the link's class list.

Apply this to all 15 links — the complete updated `<nav>` block:

```nunjucks
    <nav class="space-y-1 flex-1">
      <a href="/admin/dashboard" title="{{ 'Dashboard' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/admin/dashboard' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('home') }}<span class="sidebar-tooltip">{{ "Dashboard" | t }}</span><span class="sidebar-label">{{ "Dashboard" | t }}</span></a>
      <a href="/admin/pipeline" title="{{ 'Pipeline' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/admin/pipeline' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('funnel') }}<span class="sidebar-tooltip">{{ "Pipeline" | t }}</span><span class="sidebar-label">{{ "Pipeline" | t }}</span></a>
      <a href="/admin/leads" title="{{ 'Leads' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/admin/leads' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('user-plus') }}<span class="sidebar-tooltip">{{ "Leads" | t }}</span><span class="sidebar-label">{{ "Leads" | t }}</span></a>
      <a href="/admin/sellers" title="{{ 'All Sellers' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/admin/sellers' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('users') }}<span class="sidebar-tooltip">{{ "All Sellers" | t }}</span><span class="sidebar-label">{{ "All Sellers" | t }}</span></a>
      <a href="/admin/content/market" title="{{ 'Media Content' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/admin/content/market' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('chart-bar') }}<span class="sidebar-tooltip">{{ "Media Content" | t }}</span><span class="sidebar-label">{{ "Media Content" | t }}</span></a>
      <a href="/admin/content/testimonials" title="{{ 'Testimonials' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/admin/content/testimonials' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('star') }}<span class="sidebar-tooltip">{{ "Testimonials" | t }}</span><span class="sidebar-label">{{ "Testimonials" | t }}</span></a>
      <a href="/admin/tutorials" title="{{ 'Tutorials' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/admin/tutorials' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('academic-cap') }}<span class="sidebar-tooltip">{{ "Tutorials" | t }}</span><span class="sidebar-label">{{ "Tutorials" | t }}</span></a>
      <a href="/admin/content/referrals" title="{{ 'Referrals' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/admin/content/referrals' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('share') }}<span class="sidebar-tooltip">{{ "Referrals" | t }}</span><span class="sidebar-label">{{ "Referrals" | t }}</span></a>
      <a href="/admin/review" title="{{ 'Review Queue' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/admin/review' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('queue-list') }}<span class="sidebar-tooltip">{{ "Review Queue" | t }}</span><span class="sidebar-label">{{ "Review Queue" | t }}</span></a>

      <div class="sidebar-divider border-t border-white/10 my-3"></div>
      <p class="sidebar-section-label px-3 py-1 text-xs text-gray-400 uppercase tracking-wider">{{ "Admin" | t }}</p>

      <a href="/admin/team" title="{{ 'Team' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/admin/team' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('user-group') }}<span class="sidebar-tooltip">{{ "Team" | t }}</span><span class="sidebar-label">{{ "Team" | t }}</span></a>
      <a href="/admin/compliance/deletion-queue" title="{{ 'Compliance' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/admin/compliance/deletion-queue' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('shield-check') }}<span class="sidebar-tooltip">{{ "Compliance" | t }}</span><span class="sidebar-label">{{ "Compliance" | t }}</span></a>
      <a href="/admin/hdb" title="{{ 'HDB Data' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/admin/hdb' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('building-office-2') }}<span class="sidebar-tooltip">{{ "HDB Data" | t }}</span><span class="sidebar-label">{{ "HDB Data" | t }}</span></a>
      <a href="/admin/notifications" title="{{ 'Notifications' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/admin/notifications' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('bell') }}<span class="sidebar-tooltip">{{ "Notifications" | t }}</span><span class="sidebar-label">{{ "Notifications" | t }}</span></a>
      <a href="/admin/audit" title="{{ 'Audit Log' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/admin/audit' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('clipboard-document-list') }}<span class="sidebar-tooltip">{{ "Audit Log" | t }}</span><span class="sidebar-label">{{ "Audit Log" | t }}</span></a>
      <a href="/admin/settings" title="{{ 'Settings' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/admin/settings' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('cog-6-tooth') }}<span class="sidebar-tooltip">{{ "Settings" | t }}</span><span class="sidebar-label">{{ "Settings" | t }}</span></a>
    </nav>
```

- [ ] **Step 3: Commit**

```bash
git add src/views/layouts/admin.njk
git commit -m "feat: add sidebar-header class, tooltip spans, py-2.5 spacing to admin layout"
```

---

### Task 3: agent.njk — tooltip spans + py-2.5

**Files:**
- Modify: `src/views/layouts/agent.njk`

**Context:** 5 nav links. The agent layout already has `sidebar-header` on the header div (line 13) — no need to add it. The Reviews link badge (`pendingReviewCount`) is a **direct flex child of `<a>`**, a sibling to `.sidebar-label` (not nested inside it). Keep it as a sibling — this means the badge remains visible in the collapsed rail, which is better UX (agents can see the count even with the sidebar collapsed).

- [ ] **Step 1: Add tooltip spans and change `py-2` to `py-2.5` on all 5 nav links**

Replace the entire `<nav>` block with:

```nunjucks
    <nav class="space-y-1 flex-1">
      <a href="/agent/dashboard" title="{{ 'Dashboard' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/agent/dashboard' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('home') }}<span class="sidebar-tooltip">{{ "Dashboard" | t }}</span><span class="sidebar-label">{{ "Dashboard" | t }}</span></a>
      <div class="sidebar-divider border-t border-white/10 my-2"></div>
      <a href="/agent/leads" title="{{ 'Leads' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/agent/leads' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('user-plus') }}<span class="sidebar-tooltip">{{ "Leads" | t }}</span><span class="sidebar-label">{{ "Leads" | t }}</span></a>
      <a href="/agent/sellers" title="{{ 'Sellers' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/agent/sellers' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('users') }}<span class="sidebar-tooltip">{{ "Sellers" | t }}</span><span class="sidebar-label">{{ "Sellers" | t }}</span></a>
      <a href="/agent/reviews" title="{{ 'Reviews' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/agent/reviews' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('clipboard-document-check') }}<span class="sidebar-tooltip">{{ "Reviews" | t }}</span><span class="sidebar-label">{{ "Reviews" | t }}</span>
        {% if pendingReviewCount %}<span class="ml-auto bg-red-500 text-white text-xs px-2 py-0.5 rounded-full flex-shrink-0">{{ pendingReviewCount }}</span>{% endif %}
      </a>
      <div class="sidebar-divider border-t border-white/10 my-2"></div>
      <a href="/agent/settings" title="{{ 'Settings' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/agent/settings' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('cog-6-tooth') }}<span class="sidebar-tooltip">{{ "Settings" | t }}</span><span class="sidebar-label">{{ "Settings" | t }}</span></a>
    </nav>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/layouts/agent.njk
git commit -m "feat: add tooltip spans and py-2.5 spacing to agent layout"
```

---

### Task 4: app.js — IIFE + toggle handler + transitionend listener

**Files:**
- Modify: `public/js/app.js`

**Context:** Three targeted changes. The file is a single IIFE wrapper (`public/js/app.js`). Do not restructure it.

- [ ] **Step 1: Update the sidebar-collapse IIFE (lines 9–15) to also add `sidebar-settled` on page load**

Find this block (lines 9–15):
```js
  // ── Sidebar collapse: restore persisted state before first paint ─
  (function () {
    var sidebar = document.getElementById('sidebar');
    if (sidebar && localStorage.getItem('sidebar:collapsed') === 'true') {
      sidebar.classList.add('sidebar-collapsed');
    }
  })();
```

Replace with:
```js
  // ── Sidebar collapse: restore persisted state before first paint ─
  (function () {
    var sidebar = document.getElementById('sidebar');
    if (sidebar && localStorage.getItem('sidebar:collapsed') === 'true') {
      sidebar.classList.add('sidebar-collapsed');
      sidebar.classList.add('sidebar-settled'); // already settled — no animation on load
    }
  })();
```

- [ ] **Step 2: Update the toggle handler (lines 143–150) to remove `sidebar-settled` before toggling**

Find this block (lines 143–150):
```js
    // Toggle desktop sidebar collapse (icon rail)
    if (action === 'toggle-sidebar-collapse') {
      var sidebar = document.getElementById('sidebar');
      if (sidebar) {
        var isCollapsed = sidebar.classList.toggle('sidebar-collapsed');
        localStorage.setItem('sidebar:collapsed', isCollapsed ? 'true' : 'false');
      }
    }
```

Replace with:
```js
    // Toggle desktop sidebar collapse (icon rail)
    if (action === 'toggle-sidebar-collapse') {
      var sidebar = document.getElementById('sidebar');
      if (sidebar) {
        sidebar.classList.remove('sidebar-settled'); // restore overflow:hidden for animation
        var isCollapsed = sidebar.classList.toggle('sidebar-collapsed');
        localStorage.setItem('sidebar:collapsed', isCollapsed ? 'true' : 'false');
      }
    }
```

- [ ] **Step 3: Add a `transitionend` listener for `sidebar-settled`**

Find the close-sidebar-on-nav-click block (around line 501):
```js
  // ── Close sidebar on nav link click (mobile) ───────────────────
  document.querySelectorAll('#sidebar a').forEach(function (link) {
```

Insert the following block immediately **before** that comment:
```js
  // ── Sidebar settled: re-enable overflow after collapse transition ─
  (function () {
    var sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.addEventListener('transitionend', function (e) {
        if (e.target === sidebar && e.propertyName === 'width' && sidebar.classList.contains('sidebar-collapsed')) {
          sidebar.classList.add('sidebar-settled');
        }
      });
    }
  })();

```

- [ ] **Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add sidebar-settled class management for tooltip overflow"
```

---

### Task 5: Visual verification

**Files:** None — verification only

- [ ] **Step 1: Build and start the dev server**

```bash
npm run build
node dist/server.js
```

Navigate to `http://localhost:3000/auth/login` and log in as admin.

- [ ] **Step 2: Verify expanded state (no regressions)**

- Sidebar shows full labels ✓
- Active item has left blue border and accent text ✓
- No tooltips visible when sidebar is expanded ✓
- Item spacing looks slightly more relaxed than before ✓

- [ ] **Step 3: Collapse the sidebar (click the panel-left toggle button)**

- Sidebar collapses to 44px icon rail ✓
- Icons are centred in the rail (not pushed to the left) ✓
- Active item has NO visible left border offset ✓

- [ ] **Step 4: Hover each icon in collapsed state**

After the transition completes (~200ms):
- Dark pill tooltip appears immediately to the RIGHT of the icon ✓
- Tooltip text matches the nav item label ✓
- Tooltip does NOT appear during the collapse animation (only after `sidebar-settled` is added) ✓
- Tooltip is not clipped by the sidebar boundary ✓

- [ ] **Step 5: Expand the sidebar and re-collapse**

- No tooltips visible while expanded ✓
- Tooltips reappear after re-collapsing ✓
- No flash of wrong overflow during animation ✓

- [ ] **Step 6: Commit final**

```bash
git status  # verify only expected files are staged
git add src/views/layouts/admin.njk src/views/layouts/agent.njk src/views/styles/input.css public/js/app.js
git commit -m "feat: sidebar polish — centred icons, Claude.ai-style tooltips, relaxed spacing"
```
