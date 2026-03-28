# Mobile Performance Optimization — Design Spec

**Date:** 2026-03-27
**Status:** Draft
**Problem:** Public-facing pages feel slow on mobile — both initial page load and HTMX interactions.

## Root Causes

### Initial load
1. **No gzip compression in nginx** — CSS (70KB), HTMX (51KB), and app.js (61KB) transfer uncompressed. Gzip would reduce these by ~75%.
2. **No Cache-Control headers** — nginx config has no caching directives. Every visit re-downloads all static assets.
3. **No HTTP/2** — nginx uses HTTP/1.1, causing head-of-line blocking for parallel asset downloads on mobile.
4. **HTMX is render-blocking** — `<script src="/js/htmx.min.js">` in `<head>` without `defer` blocks first paint while the browser downloads and parses 51KB.
5. **app.js (61KB) loaded on all pages** — Public pages only need ~5KB (service worker registration, cookie consent, country picker, HTMX event handlers). The remaining 56KB is seller/agent dashboard logic.
6. **No resource hints** — No `<link rel="preload">` or `<link rel="dns-prefetch">` for critical resources.
7. **Service worker is network-first for everything** — Static assets (CSS, JS, icons) should use cache-first strategy for instant repeat visits.
8. **Maintenance page image is 3.9MB** — `space-monkey-maintenance.png` is 2760x1504 RGBA PNG, served unoptimized.

### Interactions (HTMX requests)
9. **HDB API endpoints hit the database on every request** — Dropdown cascades (`/api/hdb/flat-types`, `/api/hdb/storey-ranges`) and market report searches query PostgreSQL live. HDB data only changes during periodic sync jobs, so results are safe to cache.
10. **Maintenance mode checked via DB on every request** — `settingsService.get('maintenance_mode')` queries PostgreSQL on every non-admin request for a boolean that changes maybe once a month.

## Design

### 1. Nginx: compression, HTTP/2, caching

**Files changed:** `docker/nginx/conf.d/staging/staging.conf`, `docker/nginx/conf.d/production/production.conf`

Add to both staging and production HTTPS server blocks:

**HTTP/2:**
```nginx
listen 443 ssl http2;
```

**Gzip compression (inside the server block):**
```nginx
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
```

**Static asset caching (before the catch-all `location /` block):**
```nginx
location ~* ^/(css|js|icons|images)/ {
    proxy_pass         http://app-{env}:3000;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_hide_header  Cache-Control;
    add_header         Cache-Control "public, max-age=31536000, immutable" always;
}
```

Where `{env}` is `app-staging` or `app-prod` respectively.

**Rationale:** Assets are still served through Node (no shared volume needed), but nginx adds long-lived cache headers and gzip compression. The `immutable` directive tells browsers not to revalidate. This is safe because asset URLs will include a version query string (see section 2).

### 2. Asset versioning

**Files changed:** `src/infra/http/app.ts`, `src/views/layouts/base.njk`, `docker/Dockerfile`, `docker/entrypoint.sh`

**Approach:** Inject a build version into asset URLs as a query string (`?v=abc123`). When assets change (new deploy), the URL changes, busting the browser cache.

**Build version source:** The git commit SHA, captured at Docker build time via a build arg.

**Dockerfile change:**
```dockerfile
ARG GIT_SHA=dev
ENV ASSET_VERSION=${GIT_SHA}
```

**CI/CD passes the SHA:**
```bash
docker build --build-arg GIT_SHA=$(git rev-parse --short HEAD) ...
```

**Express middleware** (in `app.ts`, after existing `res.locals` setup):
```typescript
const assetVersion = process.env.ASSET_VERSION || 'dev';
app.use((_req, res, next) => {
  res.locals.assetVersion = assetVersion;
  next();
});
```

**Template change** (`base.njk`):
```html
<link rel="stylesheet" href="/css/output.css?v={{ assetVersion }}">
<script src="/js/htmx.min.js?v={{ assetVersion }}" defer nonce="{{ cspNonce }}"></script>
```

And in every layout that loads JS:
```html
<script src="/js/app.js?v={{ assetVersion }}" nonce="{{ cspNonce }}"></script>
```

### 3. Defer HTMX script

**File changed:** `src/views/layouts/base.njk`

Add `defer` attribute to the HTMX script tag:
```html
<script src="/js/htmx.min.js?v={{ assetVersion }}" defer nonce="{{ cspNonce }}"></script>
```

HTMX works correctly with `defer` — it initializes on `DOMContentLoaded` and scans for `hx-*` attributes after the DOM is ready. This unblocks first paint on mobile.

### 4. Split app.js into public.js + app.js

**Files changed:** `public/js/app.js` (edit), `public/js/public.js` (new), `src/views/layouts/base.njk`, `src/views/layouts/agent.njk`, `src/views/layouts/seller.njk`, `src/views/layouts/admin.njk`, `src/views/pages/public/home.njk`

**public.js** (~5KB) — loaded on all pages via `base.njk`:
- Service worker registration
- Cookie consent banner dismiss
- Form honeypot timestamp (`formLoadedAt`)
- Dark mode system preference listener
- Country code picker (needed on public home page lead form)
- HTMX event handlers (`afterRequest`, `afterSwap`, `beforeRequest`, `validation:failed`)
- Tab switching (used across all layouts)
- Modal management (close on escape/outside click — generic)
- Theme toggle (dark mode button)

**app.js** (~56KB) — loaded only in authenticated layouts (`agent.njk`, `seller.njk`, `admin.njk`) via `{% block scripts %}`:
- Sidebar collapse/expand
- User menu dropdown
- Drag-and-drop photo upload
- Photo grid reordering (Sortable.js integration)
- Property info auto-fill from HDB API
- Sale proceeds calculator
- Viewing calendar integration
- Recurring viewing slots management
- Market report form persistence
- Cron picker

**base.njk** loads only `public.js`. Authenticated layouts add `app.js` in their `{% block scripts %}`.

### 5. Resource hints

**File changed:** `src/views/layouts/base.njk`

Add before the CSS link:
```html
<link rel="preload" href="/css/output.css?v={{ assetVersion }}" as="style">
<link rel="dns-prefetch" href="https://cdn.jsdelivr.net">
```

The CSS preload lets the browser start downloading the stylesheet immediately upon discovering the `<link>` in the HTML, before it finishes parsing the rest of the `<head>`. On mobile with high-latency connections, this shaves off perceptible time.

`dns-prefetch` for jsdelivr resolves the DNS lookup early for pages that load Chart.js or Sortable.js from the CDN (admin and seller photo pages).

### 6. HDB in-memory TTL cache

**Files changed:** `src/infra/cache/memory-cache.ts` (new), `src/domains/hdb/service.ts`, `src/domains/hdb/sync.service.ts`

**Generic cache utility** (`src/infra/cache/memory-cache.ts`):
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

**HdbService caching** — wrap each public-facing method with cache:

| Method | Cache key | TTL |
|--------|-----------|-----|
| `getDistinctTowns()` | `hdb:towns` | 6 hours |
| `getDistinctFlatTypes()` | `hdb:flatTypes` | 6 hours |
| `getDistinctFlatTypesByTown(town)` | `hdb:flatTypes:{town}` | 6 hours |
| `getDistinctStoreyRanges()` | `hdb:storeyRanges` | 6 hours |
| `getDistinctStoreyRangesByTownAndFlatType(town, ft)` | `hdb:storeyRanges:{town}:{ft}` | 6 hours |
| `getMarketReport(params)` | `hdb:report:{town}:{ft}:{storey}:{months}` | 1 hour |
| `getPaginatedTransactions(params, page, size)` | `hdb:txns:{town}:{ft}:{storey}:{months}:{page}:{size}` | 1 hour |

**Cache invalidation** — after a successful HDB sync in `sync.service.ts`, call `hdbCache.clear()` to flush all cached HDB data. This ensures synced data appears immediately.

**No cache for write operations** — only read paths are cached. `createManyTransactions` and `createSyncLog` bypass the cache.

### 7. Cache maintenance mode setting

**Files changed:** `src/infra/http/middleware/maintenance.ts`

Use the same `MemoryCache` to cache the `maintenance_mode` setting with a **30-second TTL**. This reduces one DB query per request to one query every 30 seconds.

Implementation in the maintenance middleware:
```typescript
const maintenanceCache = new MemoryCache();
const CACHE_TTL = 30_000; // 30 seconds

// Inside middleware:
let mode = maintenanceCache.get<string>('maintenance_mode');
if (mode === undefined) {
  mode = await settingsService.get('maintenance_mode');
  maintenanceCache.set('maintenance_mode', mode, CACHE_TTL);
}
```

When an admin toggles maintenance mode via the admin panel, the settings service should invalidate this cache entry. Since the cache TTL is only 30 seconds, even without explicit invalidation, the worst case is a 30-second delay — acceptable for a maintenance toggle.

### 8. Optimize maintenance page image

**Files changed:** `public/images/space-monkey-maintenance.png` (replace)

Convert the maintenance page image from PNG (3.9MB, 2760x1504) to:
- **WebP format** — ~90% smaller than PNG for photographic/illustrative content
- **Resize to max 800px width** — maintenance page is centered content, never needs 2760px
- **Target size:** ~30-50KB

Also add `loading="lazy"` and explicit `width`/`height` attributes to the `<img>` tag in the maintenance template to prevent layout shift and defer loading.

Provide a PNG fallback via `<picture>` element for older browsers:
```html
<picture>
  <source srcset="/images/space-monkey-maintenance.webp" type="image/webp">
  <img src="/images/space-monkey-maintenance.png" alt="..." width="400" height="218" loading="lazy">
</picture>
```

### 9. Delete unused images

**Files changed:** Delete `public/images/space-monkey.png` and `public/images/smh-logo.png`

These are not referenced anywhere in the codebase. Removing them saves 5.2MB from the Docker image and repository.

### 10. Service worker: cache-first for static assets

**File changed:** `public/sw.js`

Change the fetch handler to use **cache-first** strategy for static asset paths (`/css/`, `/js/`, `/icons/`). Keep network-first for HTML pages.

```javascript
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Skip authenticated pages
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

This is safe with asset versioning: when a new version deploys, asset URLs change (`?v=newsha`), so the browser requests a new URL that won't match stale cache entries.

### 11. Express.static maxAge fallback

**File changed:** `src/infra/http/app.ts`

Add `maxAge` to the Express static middleware as a fallback behind nginx:
```typescript
app.use(express.static(path.resolve('public'), {
  maxAge: '1d',
  etag: true,
}));
```

This sets `Cache-Control: public, max-age=86400` on static files served by Express. nginx overrides this with the longer `max-age=31536000, immutable` for versioned URLs. The Express setting serves as a safety net for direct access or development.

### 12. prefers-reduced-motion

**File changed:** `src/views/styles/input.css`

Add a media query to respect user motion preferences:
```css
@media (prefers-reduced-motion: reduce) {
  .btn-red-throb {
    animation: none;
  }
}
```

This disables the infinite throb animation for users who have "Reduce motion" enabled in their OS settings. Improves accessibility and saves battery on mobile.

### 13. Remove unused Google Fonts CSP directives

**File changed:** `src/infra/http/app.ts`

Remove `fonts.googleapis.com` from `styleSrc` and `fonts.gstatic.com` from `fontSrc` in the Helmet CSP configuration. No Google Fonts are loaded anywhere in the application. This is not a performance fix but reduces CSP attack surface.

## Out of Scope

- **CDN (Cloudflare)** — Overkill for a Singapore-local product served from Singapore VPS.
- **Redis for session store** — `connect-pg-simple` with `saveUninitialized: false` doesn't query the DB for visitors without session cookies (most public visitors). Not a bottleneck.
- **Critical CSS inlining** — At 70KB uncompressed (~12KB gzipped), the full CSS is small enough to load quickly with gzip + preload. Inlining critical CSS adds build complexity for marginal gain.
- **Code splitting beyond public.js/app.js** — Further splitting (per-page JS bundles) would require a bundler like Vite/esbuild. Not justified for the current asset sizes.
- **Image lazy loading on authenticated pages** — Noted as a future improvement but not in scope for the public page performance work.
- **Prisma connection pool tuning** — Default pool is adequate for current traffic levels.

## Expected Impact

| Metric | Before | After (estimated) |
|--------|--------|-------------------|
| CSS transfer size | 70KB | ~14KB (gzipped) |
| JS transfer size (public pages) | 112KB (htmx + app.js) | ~22KB (gzipped htmx + public.js) |
| Maintenance image | 3.9MB | ~40KB (WebP, resized) |
| First paint | Blocked by htmx download | Unblocked (defer) |
| Repeat visit assets | Full re-download | Cached (immutable + SW cache-first) |
| Market report dropdown | ~50-200ms DB query | <1ms (cached) |
| Market report search | ~100-500ms DB query | <1ms (cached, 1hr TTL) |
| Maintenance mode check | 1 DB query/request | 1 DB query/30 seconds |
| Docker image size | +5.2MB unused images | 5.2MB smaller |

## Testing

- Run Lighthouse mobile audit before and after changes to measure improvement
- Verify HTMX interactions still work with `defer` attribute
- Verify service worker correctly serves cached assets and updates on new deploys
- Verify HDB cache invalidation after sync job completes
- Verify maintenance mode toggle propagates within 30 seconds
- Verify `?v=` query string changes on each deploy
- Test on throttled mobile connection (Chrome DevTools → Network → Slow 3G)
