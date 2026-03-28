# Mobile Performance Optimization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make public-facing pages fast on mobile — both initial load and HTMX interactions.

**Architecture:** Nginx handles compression and caching at the reverse proxy layer. A generic in-memory TTL cache in the app layer caches HDB data and maintenance mode checks. Static assets use versioned URLs for safe immutable caching. JS is split so public pages only load what they need.

**Tech Stack:** nginx, Express, TypeScript, Nunjucks, HTMX, Tailwind CSS, Docker, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-03-27-mobile-performance-design.md`

---

### Task 1: Nginx — gzip, HTTP/2, static asset caching

**Files:**
- Modify: `docker/nginx/conf.d/staging/staging.conf`
- Modify: `docker/nginx/conf.d/production/production.conf`

- [ ] **Step 1: Update staging nginx config**

Replace the HTTPS server block in `docker/nginx/conf.d/staging/staging.conf` with gzip, HTTP/2, and static asset caching:

```nginx
server {
    listen 443 ssl http2;
    server_name staging.sellmyhouse.sg;

    ssl_certificate     /etc/letsencrypt/live/staging.sellmyhouse.sg/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/staging.sellmyhouse.sg/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Staging access control
    auth_basic           "Staging — Authorized Access Only";
    auth_basic_user_file /etc/nginx/htpasswd-staging;

    # Prevent indexing
    add_header X-Robots-Tag "noindex, nofollow" always;
    add_header X-Frame-Options "DENY" always;

    client_max_body_size 15M;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_min_length 256;
    gzip_types
      text/plain
      text/css
      text/xml
      text/javascript
      application/javascript
      application/json
      application/xml
      image/svg+xml;

    # Static assets — immutable cache (busted by ?v= query string)
    location ~* ^/(css|js|icons|images)/ {
        proxy_pass         http://app-staging:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_hide_header  Cache-Control;
        add_header         Cache-Control "public, max-age=31536000, immutable" always;
    }

    location / {
        proxy_pass         http://app-staging:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        'upgrade';
        proxy_read_timeout 60s;
    }
}
```

The HTTP (port 80) server block stays unchanged.

- [ ] **Step 2: Update production nginx config**

Replace the HTTPS server block in `docker/nginx/conf.d/production/production.conf` with the same gzip, HTTP/2, and static asset caching (using `app-prod` and production domains):

```nginx
server {
    listen 443 ssl http2;
    server_name sellmyhouse.sg www.sellmyhouse.sg;

    ssl_certificate     /etc/letsencrypt/live/sellmyhouse.sg/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sellmyhouse.sg/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    client_max_body_size 15M;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_min_length 256;
    gzip_types
      text/plain
      text/css
      text/xml
      text/javascript
      application/javascript
      application/json
      application/xml
      image/svg+xml;

    # Static assets — immutable cache (busted by ?v= query string)
    location ~* ^/(css|js|icons|images)/ {
        proxy_pass         http://app-prod:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_hide_header  Cache-Control;
        add_header         Cache-Control "public, max-age=31536000, immutable" always;
    }

    location / {
        proxy_pass         http://app-prod:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        'upgrade';
        proxy_read_timeout 60s;
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add docker/nginx/conf.d/staging/staging.conf docker/nginx/conf.d/production/production.conf
git commit -m "perf(nginx): add gzip, HTTP/2, immutable caching for static assets"
```

---

### Task 2: Asset versioning + defer HTMX + resource hints

**Files:**
- Modify: `docker/Dockerfile`
- Modify: `.github/workflows/deploy-staging.yml`
- Modify: `.github/workflows/deploy-production.yml`
- Modify: `src/infra/http/app.ts:161`
- Modify: `src/views/layouts/base.njk`

- [ ] **Step 1: Add GIT_SHA build arg to Dockerfile**

In `docker/Dockerfile`, add the build arg in the runner stage (after `FROM node:22-alpine AS runner`, before `WORKDIR /app`):

```dockerfile
# Stage 2: Runtime
FROM node:22-alpine AS runner

ARG GIT_SHA=dev
ENV ASSET_VERSION=${GIT_SHA}

WORKDIR /app
```

- [ ] **Step 2: Pass GIT_SHA in CI/CD workflows**

In `.github/workflows/deploy-staging.yml`, add `build-args` to the docker/build-push-action step:

```yaml
      - name: Build and push Docker image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: docker/Dockerfile
          push: true
          build-args: |
            GIT_SHA=${{ github.sha }}
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME_LC }}:staging
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME_LC }}:staging-${{ github.sha }}
```

Make the same change in `.github/workflows/deploy-production.yml` (read the file first to find the exact build-push-action step).

- [ ] **Step 3: Add assetVersion middleware in Express**

In `src/infra/http/app.ts`, add the asset version middleware right after the existing `express.static` line (line 161):

```typescript
  // Static files
  app.use(express.static(path.resolve('public'), {
    maxAge: '1d',
    etag: true,
  }));

  // Asset version for cache-busting query strings in templates
  const assetVersion = process.env.ASSET_VERSION || 'dev';
  app.use((_req, res, next) => {
    res.locals.assetVersion = assetVersion;
    next();
  });
```

This replaces the existing `app.use(express.static(path.resolve('public')));` line and adds the version middleware.

- [ ] **Step 4: Update base.njk — defer, versioning, resource hints**

Replace the `<head>` content in `src/views/layouts/base.njk`:

```html
<head>
  <script nonce="{{ cspNonce }}">(function(){var s=localStorage.getItem('theme'),p=window.matchMedia('(prefers-color-scheme: dark)').matches;if(s==='dark'||(s===null&&p))document.documentElement.classList.add('dark');}());</script>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{% block title %}SellMyHouse.sg{% endblock %}</title>
  <link rel="preload" href="/css/output.css?v={{ assetVersion }}" as="style">
  <link rel="dns-prefetch" href="https://cdn.jsdelivr.net">
  <link rel="stylesheet" href="/css/output.css?v={{ assetVersion }}">
  <meta name="htmx-config" content='{"inlineStyleNonce":"{{ cspNonce }}","inlineScriptNonce":"{{ cspNonce }}"}'>
  <script src="/js/htmx.min.js?v={{ assetVersion }}" defer nonce="{{ cspNonce }}"></script>
  <link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#1a1a2e">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="apple-touch-icon" href="/icons/icon-192.svg">
  <meta name="csrf-token" content="{{ csrfToken }}">
  {% block head %}{% endblock %}
</head>
```

Changes: added `?v={{ assetVersion }}` to CSS and HTMX URLs, added `defer` to HTMX script, added `<link rel="preload">` for CSS, added `<link rel="dns-prefetch">` for jsdelivr CDN.

- [ ] **Step 5: Update base.njk script tags**

In the `<body>` section of `base.njk`, update the app.js script tag to use versioning. Change:

```html
  <script src="/js/app.js" nonce="{{ cspNonce }}"></script>
```

To:

```html
  <script src="/js/public.js?v={{ assetVersion }}" nonce="{{ cspNonce }}"></script>
  {% block scripts %}{% endblock %}
```

This changes the base layout to load only `public.js`. The `{% block scripts %}` is where authenticated layouts will inject `app.js`.

- [ ] **Step 6: Add app.js to authenticated layouts**

Add the app.js script to each authenticated layout. In `src/views/layouts/agent.njk`, add after the closing `</div>` and before `{% endblock %}`:

```njk
{% block scripts %}
<script src="/js/app.js?v={{ assetVersion }}" nonce="{{ cspNonce }}"></script>
{% endblock %}
```

Do the same in `src/views/layouts/seller.njk` and `src/views/layouts/admin.njk`.

For `admin.njk`, the `{% block head %}` already has Chart.js. The `{% block scripts %}` is new — add it the same way.

- [ ] **Step 7: Commit**

```bash
git add docker/Dockerfile .github/workflows/ src/infra/http/app.ts src/views/layouts/
git commit -m "perf: add asset versioning, defer HTMX, resource hints, Express.static maxAge"
```

---

### Task 3: Split app.js into public.js + app.js

**Files:**
- Create: `public/js/public.js`
- Modify: `public/js/app.js`

This is a careful extraction. `public.js` gets the code needed on public pages. `app.js` keeps everything else and is only loaded in authenticated layouts (wired in Task 2, Step 6).

- [ ] **Step 1: Create public.js**

Create `public/js/public.js` with the following sections extracted from `app.js`:

- Service worker registration (lines 4-7)
- Cookie consent banner (lines 20-26)
- Form honeypot timestamp (lines 28-32)
- Country code picker (lines 34-130)
- Dark mode system preference listener (lines 132-139)
- A subset of click event delegation with only the public-needed actions: `toggle-backup`, `switch-tab`, `dismiss-cookie-banner`, `remove-element`, `toggle-dark-mode` (extracted from lines 141-377)
- Months slider constant + change delegation for `update-months-label` (lines 389-434, only the MONTHS_STEPS constant and the `update-months-label` handler)
- Market report form persistence and URL restore (lines 655-731)
- HTMX reset form / remove element after successful request (lines 628-653)
- HTMX: show browser validation on failed form submit (lines 863-869)
- HTMX: swap server error responses 4xx/5xx into target (lines 871-880)

The file should be wrapped in the same `(function () { 'use strict'; ... })();` IIFE as the original.

```javascript
(function () {
  'use strict';

  // ── Service Worker ─────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }

  // ── Cookie consent banner ──────────────────────────────────────
  (function () {
    if (localStorage.getItem('cookieConsent')) {
      var banner = document.getElementById('cookie-banner');
      if (banner) banner.remove();
    }
  })();

  // ── Form loaded timestamp (bot-detection honeypot) ─────────────
  (function () {
    var el = document.getElementById('formLoadedAt');
    if (el) el.value = Date.now().toString();
  })();

  // ── Country code picker (lead form) ─────────────────────────────
  (function () {
    var COUNTRIES = [
      { name: 'Singapore', code: '+65', flag: '\u{1F1F8}\u{1F1EC}', pattern: '[89]\\d{7}', placeholder: '91234567' },
      { name: 'Malaysia', code: '+60', flag: '\u{1F1F2}\u{1F1FE}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Indonesia', code: '+62', flag: '\u{1F1EE}\u{1F1E9}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Thailand', code: '+66', flag: '\u{1F1F9}\u{1F1ED}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Philippines', code: '+63', flag: '\u{1F1F5}\u{1F1ED}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Vietnam', code: '+84', flag: '\u{1F1FB}\u{1F1F3}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Myanmar', code: '+95', flag: '\u{1F1F2}\u{1F1F2}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Cambodia', code: '+855', flag: '\u{1F1F0}\u{1F1ED}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Laos', code: '+856', flag: '\u{1F1F1}\u{1F1E6}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Brunei', code: '+673', flag: '\u{1F1E7}\u{1F1F3}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
    ];

    var btn = document.getElementById('country-picker-btn');
    var dropdown = document.getElementById('country-picker-dropdown');
    var searchInput = document.getElementById('country-picker-search');
    var list = document.getElementById('country-picker-list');
    var hiddenInput = document.getElementById('countryCode');
    var flagEl = document.getElementById('country-picker-flag');
    var codeEl = document.getElementById('country-picker-code');
    var phoneInput = document.getElementById('nationalNumber');

    if (!btn || !dropdown || !list || !hiddenInput) return;

    function renderList(filter) {
      var lc = (filter || '').toLowerCase();
      list.innerHTML = '';
      COUNTRIES.forEach(function (c) {
        if (lc && c.name.toLowerCase().indexOf(lc) === -1 && c.code.indexOf(lc) === -1) return;
        var li = document.createElement('li');
        li.className = 'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-100';
        li.setAttribute('role', 'option');
        li.dataset.code = c.code;
        li.innerHTML = '<span>' + c.flag + '</span><span class="flex-1">' + c.name + '</span><span class="text-gray-400">' + c.code + '</span>';
        li.addEventListener('click', function () {
          selectCountry(c);
        });
        list.appendChild(li);
      });
    }

    function selectCountry(c) {
      hiddenInput.value = c.code;
      flagEl.textContent = c.flag;
      codeEl.textContent = c.code;
      if (phoneInput) {
        phoneInput.setAttribute('pattern', c.pattern);
        phoneInput.setAttribute('placeholder', c.placeholder);
      }
      closeDropdown();
    }

    function openDropdown() {
      dropdown.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      searchInput.value = '';
      renderList('');
      searchInput.focus();
    }

    function closeDropdown() {
      dropdown.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (dropdown.classList.contains('hidden')) {
        openDropdown();
      } else {
        closeDropdown();
      }
    });

    searchInput.addEventListener('input', function () {
      renderList(searchInput.value);
    });

    document.addEventListener('click', function (e) {
      if (!dropdown.classList.contains('hidden') && !btn.contains(e.target) && !dropdown.contains(e.target)) {
        closeDropdown();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !dropdown.classList.contains('hidden')) {
        closeDropdown();
      }
    });

    renderList('');
  })();

  // ── Dark mode: system preference live listener ─────────────────
  (function () {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      if (!localStorage.getItem('theme')) {
        document.documentElement.classList.toggle('dark', e.matches);
      }
    });
  })();

  // ── Click event delegation (public-facing actions only) ─────────
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;

    if (action === 'toggle-backup') {
      var section = document.getElementById('backup-section');
      if (section) section.classList.toggle('hidden');
    }

    if (action === 'switch-tab') {
      var tab = el.dataset.tab;
      var sellerForm = document.getElementById('seller-form');
      var agentForm = document.getElementById('agent-form');
      var tabSeller = document.getElementById('tab-seller');
      var tabAgent = document.getElementById('tab-agent');
      if (tab === 'seller') {
        sellerForm.classList.remove('hidden');
        agentForm.classList.add('hidden');
        tabSeller.classList.add('text-indigo-600', 'border-b-2', 'border-indigo-600');
        tabSeller.classList.remove('text-gray-500');
        tabAgent.classList.remove('text-indigo-600', 'border-b-2', 'border-indigo-600');
        tabAgent.classList.add('text-gray-500');
      } else {
        agentForm.classList.remove('hidden');
        sellerForm.classList.add('hidden');
        tabAgent.classList.add('text-indigo-600', 'border-b-2', 'border-indigo-600');
        tabAgent.classList.remove('text-gray-500');
        tabSeller.classList.remove('text-indigo-600', 'border-b-2', 'border-indigo-600');
        tabSeller.classList.add('text-gray-500');
      }
    }

    if (action === 'remove-element') {
      var target = document.getElementById(el.dataset.target);
      if (target) target.remove();
    }

    if (action === 'dismiss-cookie-banner') {
      var banner = document.getElementById('cookie-banner');
      if (banner) banner.remove();
      localStorage.setItem('cookieConsent', 'ok');
    }

    if (action === 'toggle-dark-mode') {
      var isDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    }
  });

  // ── Months slider (market report date range) ──────────────────
  var MONTHS_STEPS = [
    { value: '6',   label: '6 Months' },
    { value: '12',  label: '1 Year'   },
    { value: '24',  label: '2 Years'  },
    { value: '60',  label: '5 Years'  },
    { value: '120', label: '10 Years' },
    { value: '240', label: '20 Years' },
    { value: '0',   label: 'All Time' },
  ];

  // ── Change event delegation (public-facing actions only) ────────
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el.matches('[data-action]')) return;
    var action = el.dataset.action;

    if (action === 'update-months-label') {
      var step = MONTHS_STEPS[parseInt(el.value, 10)];
      if (step) {
        var hidden = document.getElementById('months-value');
        var lbl = document.getElementById('months-label');
        if (hidden) hidden.value = step.value;
        if (lbl) lbl.textContent = step.label;
      }
    }
  });

  // ── HTMX: reset form / remove element after successful request ─
  document.addEventListener('htmx:afterRequest', function (e) {
    var el = e.detail.elt;

    if (e.detail.successful) {
      if (el.matches('[data-reset-on-success]')) {
        el.reset();
      }
      if (el.dataset.removeOnSuccess) {
        var target = document.getElementById(el.dataset.removeOnSuccess);
        if (target) target.remove();
      }
    } else if (e.detail.failed) {
      if (el.dataset.errorTarget) {
        var errEl = document.getElementById(el.dataset.errorTarget);
        if (errEl) {
          errEl.textContent = el.dataset.errorMessage || 'An error occurred. Please try again.';
          errEl.classList.remove('hidden');
        }
      }
    }
  });

  // ── Market report: persist form selections across HTMX swaps ──
  var _mrParams = null;

  document.addEventListener('htmx:beforeRequest', function (e) {
    var form = document.getElementById('market-report-form');
    if (!form || e.detail.elt !== form) return;
    _mrParams = {};
    var fields = form.querySelectorAll('select, input[name]');
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].name) _mrParams[fields[i].name] = fields[i].value;
    }
  });

  document.addEventListener('htmx:afterSwap', function (e) {
    if (!e.detail.target || e.detail.target.id !== 'report-results') return;
    if (!_mrParams) return;

    var form = document.getElementById('market-report-form');
    if (form) {
      var keys = Object.keys(_mrParams);
      for (var i = 0; i < keys.length; i++) {
        var el = form.querySelector('[name="' + keys[i] + '"]');
        if (el) el.value = _mrParams[keys[i]];
      }
      var months = _mrParams['months'];
      if (months) {
        for (var j = 0; j < MONTHS_STEPS.length; j++) {
          if (MONTHS_STEPS[j].value === months) {
            var slider = document.getElementById('months-slider');
            var lbl = document.getElementById('months-label');
            if (slider) slider.value = String(j);
            if (lbl) lbl.textContent = MONTHS_STEPS[j].label;
            break;
          }
        }
      }
    }

    var qs = Object.keys(_mrParams).filter(function (k) { return _mrParams[k]; }).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(_mrParams[k]);
    }).join('&');
    history.replaceState(null, '', '/market-report?' + qs);

    _mrParams = null;
  });

  (function () {
    var form = document.getElementById('market-report-form');
    if (!form) return;
    var params = new URLSearchParams(window.location.search);
    ['town', 'flatType', 'storeyRange'].forEach(function (name) {
      var val = params.get(name);
      if (val) {
        var el = form.querySelector('[name="' + name + '"]');
        if (el) el.value = val;
      }
    });
    var months = params.get('months');
    if (months) {
      var monthsEl = document.getElementById('months-value');
      if (monthsEl) monthsEl.value = months;
      for (var i = 0; i < MONTHS_STEPS.length; i++) {
        if (MONTHS_STEPS[i].value === months) {
          var slider = document.getElementById('months-slider');
          var lbl = document.getElementById('months-label');
          if (slider) slider.value = String(i);
          if (lbl) lbl.textContent = MONTHS_STEPS[i].label;
          break;
        }
      }
    }
  })();

  // ── HTMX: show browser validation on failed form submit ────────
  document.addEventListener('htmx:validation:failed', function (e) {
    var form = e.detail.elt;
    if (form && form.reportValidity) {
      form.reportValidity();
    }
  });

  // ── HTMX: swap server error responses (4xx/5xx) into target ────
  document.addEventListener('htmx:beforeOnLoad', function (e) {
    if (e.detail.xhr.status >= 400) {
      if (e.detail.elt && e.detail.elt.id === 'add-slot-form') return;
      e.detail.shouldSwap = true;
      e.detail.isError = false;
    }
  });

})();
```

- [ ] **Step 2: Remove extracted sections from app.js**

Remove from `public/js/app.js`:
- Service worker registration (lines 4-7)
- Cookie consent banner (lines 20-26)
- Form honeypot timestamp (lines 28-32)
- Country code picker (lines 34-130)
- Dark mode system preference listener (lines 132-139)
- From the click delegation handler (lines 141-377): remove `toggle-backup`, `switch-tab`, `dismiss-cookie-banner`, `remove-element`, and `toggle-dark-mode` action blocks. Keep all other actions.
- MONTHS_STEPS constant (lines 389-398) — keep a copy in app.js since the market report form persistence code is moved to public.js but the constant is also referenced by the change delegation
- Market report form persistence (lines 655-731) — move to public.js
- HTMX reset form / remove element (lines 628-653) — move to public.js
- HTMX validation:failed handler (lines 863-869) — move to public.js
- HTMX beforeOnLoad error swap (lines 871-880) — move to public.js

The remaining app.js keeps: sidebar collapse restore, the remaining click actions (viewing tabs, seller detail tabs, cancel-slot modals, copy, navigate, sidebar toggle, user menu, review/tutorial/testimonial/market-content panels, referral toggle, joint fields), close user menu on outside click, change delegation (check-both-boxes, toggle-complete-btn, auto-submit, toggle-agent-fields — but NOT update-months-label which is in public.js), photo drag-and-drop, submit delegation, HTMX panel show/hide handlers, sidebar settled transition, close sidebar on mobile nav click, cron picker, photo grid reorder, photo grid auto-dismiss, auto-fill HDB data, sale proceeds calculator, viewing calendar, recurring slots, bulk slot selection.

**Important:** Remove the MONTHS_STEPS constant from app.js if it is no longer referenced there. Grep for `MONTHS_STEPS` in the remaining app.js code. The `update-months-label` change handler moved to public.js, so if no other code in app.js uses it, remove it.

- [ ] **Step 3: Verify both scripts load correctly**

Run: `npm run build`
Expected: Build succeeds. No errors.

Open the home page in a browser. Check the Network tab:
- `public.js` loads on the home page
- `app.js` does NOT load on the home page
- Both `public.js` and `app.js` load on authenticated pages

- [ ] **Step 4: Commit**

```bash
git add public/js/public.js public/js/app.js
git commit -m "perf: split app.js into public.js (5KB) + app.js (dashboard only)"
```

---

### Task 4: MemoryCache utility + tests

**Files:**
- Create: `src/infra/cache/memory-cache.ts`
- Create: `src/infra/cache/__tests__/memory-cache.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/infra/cache/__tests__/memory-cache.test.ts`:

```typescript
import { MemoryCache } from '../memory-cache';

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache();
  });

  it('returns undefined for missing key', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  it('stores and retrieves a value', () => {
    cache.set('key', { data: 42 }, 60_000);
    expect(cache.get<{ data: number }>('key')).toEqual({ data: 42 });
  });

  it('returns undefined for expired key', () => {
    cache.set('key', 'value', 0); // TTL of 0ms — already expired
    expect(cache.get('key')).toBeUndefined();
  });

  it('invalidates keys by prefix', () => {
    cache.set('hdb:towns', ['ANG MO KIO'], 60_000);
    cache.set('hdb:flatTypes', ['4 ROOM'], 60_000);
    cache.set('other:key', 'keep', 60_000);

    cache.invalidatePrefix('hdb:');

    expect(cache.get('hdb:towns')).toBeUndefined();
    expect(cache.get('hdb:flatTypes')).toBeUndefined();
    expect(cache.get<string>('other:key')).toBe('keep');
  });

  it('clears all entries', () => {
    cache.set('a', 1, 60_000);
    cache.set('b', 2, 60_000);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/infra/cache/__tests__/memory-cache.test.ts --no-coverage`
Expected: FAIL — `Cannot find module '../memory-cache'`

- [ ] **Step 3: Implement MemoryCache**

Create `src/infra/cache/memory-cache.ts`:

```typescript
export class MemoryCache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/infra/cache/__tests__/memory-cache.test.ts --no-coverage`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/infra/cache/memory-cache.ts src/infra/cache/__tests__/memory-cache.test.ts
git commit -m "feat: add generic in-memory TTL cache utility"
```

---

### Task 5: HDB service caching

**Files:**
- Modify: `src/domains/hdb/service.ts`
- Modify: `src/domains/hdb/sync.service.ts`
- Modify: `src/domains/hdb/__tests__/service.test.ts`

- [ ] **Step 1: Write the failing test for cached HDB service**

Read the existing `src/domains/hdb/__tests__/service.test.ts` to understand the test setup. Then add a test verifying caching behaviour.

Add to the test file:

```typescript
describe('caching', () => {
  it('returns cached result on second call to getDistinctTowns', async () => {
    const spy = jest.spyOn(service['repo'], 'getDistinctTowns');
    spy.mockResolvedValue(['ANG MO KIO', 'BEDOK']);

    const first = await service.getDistinctTowns();
    const second = await service.getDistinctTowns();

    expect(first).toEqual(['ANG MO KIO', 'BEDOK']);
    expect(second).toEqual(['ANG MO KIO', 'BEDOK']);
    expect(spy).toHaveBeenCalledTimes(1); // Only one DB call — second was cached
  });

  it('clears cache when clearCache is called', async () => {
    const spy = jest.spyOn(service['repo'], 'getDistinctTowns');
    spy.mockResolvedValue(['ANG MO KIO']);

    await service.getDistinctTowns();
    service.clearCache();
    await service.getDistinctTowns();

    expect(spy).toHaveBeenCalledTimes(2); // Cache was cleared, so two DB calls
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/domains/hdb/__tests__/service.test.ts --no-coverage -t "caching"`
Expected: FAIL — `service.clearCache is not a function`

- [ ] **Step 3: Add caching to HdbService**

Modify `src/domains/hdb/service.ts`. Add the import and cache instance at the top:

```typescript
import { MemoryCache } from '@/infra/cache/memory-cache';
```

Add a cache instance and TTL constants to the class:

```typescript
export class HdbService {
  private cache = new MemoryCache();
  private static readonly LOOKUP_TTL = 6 * 60 * 60 * 1000; // 6 hours
  private static readonly REPORT_TTL = 60 * 60 * 1000; // 1 hour

  constructor(private readonly repo: HdbRepository = new HdbRepository()) {}

  clearCache(): void {
    this.cache.clear();
  }
```

Wrap each public read method with caching. Example for `getDistinctTowns`:

```typescript
  async getDistinctTowns(): Promise<string[]> {
    const key = 'hdb:towns';
    const cached = this.cache.get<string[]>(key);
    if (cached) return cached;
    const result = await this.repo.getDistinctTowns();
    this.cache.set(key, result, HdbService.LOOKUP_TTL);
    return result;
  }
```

Apply the same pattern to:
- `getDistinctFlatTypes()` — key: `hdb:flatTypes`, TTL: `LOOKUP_TTL`
- `getDistinctFlatTypesByTown(town)` — key: `hdb:flatTypes:${town}`, TTL: `LOOKUP_TTL`
- `getDistinctStoreyRanges()` — key: `hdb:storeyRanges`, TTL: `LOOKUP_TTL`
- `getDistinctStoreyRangesByTownAndFlatType(town, flatType)` — key: `hdb:storeyRanges:${town}:${flatType}`, TTL: `LOOKUP_TTL`
- `getMarketReport(params)` — key: `hdb:report:${params.town}:${params.flatType}:${params.storeyRange || 'all'}:${params.months ?? 24}`, TTL: `REPORT_TTL`
- `getPaginatedTransactions(params, page, pageSize)` — key: `hdb:txns:${params.town}:${params.flatType}:${params.storeyRange || 'all'}:${params.months ?? 24}:${page}:${pageSize}`, TTL: `REPORT_TTL`

Do NOT cache `getTransactions`, `getPropertyInfo`, `getRecentByTownAndFlatType`, or any write methods.

- [ ] **Step 4: Add cache invalidation to sync service**

The singleton `_serviceInstance` at the bottom of `service.ts` owns the cache. Export a function to clear it.

At the bottom of `src/domains/hdb/service.ts` (after the existing `getRecentByTownAndFlatType` export), add:

```typescript
export function clearHdbCache(): void {
  _serviceInstance.clearCache();
}
```

In `src/domains/hdb/sync.service.ts`, add the import:

```typescript
import { clearHdbCache } from './service';
```

After the successful sync log is created (after line 122 `status: 'success',`), add:

```typescript
      // Clear in-memory HDB cache so fresh data is served immediately
      clearHdbCache();
```

- [ ] **Step 5: Run all HDB tests**

Run: `npx jest src/domains/hdb/ --no-coverage`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/domains/hdb/service.ts src/domains/hdb/sync.service.ts src/domains/hdb/__tests__/service.test.ts
git commit -m "perf: add in-memory TTL cache for HDB service lookups and reports"
```

---

### Task 6: Cache maintenance mode setting

**Files:**
- Modify: `src/infra/http/middleware/maintenance.ts`
- Create: `src/infra/http/middleware/__tests__/maintenance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/infra/http/middleware/__tests__/maintenance.test.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import { maintenanceMiddleware } from '../maintenance';
import * as settingsService from '@/domains/shared/settings.service';

jest.mock('@/domains/shared/settings.service');

const mockReq = (overrides = {}) =>
  ({ path: '/', isAuthenticated: () => false, user: null, ...overrides } as unknown as Request);
const mockRes = () => {
  const res = { status: jest.fn().mockReturnThis(), setHeader: jest.fn(), render: jest.fn() } as unknown as Response;
  return res;
};
const mockNext: NextFunction = jest.fn();

describe('maintenanceMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls settings service only once for rapid sequential requests', async () => {
    const getSpy = jest.spyOn(settingsService, 'get').mockResolvedValue('false');

    await maintenanceMiddleware(mockReq(), mockRes(), mockNext);
    await maintenanceMiddleware(mockReq(), mockRes(), mockNext);
    await maintenanceMiddleware(mockReq(), mockRes(), mockNext);

    // Should be cached after first call — only 1 DB hit
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/infra/http/middleware/__tests__/maintenance.test.ts --no-coverage`
Expected: FAIL — settings service called 3 times (no caching yet)

- [ ] **Step 3: Add caching to maintenance middleware**

Replace `src/infra/http/middleware/maintenance.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import * as settingsService from '@/domains/shared/settings.service';
import { MemoryCache } from '@/infra/cache/memory-cache';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';

const cache = new MemoryCache();
const CACHE_TTL = 30_000; // 30 seconds

export async function maintenanceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    let isOn = cache.get<string>('maintenance_mode');
    if (isOn === undefined) {
      isOn = await settingsService.get('maintenance_mode', 'false');
      cache.set('maintenance_mode', isOn, CACHE_TTL);
    }

    if (isOn !== 'true') {
      return next();
    }

    // Admin, health, and webhook routes always bypass
    if (
      req.path === '/health' ||
      req.path.startsWith('/admin') ||
      req.path.startsWith('/api/webhook')
    ) {
      return next();
    }

    // Admins and agents bypass
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      const user = req.user as AuthenticatedUser;
      if (user.role === 'admin' || user.role === 'agent') {
        return next();
      }
    }

    const maintenanceMessage = await settingsService.get('maintenance_message', '');
    const maintenanceEta = await settingsService.get('maintenance_eta', '');

    res.status(503);
    res.setHeader('Retry-After', '3600');
    res.render('pages/public/maintenance', { maintenanceMessage, maintenanceEta });
  } catch (err) {
    const errName = err instanceof Error ? (err as Error & { name: string }).name : '';
    if (errName === 'PrismaClientInitializationError') {
      return next();
    }
    next(err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/infra/http/middleware/__tests__/maintenance.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Run existing maintenance tests if any**

Run: `npx jest --no-coverage -t "maintenance"`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/infra/http/middleware/maintenance.ts src/infra/http/middleware/__tests__/maintenance.test.ts
git commit -m "perf: cache maintenance mode setting with 30s TTL"
```

---

### Task 7: Optimize images + delete unused

**Files:**
- Modify: `public/images/space-monkey-maintenance.png` (resize + keep as fallback)
- Create: `public/images/space-monkey-maintenance.webp`
- Delete: `public/images/space-monkey.png`
- Delete: `public/images/smh-logo.png`
- Modify: `src/views/pages/public/maintenance.njk`
- Modify: `src/views/pages/admin/maintenance.njk`

- [ ] **Step 1: Convert and resize the maintenance image**

Check if Sharp is available (it's already a dependency for photo processing):

```bash
node -e "const sharp = require('sharp'); sharp('public/images/space-monkey-maintenance.png').resize(800).webp({ quality: 80 }).toFile('public/images/space-monkey-maintenance.webp').then(info => console.log(info))"
```

Then create a resized PNG fallback:

```bash
node -e "const sharp = require('sharp'); sharp('public/images/space-monkey-maintenance.png').resize(800).png({ quality: 80, compressionLevel: 9 }).toFile('public/images/space-monkey-maintenance-small.png').then(info => console.log(info))"
```

Then replace the original PNG with the smaller one:

```bash
mv public/images/space-monkey-maintenance-small.png public/images/space-monkey-maintenance.png
```

Verify the sizes:

```bash
ls -la public/images/space-monkey-maintenance.*
```

Expected: WebP ~30-50KB, PNG ~100-200KB (down from 3.9MB).

- [ ] **Step 2: Update public maintenance template**

In `src/views/pages/public/maintenance.njk`, replace the `<img>` tag (line 67-71):

```html
    <picture>
      <source srcset="/images/space-monkey-maintenance.webp" type="image/webp">
      <img
        src="/images/space-monkey-maintenance.png"
        alt="Maintenance in progress"
        class="maintenance-monkey"
        width="180"
        height="180"
        loading="lazy"
      />
    </picture>
```

- [ ] **Step 3: Update admin maintenance template**

Read `src/views/pages/admin/maintenance.njk` and apply the same `<picture>` pattern if it references `space-monkey-maintenance.png`.

- [ ] **Step 4: Delete unused images**

```bash
rm public/images/space-monkey.png public/images/smh-logo.png
```

- [ ] **Step 5: Commit**

```bash
git add public/images/ src/views/pages/public/maintenance.njk src/views/pages/admin/maintenance.njk
git rm public/images/space-monkey.png public/images/smh-logo.png
git commit -m "perf: optimize maintenance image (3.9MB→~40KB WebP), delete unused images"
```

---

### Task 8: Service worker cache-first + reduced motion + CSP cleanup

**Files:**
- Modify: `public/sw.js`
- Modify: `src/views/styles/input.css`
- Modify: `src/infra/http/app.ts:122-143`

- [ ] **Step 1: Update service worker with cache-first for static assets**

Replace the `fetch` event listener in `public/sw.js` (lines 30-58):

```javascript
// Fetch — cache-first for static assets, network-first for pages
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip API requests, authenticated pages, and cross-origin requests
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/seller/') || url.pathname.startsWith('/agent/') ||
      url.pathname.startsWith('/admin/')) {
    return;
  }

  // Cache-first for static assets (versioned URLs bust stale cache)
  if (/^\/(css|js|icons|images)\//.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
      )
    );
    return;
  }

  // Network-first for HTML pages
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match('/offline.html'))
      )
  );
});
```

Also bump the cache name to force a refresh on existing service workers:

```javascript
const CACHE_NAME = 'smh-v3';
```

- [ ] **Step 2: Add prefers-reduced-motion**

In `src/views/styles/input.css`, add at the end of the file:

```css
/* ── Accessibility: respect reduced motion preference ────────── */
@media (prefers-reduced-motion: reduce) {
  .btn-red-throb {
    animation: none;
  }
}
```

- [ ] **Step 3: Remove unused Google Fonts CSP directives**

In `src/infra/http/app.ts`, remove `'fonts.googleapis.com'` from the `styleSrc` array and `'fonts.gstatic.com'` from the `fontSrc` array in the Helmet CSP config.

Change `styleSrc` (line 130-135) from:

```typescript
          styleSrc: [
            "'self'",
            (req, res) => `'nonce-${(res as express.Response).locals.cspNonce}'`,
            'fonts.googleapis.com',
            'https://cdn.jsdelivr.net',
          ],
```

To:

```typescript
          styleSrc: [
            "'self'",
            (req, res) => `'nonce-${(res as express.Response).locals.cspNonce}'`,
            'https://cdn.jsdelivr.net',
          ],
```

Change `fontSrc` (line 136) from:

```typescript
          fontSrc: ["'self'", 'fonts.gstatic.com'],
```

To:

```typescript
          fontSrc: ["'self'"],
```

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Rebuild CSS**

Run: `npm run build:css`
Expected: `public/css/output.css` regenerated with the reduced-motion media query.

- [ ] **Step 6: Commit**

```bash
git add public/sw.js src/views/styles/input.css src/infra/http/app.ts public/css/output.css
git commit -m "perf: SW cache-first for assets, prefers-reduced-motion, remove unused CSP fonts"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test && npm run test:integration
```

Expected: All tests pass.

- [ ] **Step 2: Build the project**

```bash
npm run build
```

Expected: TypeScript compiles without errors. CSS and JS built.

- [ ] **Step 3: Manual smoke test**

Start the dev server (`npm run dev`) and verify:
- Home page loads — `public.js` in network tab, no `app.js`
- Market report page loads — dropdowns work, search returns results
- Login and visit agent dashboard — both `public.js` and `app.js` load
- All sidebar, photo upload, viewing calendar features still work
- Dark mode toggle works on public and authenticated pages
- Cookie consent banner dismisses properly

- [ ] **Step 4: Commit any fixes if needed**
