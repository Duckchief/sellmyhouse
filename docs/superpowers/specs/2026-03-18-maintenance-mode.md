# Maintenance Mode — Design Spec
Date: 2026-03-18

## Overview

Allow admins to take the platform offline for visitors (public + sellers) while keeping access open for admins and agents. A dedicated admin control page provides a toggle, optional custom message, and optional ETA. Visitors see a professional 503 maintenance page featuring the pixel-art space monkey mascot.

---

## Architecture

Three components:

1. **Middleware** — intercepts every request after auth, checks `maintenance_mode` SystemSetting. Admins and agents pass through; all other users receive the maintenance page (HTTP 503).
2. **Admin control page** — `/admin/maintenance`, HTMX-powered toggle and optional message/ETA fields that update SystemSettings in-place.
3. **Public maintenance page** — standalone 503 response with no layout inheritance.

`MAINTENANCE_MODE` already exists as a `SystemSetting` key. Two new keys are added: `maintenance_message` and `maintenance_eta`.

---

## SystemSetting Keys

| Key | Type | Purpose |
|---|---|---|
| `maintenance_mode` | `'true' \| 'false'` | Already exists. Master on/off switch. |
| `maintenance_message` | `string` | Optional. Custom message shown on public page. |
| `maintenance_eta` | `string` | Optional. ISO datetime string for expected return. |

---

## Middleware (`src/infra/http/middleware/maintenance.ts`)

- Registered in `src/app.ts` after session/passport middleware (so `req.user` is available).
- Skip if `maintenance_mode !== 'true'`.
- Skip if `req.path` starts with `/admin` (admin routes stay accessible).
- Skip if `req.user?.role === 'admin' || req.user?.role === 'agent'`.
- Otherwise: render `pages/public/maintenance.njk` with HTTP 503 and `Retry-After: 3600` header.
- Settings are read via `settingsService.getString()` — no direct Prisma calls in middleware.

---

## Admin Control Page

### Route
`GET /admin/maintenance` — renders `pages/admin/maintenance.njk`

### Layout (Option B — Settings Panel)
- **Left column**: pixel-art monkey image (`/images/space-monkey-maintenance.png`), current status badge
  - Badge: red "● Live" when on, grey "● Off" when off
- **Right column**:
  - Apple-style CSS toggle — `POST /admin/maintenance/toggle` (HTMX, swaps badge + alert)
  - **Custom message** `<textarea>` (optional) — `POST /admin/maintenance/message`
  - **Estimated back** `<input type="datetime-local">` (optional) — `POST /admin/maintenance/eta`
- **Alert banner** (shown when maintenance is ON): red banner — *"Maintenance is LIVE — visitors cannot access the platform."*

### HTMX Routes
| Method | Path | Action |
|---|---|---|
| `POST` | `/admin/maintenance/toggle` | Flip `maintenance_mode` true/false |
| `POST` | `/admin/maintenance/message` | Update `maintenance_message` |
| `POST` | `/admin/maintenance/eta` | Update `maintenance_eta` |

All POST routes return HTMX fragments (updated badge + alert region). Full-page fallback for non-HTMX.

### Sidebar
New item added to the **Admin** section of `src/views/layouts/admin.njk`, between Compliance and HDB Data:
- Icon: `wrench-screwdriver`
- Label: "Maintenance"
- Path: `/admin/maintenance`

---

## Public Maintenance Page (`src/views/pages/public/maintenance.njk`)

Standalone page — does not extend any layout. Served with:
- HTTP status: `503 Service Unavailable`
- Header: `Retry-After: 3600`

### Layout
Centred, white background, minimal chrome.

### Copy
```
[pixel-art monkey image — space-monkey-maintenance.png]

We're currently performing scheduled maintenance.

We'll be back shortly. Thank you for your patience.

[Custom message if maintenance_message is set]

[If maintenance_eta is set: "Expected back: Thursday 19 March, 10:00 AM SGT"]

SellMyHomeNow.sg · Powered by Huttons Asia Pte Ltd
```

Professional and matter-of-fact. The monkey mascot (pixel-art construction worker) provides visual personality without the copy needing to be humorous.

---

## File Manifest

| File | Action |
|---|---|
| `public/images/space-monkey-maintenance.png` | Add monkey image |
| `src/infra/http/middleware/maintenance.ts` | Create middleware |
| `src/views/pages/public/maintenance.njk` | Create public maintenance page |
| `src/views/pages/admin/maintenance.njk` | Create admin control page |
| `src/domains/admin/admin.router.ts` | Add GET + 3× POST routes |
| `src/domains/admin/admin.service.ts` | Add `toggleMaintenance`, `setMaintenanceMessage`, `setMaintenanceEta` |
| `src/domains/shared/settings.types.ts` | Add `MAINTENANCE_MESSAGE` and `MAINTENANCE_ETA` keys |
| `src/views/layouts/admin.njk` | Add sidebar item |
| `src/app.ts` | Register maintenance middleware |

---

## Access Control Summary

| Role | Maintenance ON behaviour |
|---|---|
| Admin | Full access — bypasses middleware |
| Agent | Full access — bypasses middleware |
| Seller (logged in) | Sees 503 maintenance page |
| Public (unauthenticated) | Sees 503 maintenance page |

---

## Out of Scope

- Email/WhatsApp notification to sellers when maintenance starts/ends
- Scheduled maintenance windows (cron-based auto-toggle)
- Per-route maintenance exceptions beyond `/admin`
