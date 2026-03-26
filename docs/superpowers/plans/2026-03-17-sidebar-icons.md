# Sidebar Icons Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Heroicons outline SVG icons to every navigation item in the Agent and Admin portal sidebars via a Nunjucks macro.

**Architecture:** A single `icons.njk` macro file holds all SVG path data keyed by icon name. Both sidebar layouts import it and call `{{ icon('name') }}` inline in each `<a>` tag. No JS, no CDN, no CSS additions.

**Tech Stack:** Nunjucks macros, Heroicons v2 outline, Tailwind CSS (existing classes only)

---

## Chunk 1: Icons macro + Agent sidebar

### Task 1: Create icons.njk macro

**Files:**
- Create: `src/views/partials/shared/icons.njk`

- [ ] **Step 1: Create the macro file**

```nunjucks
{% macro icon(name, cls="w-[17px] h-[17px] flex-shrink-0") %}
<svg class="{{ cls }}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  {% if name == "home" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/>
  {% elif name == "user-plus" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z"/>
  {% elif name == "users" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/>
  {% elif name == "clipboard-document-check" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0118 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3l1.5 1.5 3-3.75"/>
  {% elif name == "cog-6-tooth" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/>
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
  {% elif name == "funnel" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z"/>
  {% elif name == "shield-check" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/>
  {% elif name == "chart-bar" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"/>
  {% elif name == "star" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"/>
  {% elif name == "share" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z"/>
  {% elif name == "queue-list" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z"/>
  {% elif name == "user-group" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/>
  {% elif name == "academic-cap" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5"/>
  {% elif name == "building-office-2" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z"/>
  {% elif name == "bell" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"/>
  {% elif name == "clipboard-document-list" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"/>
  {% elif name == "arrow-right-on-rectangle" %}
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"/>
  {% endif %}
</svg>
{% endmacro %}
```

- [ ] **Step 2: Commit**

```bash
git add src/views/partials/shared/icons.njk
git commit -m "feat: add Heroicons outline macro (icons.njk)"
```

---

### Task 2: Update Agent sidebar

**Files:**
- Modify: `src/views/layouts/agent.njk`

The current nav `<a>` tags use `block px-3 py-2`. Change to `flex items-center gap-2 px-3 py-2`. Import the macro at the top of the file and insert `{{ icon('name') }}` as the first child of each `<a>`.

The Reviews link has a badge (`<span>`) that must stay **after** the label text. Keep it there.

- [ ] **Step 1: Replace agent.njk with the updated layout**

```nunjucks
{% extends "layouts/base.njk" %}
{% from "partials/shared/icons.njk" import icon %}

{% block body %}
{# Mobile hamburger bar — visible only below md breakpoint #}
<div class="md:hidden fixed top-0 left-0 right-0 z-30 bg-ink border-b border-white/10 px-4 py-3 flex items-center">
  <button data-action="toggle-sidebar" class="text-white hover:text-gray-300">
    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
  </button>
  <a href="/agent/dashboard" class="ml-3 text-lg font-bold text-white">{{ "SellMyHouse" | t }}</a>
</div>

{# Sidebar backdrop — mobile overlay #}
<div id="sidebar-backdrop" class="hidden fixed inset-0 bg-black/40 z-40 md:hidden" data-action="toggle-sidebar"></div>

<div class="flex min-h-screen">
  <aside id="sidebar" class="hidden md:flex w-64 bg-ink text-white p-4 flex-col flex-shrink-0 fixed md:static inset-y-0 left-0 z-50">
    <div class="text-lg font-bold mb-6">{{ "Agent Portal" | t }}</div>
    <nav class="space-y-1">
      <a href="/agent/dashboard" class="flex items-center gap-2 px-3 py-2 rounded hover:bg-white/10 {% if currentPath == '/agent/dashboard' %}bg-white/10{% endif %}">
        {{ icon('home') }}
        {{ "Dashboard" | t }}
      </a>
      <div class="border-t border-white/10 my-2"></div>
      <a href="/agent/leads" class="flex items-center gap-2 px-3 py-2 rounded hover:bg-white/10 {% if currentPath == '/agent/leads' %}bg-white/10{% endif %}">
        {{ icon('user-plus') }}
        {{ "Leads" | t }}
      </a>
      <a href="/agent/sellers" class="flex items-center gap-2 px-3 py-2 rounded hover:bg-white/10 {% if currentPath == '/agent/sellers' %}bg-white/10{% endif %}">
        {{ icon('users') }}
        {{ "Sellers" | t }}
      </a>
      <a href="/agent/reviews" class="flex items-center gap-2 px-3 py-2 rounded hover:bg-white/10 {% if currentPath == '/agent/reviews' %}bg-white/10{% endif %}">
        {{ icon('clipboard-document-check') }}
        {{ "Reviews" | t }}
        {% if pendingReviewCount %}
        <span class="ml-auto bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">{{ pendingReviewCount }}</span>
        {% endif %}
      </a>
      <div class="border-t border-white/10 my-2"></div>
      <a href="/agent/settings" class="flex items-center gap-2 px-3 py-2 rounded hover:bg-white/10 {% if currentPath == '/agent/settings' %}bg-white/10{% endif %}">
        {{ icon('cog-6-tooth') }}
        {{ "Settings" | t }}
      </a>
    </nav>
  </aside>
  <main class="flex-1 pt-16 md:pt-8 p-8 bg-bg">
    {% block content %}{% endblock %}
  </main>
</div>
{% endblock %}
```

Note: changed badge margin from `ml-2` to `ml-auto` so it pushes to the right edge regardless of label length.

- [ ] **Step 2: Start the dev server and verify visually**

```bash
npm run dev
```

Open http://localhost:3000, log in as an agent, and confirm:
- All 5 nav items show their icons to the left of the label
- Active item still has `bg-white/10` highlight
- Reviews badge still appears and is right-aligned
- Icons are 17×17px, vertically centred with text

- [ ] **Step 3: Commit**

```bash
git add src/views/layouts/agent.njk
git commit -m "feat: add icons to Agent sidebar nav"
```

---

## Chunk 2: Admin sidebar

### Task 3: Update Admin sidebar

**Files:**
- Modify: `src/views/layouts/admin.njk`

The admin sidebar uses `text-sm` on nav links and `border-l-2 border-accent` on the active state. The Sign Out link in the sticky footer also gets an icon.

- [ ] **Step 1: Replace admin.njk with the updated layout**

```nunjucks
{% extends "layouts/base.njk" %}
{% from "partials/shared/icons.njk" import icon %}

{% block head %}
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js" nonce="{{ cspNonce }}"></script>
{% endblock %}

{% block body %}
{# Mobile hamburger bar — visible only below md breakpoint #}
<div class="md:hidden fixed top-0 left-0 right-0 z-30 bg-ink border-b border-white/10 px-4 py-3 flex items-center">
  <button data-action="toggle-sidebar" class="text-white hover:text-gray-300">
    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
  </button>
  <a href="/admin/dashboard" class="ml-3 text-lg font-bold text-white">{{ "SellMyHouse" | t }}</a>
</div>

{# Sidebar backdrop — mobile overlay #}
<div id="sidebar-backdrop" class="hidden fixed inset-0 bg-black/40 z-40 md:hidden" data-action="toggle-sidebar"></div>

<div class="flex min-h-screen">
  <aside id="sidebar" class="hidden md:flex w-64 bg-ink text-white p-4 flex-col flex-shrink-0 fixed md:static inset-y-0 left-0 z-50">
    <div class="text-lg font-bold mb-6">{{ "Admin Portal" | t }}</div>
    <nav class="space-y-1 flex-1">
      <a href="/admin/dashboard" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/dashboard' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('home') }}{{ "Dashboard" | t }}</a>
      <a href="/admin/pipeline" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/pipeline' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('funnel') }}{{ "Pipeline" | t }}</a>
      <a href="/admin/leads" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/leads' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('user-plus') }}{{ "Leads" | t }}</a>
      <a href="/admin/sellers" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/sellers' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('users') }}{{ "All Sellers" | t }}</a>
      <a href="/admin/compliance/deletion-queue" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/compliance/deletion-queue' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('shield-check') }}{{ "Compliance" | t }}</a>
      <a href="/admin/content/market" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/content/market' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('chart-bar') }}{{ "Market Content" | t }}</a>
      <a href="/admin/content/testimonials" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/content/testimonials' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('star') }}{{ "Testimonials" | t }}</a>
      <a href="/admin/content/referrals" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/content/referrals' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('share') }}{{ "Referrals" | t }}</a>
      <a href="/admin/review" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/review' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('queue-list') }}{{ "Review Queue" | t }}</a>

      <div class="border-t border-white/10 my-3"></div>
      <p class="px-3 py-1 text-xs text-gray-400 uppercase tracking-wider">{{ "Admin" | t }}</p>

      <a href="/admin/team" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/team' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('user-group') }}{{ "Team" | t }}</a>
      <a href="/admin/tutorials" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/tutorials' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('academic-cap') }}{{ "Tutorials" | t }}</a>
      <a href="/admin/hdb" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/hdb' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('building-office-2') }}{{ "HDB Data" | t }}</a>
      <a href="/admin/notifications" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/notifications' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('bell') }}{{ "Notifications" | t }}</a>
      <a href="/admin/audit" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/audit' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('clipboard-document-list') }}{{ "Audit Log" | t }}</a>
      <a href="/admin/settings" class="flex items-center gap-2 px-3 py-2 rounded text-sm {% if currentPath == '/admin/settings' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('cog-6-tooth') }}{{ "Settings" | t }}</a>
    </nav>
    <div class="mt-auto pt-4 border-t border-white/10">
      <a href="/auth/logout" class="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:text-red-300">{{ icon('arrow-right-on-rectangle') }}{{ "Sign Out" | t }}</a>
    </div>
  </aside>
  <main class="flex-1 pt-16 md:pt-8 p-8 overflow-auto">
    {% block content %}{% endblock %}
  </main>
</div>
{% endblock %}
```

- [ ] **Step 2: Verify visually**

With `npm run dev` still running, open http://localhost:3000, log in as an admin, and confirm:
- All 16 nav items (including Sign Out) show their icons left of the label
- Active item still has `bg-white/10 text-accent border-l-2 border-accent`
- "Admin" section header (uppercase label) has no icon — correct, it's a `<p>` not an `<a>`
- Sign Out is red with the exit icon

- [ ] **Step 3: Commit**

```bash
git add src/views/layouts/admin.njk
git commit -m "feat: add icons to Admin sidebar nav"
```
