# Seller Sidebar Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align the seller sidebar with the agent/admin sidebar — shared top-header, dark theme, icons, desktop collapse-to-icon-rail toggle.

**Architecture:** Replace the seller layout's custom mobile bar and light sidebar with the shared `top-header.njk` and a dark `bg-ink` sidebar using the same class structure as agent/admin. Add 4 missing icons to the shared icon macro. No JS or CSS changes needed — existing `app.js` handlers and `input.css` styles target `#sidebar` generically.

**Tech Stack:** Nunjucks templates, Tailwind CSS, vanilla JS (existing `app.js`)

**Design doc:** `docs/plans/2026-03-23-seller-sidebar-design.md`

---

### Task 1: Add missing icons to `icons.njk`

**Files:**
- Modify: `src/views/partials/shared/icons.njk:41` (insert before `{% elif name == "wrench-screwdriver" %}`)

**Step 1: Add 4 new icon definitions**

Insert the following 4 icon blocks before the `wrench-screwdriver` elif (line 41):

```njk
  {% elif name == "camera" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"/>
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"/>
  {% elif name == "calendar" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/>
  {% elif name == "document-text" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
  {% elif name == "banknotes" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"/>
```

**Step 2: Verify the icons render**

Run: `npx nunjucks-render` or visually check in browser — confirm no template errors.

Actually, the simplest verification is to build:

Run: `npm run build`
Expected: Build completes without template errors.

**Step 3: Commit**

```bash
git add src/views/partials/shared/icons.njk
git commit -m "feat(icons): add camera, calendar, document-text, banknotes icons"
```

---

### Task 2: Rewrite seller layout to match agent/admin pattern

**Files:**
- Modify: `src/views/layouts/seller.njk` (full rewrite)

**Step 1: Replace the entire seller layout**

Replace the full contents of `src/views/layouts/seller.njk` with:

```njk
{% extends "layouts/base.njk" %}
{% from "partials/shared/icons.njk" import icon %}

{% block body %}
{# Top header — always visible, contains user dropdown #}
{% include "partials/shared/top-header.njk" %}

{# Sidebar backdrop — mobile overlay #}
<div id="sidebar-backdrop" class="hidden fixed inset-0 bg-black/40 z-40 md:hidden" data-action="toggle-sidebar"></div>

<div class="flex min-h-screen pt-16">
  <aside id="sidebar" class="hidden md:flex w-64 bg-ink text-white p-4 flex-col flex-shrink-0 fixed md:static top-16 bottom-0 md:top-auto md:bottom-auto left-0 z-50">
    <div class="sidebar-header flex items-center mb-6 min-w-0">
      <div class="sidebar-title text-lg font-bold flex-1 min-w-0">{{ "Seller Portal" | t }}</div>
      <button class="sidebar-toggle hidden md:flex items-center justify-center p-1 rounded hover:bg-white/10 text-white/60 hover:text-white flex-shrink-0" title="{{ 'Toggle sidebar' | t }}" data-action="toggle-sidebar-collapse" aria-label="{{ 'Toggle sidebar' | t }}">
        {{ icon('panel-left') }}
      </button>
    </div>
    <nav class="space-y-1 flex-1">
      <a href="/seller/dashboard" title="{{ 'Overview' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/dashboard' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('home') }}<span class="sidebar-tooltip">{{ "Overview" | t }}</span><span class="sidebar-label">{{ "Overview" | t }}</span></a>
      <a href="/seller/property" title="{{ 'Property' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/property' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('building-office-2') }}<span class="sidebar-tooltip">{{ "Property" | t }}</span><span class="sidebar-label">{{ "Property" | t }}</span></a>
      <a href="/seller/onboarding" title="{{ 'Photos' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/onboarding' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('camera') }}<span class="sidebar-tooltip">{{ "Photos" | t }}</span><span class="sidebar-label">{{ "Photos" | t }}</span></a>
      <a href="/seller/viewings" title="{{ 'Viewings' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/viewings' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('calendar') }}<span class="sidebar-tooltip">{{ "Viewings" | t }}</span><span class="sidebar-label">{{ "Viewings" | t }}</span></a>
      <a href="/seller/documents" title="{{ 'Documents' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/documents' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('document-text') }}<span class="sidebar-tooltip">{{ "Documents" | t }}</span><span class="sidebar-label">{{ "Documents" | t }}</span></a>
      <a href="/seller/financial" title="{{ 'Financial Report' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/financial' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('banknotes') }}<span class="sidebar-tooltip">{{ "Financial Report" | t }}</span><span class="sidebar-label">{{ "Financial Report" | t }}</span></a>
      <a href="/seller/tutorials" title="{{ 'Video Tutorials' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/tutorials' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('academic-cap') }}<span class="sidebar-tooltip">{{ "Video Tutorials" | t }}</span><span class="sidebar-label">{{ "Video Tutorials" | t }}</span></a>
      <div class="sidebar-divider border-t border-white/10 my-2"></div>
      <a href="/seller/notifications" title="{{ 'Notifications' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/notifications' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('bell') }}<span class="sidebar-tooltip">{{ "Notifications" | t }}</span><span class="sidebar-label">{{ "Notifications" | t }}</span>
        {% if unreadCount > 0 %}<span class="ml-auto bg-red-500 text-white text-xs px-2 py-0.5 rounded-full flex-shrink-0">{{ unreadCount }}</span>{% endif %}
      </a>
      <a href="/seller/settings" title="{{ 'Settings' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/settings' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('cog-6-tooth') }}<span class="sidebar-tooltip">{{ "Settings" | t }}</span><span class="sidebar-label">{{ "Settings" | t }}</span></a>
      <a href="/seller/my-data" title="{{ 'My Data' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/seller/my-data' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('shield-check') }}<span class="sidebar-tooltip">{{ "My Data" | t }}</span><span class="sidebar-label">{{ "My Data" | t }}</span></a>
    </nav>
    {# Sidebar footer: logout link removed — logout is now in the top-right header dropdown #}
    <div class="mt-auto pt-4 border-t border-white/10">
      <a href="/privacy" class="block px-3 py-1.5 text-xs text-white/40 hover:text-white/70">{{ "Privacy Policy" | t }}</a>
    </div>
  </aside>
  <main class="flex-1 p-8 bg-bg overflow-auto">
    {% block content %}{% endblock %}
  </main>
</div>
{% endblock %}
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Build completes without errors.

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass. No test changes needed — tests don't assert on layout markup.

**Step 4: Commit**

```bash
git add src/views/layouts/seller.njk
git commit -m "feat(seller): align sidebar with agent/admin layout

Switch to shared top-header, dark bg-ink theme, icons with
collapse-to-icon-rail toggle, remove duplicate dark-mode and logout."
```

---

### Task 3: Manual visual verification

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Check seller pages in browser**

Open `http://localhost:3000/seller/dashboard` and verify:

1. Top header shows with hamburger (mobile), user dropdown, dark-mode toggle
2. Sidebar is dark (`bg-ink`) with white text and icons
3. Each nav link shows icon + label
4. Click the `panel-left` icon in sidebar header — sidebar collapses to 44px icon rail
5. Click again — sidebar expands back
6. Refresh page — collapse state persists (localStorage)
7. Hover collapsed icons — tooltips appear
8. Resize to mobile — hamburger in top-header opens/closes sidebar with backdrop
9. Active page link shows accent colour with left border
10. Notifications badge renders when `unreadCount > 0`
11. Privacy Policy link visible in sidebar footer
12. No logout button in sidebar (only in top-header dropdown)
