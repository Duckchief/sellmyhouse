# Collapsible Sidebar Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggle-only collapsible icon-rail sidebar to the admin and agent dashboards, with state persisted in `localStorage`.

**Architecture:** CSS class `sidebar-collapsed` on `#sidebar` drives all visual state; custom CSS transitions the sidebar width from `16rem` to `2.75rem` when collapsed. Vanilla JS in `app.js` handles the toggle event and `localStorage` persistence. No new dependencies.

**Tech Stack:** Nunjucks templates, Tailwind CSS v3 + custom CSS in `src/views/styles/input.css`, vanilla JS in `public/js/app.js`.

---

## Chunk 1: All changes

### Task 1: Add `panel-left` toggle icon to icons.njk

**Files:**
- Modify: `src/views/partials/shared/icons.njk`

- [ ] **Step 1: Add the `panel-left` icon**

  In `src/views/partials/shared/icons.njk`, find this exact text:

  ```nunjucks
  {% elif name == "arrow-right-on-rectangle" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"/>
  {% endif %}
  ```

  Replace it with:

  ```nunjucks
  {% elif name == "arrow-right-on-rectangle" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"/>
  {% elif name == "panel-left" %}
  <rect x="3" y="3" width="18" height="18" rx="2" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" fill="none"/>
  <line x1="9" y1="3" x2="9" y2="21" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>
  {% endif %}
  ```

  This renders as a rectangle with a vertical dividing line — the same panel-toggle icon used by Claude.ai.

- [ ] **Step 2: Commit**

  ```bash
  git add src/views/partials/shared/icons.njk
  git commit -m "feat: add panel-left icon for sidebar toggle"
  ```

---

### Task 2: Add sidebar collapse CSS

**Files:**
- Modify: `src/views/styles/input.css`

- [ ] **Step 1: Append sidebar collapse rules at the end of `src/views/styles/input.css`**

  Add this block after the existing `@layer components { ... }` block:

  ```css
  /* ── Sidebar collapse ───────────────────────────────────────────── */
  #sidebar {
    transition: width 200ms ease;
    overflow: hidden;
  }

  /* Desktop only: collapse to 44px icon rail */
  @media (min-width: 768px) {
    #sidebar.sidebar-collapsed {
      width: 2.75rem; /* 44px */
    }
  }

  /* Mobile safety: never collapse on small screens (preserves hamburger layout) */
  @media (max-width: 767px) {
    #sidebar.sidebar-collapsed {
      width: 16rem;
    }
  }

  #sidebar .sidebar-label {
    opacity: 1;
    max-width: 200px;
    transition: opacity 150ms ease, max-width 150ms ease;
    white-space: nowrap;
    overflow: hidden;
  }

  #sidebar.sidebar-collapsed .sidebar-label {
    opacity: 0;
    max-width: 0;
  }

  #sidebar .sidebar-title {
    transition: opacity 150ms ease, max-width 150ms ease;
    overflow: hidden;
    white-space: nowrap;
    max-width: 200px;
  }

  #sidebar.sidebar-collapsed .sidebar-title {
    opacity: 0;
    max-width: 0;
    pointer-events: none;
  }

  #sidebar .sidebar-toggle {
    margin-left: auto;
    flex-shrink: 0;
  }

  #sidebar.sidebar-collapsed .sidebar-toggle {
    margin-left: 0;
  }

  /* Collapsed dividers: narrow centred rule */
  #sidebar.sidebar-collapsed .sidebar-divider {
    width: 24px;
    margin-left: auto;
    margin-right: auto;
  }

  #sidebar.sidebar-collapsed .sidebar-section-label {
    display: none;
  }
  ```

- [ ] **Step 2: Rebuild CSS**

  ```bash
  npm run build:css
  ```

  Expected: exits 0, `public/css/output.css` regenerated without errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/views/styles/input.css public/css/output.css
  git commit -m "feat: add sidebar collapse CSS rules"
  ```

---

### Task 3: Update admin.njk

**Files:**
- Modify: `src/views/layouts/admin.njk`

The admin sidebar currently has 15 nav links (9 above the divider + 6 in the admin section), one divider, and one `<p>` section label. All link text needs wrapping in `<span class="sidebar-label">` and `title` attributes for hover tooltips.

Also: the `<aside>` element has a Tailwind class `w-64` which sets `width: 16rem`. Our custom CSS `#sidebar { transition: width 200ms ease }` and `#sidebar.sidebar-collapsed { width: 2.75rem }` use ID selector specificity which wins over `w-64`. No change to the `<aside>` class is needed, but verify in the browser that the transition works (see Task 6).

- [ ] **Step 1: Replace the sidebar title div**

  Find:
  ```nunjucks
  <div class="text-lg font-bold mb-6">{{ "Admin Portal" | t }}</div>
  ```

  Replace with:
  ```nunjucks
  <div class="flex items-center mb-6 min-w-0">
    <div class="sidebar-title text-lg font-bold flex-1 min-w-0">{{ "Admin Portal" | t }}</div>
    <button class="sidebar-toggle hidden md:flex items-center justify-center p-1 rounded hover:bg-white/10 text-white/60 hover:text-white flex-shrink-0" title="{{ 'Toggle sidebar' | t }}" data-action="toggle-sidebar-collapse" aria-label="{{ 'Toggle sidebar' | t }}">
      {{ icon('panel-left') }}
    </button>
  </div>
  ```

- [ ] **Step 2: Replace the full nav block**

  Find the opening `<nav class="space-y-1 flex-1">` tag through its closing `</nav>` tag and replace the entire content with:

  ```nunjucks
  <nav class="space-y-1 flex-1">
    <a href="/admin/dashboard" title="{{ 'Dashboard' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/dashboard' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('home') }}<span class="sidebar-label">{{ "Dashboard" | t }}</span></a>
    <a href="/admin/pipeline" title="{{ 'Pipeline' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/pipeline' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('funnel') }}<span class="sidebar-label">{{ "Pipeline" | t }}</span></a>
    <a href="/admin/leads" title="{{ 'Leads' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/leads' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('user-plus') }}<span class="sidebar-label">{{ "Leads" | t }}</span></a>
    <a href="/admin/sellers" title="{{ 'All Sellers' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/sellers' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('users') }}<span class="sidebar-label">{{ "All Sellers" | t }}</span></a>
    <a href="/admin/content/market" title="{{ 'Media Content' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/content/market' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('chart-bar') }}<span class="sidebar-label">{{ "Media Content" | t }}</span></a>
    <a href="/admin/content/testimonials" title="{{ 'Testimonials' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/content/testimonials' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('star') }}<span class="sidebar-label">{{ "Testimonials" | t }}</span></a>
    <a href="/admin/tutorials" title="{{ 'Tutorials' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/tutorials' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('academic-cap') }}<span class="sidebar-label">{{ "Tutorials" | t }}</span></a>
    <a href="/admin/content/referrals" title="{{ 'Referrals' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/content/referrals' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('share') }}<span class="sidebar-label">{{ "Referrals" | t }}</span></a>
    <a href="/admin/review" title="{{ 'Review Queue' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/review' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('queue-list') }}<span class="sidebar-label">{{ "Review Queue" | t }}</span></a>

    <div class="sidebar-divider border-t border-white/10 my-3"></div>
    <p class="sidebar-section-label px-3 py-1 text-xs text-gray-400 uppercase tracking-wider">{{ "Admin" | t }}</p>

    <a href="/admin/team" title="{{ 'Team' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/team' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('user-group') }}<span class="sidebar-label">{{ "Team" | t }}</span></a>
    <a href="/admin/compliance/deletion-queue" title="{{ 'Compliance' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/compliance/deletion-queue' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('shield-check') }}<span class="sidebar-label">{{ "Compliance" | t }}</span></a>
    <a href="/admin/hdb" title="{{ 'HDB Data' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/hdb' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('building-office-2') }}<span class="sidebar-label">{{ "HDB Data" | t }}</span></a>
    <a href="/admin/notifications" title="{{ 'Notifications' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/notifications' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('bell') }}<span class="sidebar-label">{{ "Notifications" | t }}</span></a>
    <a href="/admin/audit" title="{{ 'Audit Log' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/audit' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('clipboard-document-list') }}<span class="sidebar-label">{{ "Audit Log" | t }}</span></a>
    <a href="/admin/settings" title="{{ 'Settings' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/settings' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('cog-6-tooth') }}<span class="sidebar-label">{{ "Settings" | t }}</span></a>
  </nav>
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/views/layouts/admin.njk
  git commit -m "feat: add sidebar-label spans and toggle button to admin layout"
  ```

---

### Task 4: Update agent.njk

**Files:**
- Modify: `src/views/layouts/agent.njk`

The agent sidebar has 5 nav links, 2 dividers, no section label.

- [ ] **Step 1: Replace the sidebar title div**

  Find:
  ```nunjucks
  <div class="text-lg font-bold mb-6">{{ "Agent Portal" | t }}</div>
  ```

  Replace with:
  ```nunjucks
  <div class="flex items-center mb-6 min-w-0">
    <div class="sidebar-title text-lg font-bold flex-1 min-w-0">{{ "Agent Portal" | t }}</div>
    <button class="sidebar-toggle hidden md:flex items-center justify-center p-1 rounded hover:bg-white/10 text-white/60 hover:text-white flex-shrink-0" title="{{ 'Toggle sidebar' | t }}" data-action="toggle-sidebar-collapse" aria-label="{{ 'Toggle sidebar' | t }}">
      {{ icon('panel-left') }}
    </button>
  </div>
  ```

- [ ] **Step 2: Replace the nav block**

  Find the opening `<nav class="space-y-1 flex-1">` tag through its closing `</nav>` tag and replace the entire content with:

  ```nunjucks
  <nav class="space-y-1 flex-1">
    <a href="/agent/dashboard" title="{{ 'Dashboard' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/agent/dashboard' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('home') }}<span class="sidebar-label">{{ "Dashboard" | t }}</span></a>
    <div class="sidebar-divider border-t border-white/10 my-2"></div>
    <a href="/agent/leads" title="{{ 'Leads' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/agent/leads' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('user-plus') }}<span class="sidebar-label">{{ "Leads" | t }}</span></a>
    <a href="/agent/sellers" title="{{ 'Sellers' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/agent/sellers' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('users') }}<span class="sidebar-label">{{ "Sellers" | t }}</span></a>
    <a href="/agent/reviews" title="{{ 'Reviews' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/agent/reviews' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('clipboard-document-check') }}<span class="sidebar-label">{{ "Reviews" | t }}</span>
      {% if pendingReviewCount %}<span class="ml-auto bg-red-500 text-white text-xs px-2 py-0.5 rounded-full flex-shrink-0">{{ pendingReviewCount }}</span>{% endif %}
    </a>
    <div class="sidebar-divider border-t border-white/10 my-2"></div>
    <a href="/agent/settings" title="{{ 'Settings' | t }}" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/agent/settings' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('cog-6-tooth') }}<span class="sidebar-label">{{ "Settings" | t }}</span></a>
  </nav>
  ```

  Note: the `pendingReviewCount` badge has `flex-shrink-0` so it does not compress during the CSS width transition. The badge is hidden by `overflow: hidden` on `#sidebar` when collapsed anyway.

- [ ] **Step 3: Commit**

  ```bash
  git add src/views/layouts/agent.njk
  git commit -m "feat: add sidebar-label spans and toggle button to agent layout"
  ```

---

### Task 5: Update app.js

**Files:**
- Modify: `public/js/app.js`

Two changes:
1. An inline IIFE at the top of the script applies the saved collapse state synchronously before first paint (avoids FOUC — faster than waiting for `DOMContentLoaded`).
2. A new `toggle-sidebar-collapse` action in the existing click delegation block.

- [ ] **Step 1: Add collapse-restore IIFE near the top of the file**

  Find this exact text in `public/js/app.js`:

  ```js
  // ── Cookie consent banner ──────────────────────────────────────
  (function () {
    if (localStorage.getItem('cookieConsent')) {
  ```

  Insert the following block **immediately before** it:

  ```js
  // ── Sidebar collapse: restore persisted state before first paint ─
  (function () {
    var sidebar = document.getElementById('sidebar');
    if (sidebar && localStorage.getItem('sidebar:collapsed') === 'true') {
      sidebar.classList.add('sidebar-collapsed');
    }
  })();

  ```

- [ ] **Step 2: Add toggle handler in the click delegation block**

  Find this exact text:

  ```js
  // Toggle mobile sidebar open/closed
  if (action === 'toggle-sidebar') {
  ```

  Insert the following block **immediately before** it:

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

- [ ] **Step 3: Commit**

  ```bash
  git add public/js/app.js
  git commit -m "feat: add sidebar collapse toggle and localStorage persistence"
  ```

---

### Task 6: Manual verification

- [ ] **Step 1: Start the dev server**

  ```bash
  npm run dev
  ```

  Navigate to `http://localhost:3000`. Log in as admin.

- [ ] **Step 2: Verify expanded state (admin)**

  - Sidebar shows at full width (~256px) with "Admin Portal" title and all 15 nav links with text labels visible.
  - Toggle button (panel icon: rectangle with vertical divider) is visible in the top-right of the sidebar header on desktop.
  - Mobile (< 768px): toggle button is hidden.

- [ ] **Step 3: Click the toggle button — verify collapsed state (admin)**

  - Sidebar smoothly transitions to ~44px width over 200ms.
  - Text labels fade out; icons remain centred in the rail.
  - "Admin Portal" title fades out; toggle button shifts to centre.
  - "Admin" section label disappears.
  - Divider becomes a short 24px centred rule.
  - Main content area expands to fill the vacated space.
  - Hovering any nav icon shows the native browser tooltip (e.g. "Dashboard").

- [ ] **Step 4: Verify persistence across navigation**

  - While collapsed, click a nav link (e.g. Pipeline). After navigation, sidebar remains collapsed.
  - Click toggle — sidebar expands. Refresh the page — sidebar remains expanded.
  - Open DevTools → Application → Local Storage → confirm `sidebar:collapsed` key is `"false"`.

- [ ] **Step 5: Verify agent dashboard**

  Log in as agent. Repeat steps 2–4. Confirm:
  - All 5 links show icons + labels in expanded state.
  - Pending review count badge (if non-zero) does not cause layout issues in either state.

- [ ] **Step 6: Verify mobile is unaffected**

  - Resize browser to < 768px (or use DevTools → Toggle device toolbar).
  - Sidebar should show/hide via the hamburger button in the top header exactly as before.
  - If `sidebar:collapsed` is `"true"` in localStorage, confirm the sidebar still shows at full width on mobile.

- [ ] **Step 7: Verify seller dashboard is unchanged**

  Log in as seller. Confirm no toggle button appears and sidebar behaves identically to before.

- [ ] **Step 8: Final commit**

  Only needed if any files were modified during verification (e.g. a CSS tweak). If all verification passes with no further changes, skip this step — all changes were committed incrementally in Tasks 1–5.

  If there are unstaged fixes:
  ```bash
  git add src/views/styles/input.css public/css/output.css src/views/layouts/admin.njk src/views/layouts/agent.njk public/js/app.js
  git commit -m "fix: sidebar collapse adjustments from manual verification"
  ```
