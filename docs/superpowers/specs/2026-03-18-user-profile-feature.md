# Spec: User Profile Feature

**Date:** 2026-03-18
**Branch:** dashboard-layout-fix (or new feature branch)
**Scope:** Agent + Admin users

---

## Overview

Add a user profile button to the top-right of the admin and agent layouts, with a dropdown menu (Profile, Log out), and a dedicated profile page at `/profile`.

This feature covers both `agent` and `admin` roles (same `agents` table, differentiated by `AgentRole` enum).

---

## 1. Layout Changes

### 1.1 Top Header Bar

Both `admin.njk` and `agent.njk` receive a persistent top header bar (always visible on all screen sizes).

- **Left:** Page title (passed as a template variable `pageTitle`)
- **Right:** User avatar pill button → dropdown menu
- **Height:** `h-16` (64px), fixed at top, `z-30`
- **Style:** White background, bottom border matching existing `border-white/10` aesthetic
- The existing mobile-only `md:hidden` top bar in both layouts is replaced by this always-visible header

### 1.2 Sidebar Footer

The standalone "Sign Out" / "Logout" link currently at the bottom of both sidebars is **removed**. Logout is handled via the header dropdown.

### 1.3 Main Content Area

Add `pt-16` (or `mt-16`) to the main content wrapper in both layouts to offset the fixed header.

---

## 2. Top Header Partial

**File:** `src/views/partials/shared/top-header.njk`

Receives template variables:
- `user` — the `AuthenticatedUser` from `req.user` (id, name, email, role, twoFactorEnabled)
- `pageTitle` — string, e.g. "Dashboard"
- `avatarUrl` — optional, constructed from `/profile/avatar/{{ user.id }}` if `user.avatarPath` is set

### Template Variables

The partial receives the following variables, all passed explicitly from the router's `res.render()` call:

- `user` — the `AuthenticatedUser` from `req.user` (id, name, email, role, twoFactorEnabled, twoFactorVerified)
- `pageTitle` — string, e.g. `"Dashboard"` — set in each router handler's `res.render()` call
- `hasAvatar` — boolean, `true` if the agent has an `avatarPath` set (checked server-side, not in the template)

`AuthenticatedUser` is **not** extended with `avatarPath`. The avatar check is done in the router: if the agent has an avatar, the router passes `hasAvatar: true` and the template renders `<img src="/profile/avatar/{{ user.id }}">`. This avoids leaking file-system paths into the session.

### Avatar Display

- If `hasAvatar` is true: `<img src="/profile/avatar/{{ user.id }}" alt="Profile">`
- Fallback: coloured circle with initials derived from `user.name` (first letter of first + last word, uppercased)
- Accent colour: `#c8553d` (existing `accent` token)

### Dropdown Menu

Toggled by `data-action="toggle-user-menu"` — handled in `public/js/app.js` using existing click-delegation pattern.

Contents:
```
┌─────────────────────────┐
│ John Doe                │  ← user.name
│ john@huttons.sg         │  ← user.email
├─────────────────────────┤
│ 👤  Profile             │  → /profile
├─────────────────────────┤
│ →   Log out             │  → /auth/logout (red text)
└─────────────────────────┘
```

---

## 3. Profile Domain

**Directory:** `src/domains/profile/`

### 3.1 Router — `profile.router.ts`

All routes require `requireAuth()`, `requireRole('agent', 'admin')`, and `requireTwoFactor()` guards applied in that order at the router level, matching the existing agent/admin pattern.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/profile` | Render profile page |
| `POST` | `/profile/avatar` | Upload avatar (multer, max 5MB, jpg/png/jpeg only) |
| `DELETE` | `/profile/avatar` | Remove avatar |
| `POST` | `/profile/password` | Change password |
| `GET` | `/profile/avatar/:agentId` | Serve avatar file (auth-checked) |

### 3.2 Service — `profile.service.ts`

- `getProfile(agentId)` → returns `ProfileView` (name, email, role, createdAt, twoFactorEnabled, avatarPath)
- `uploadAvatar(agentId, file)` → validates file type/size, saves to `/uploads/avatars/{agentId}.jpg`, calls repository to update `avatarPath`
- `deleteAvatar(agentId)` → deletes file from disk (`fs.unlink`, no-op if file missing), clears `avatarPath` in DB
- `changePassword(agentId, currentPassword, newPassword, confirmPassword)` → verifies current via bcrypt, validates new password (min 8 chars), hashes at cost 12, updates `passwordHash`
- `getAvatarPath(agentId)` → returns `avatarPath` for file serving

### 3.3 Repository — `profile.repository.ts`

- `findAgentById(agentId)` → returns agent record
- `updateAvatarPath(agentId, path)` → sets `avatarPath`
- `clearAvatarPath(agentId)` → sets `avatarPath = null`
- `updatePasswordHash(agentId, hash)` → updates `passwordHash`

### 3.4 Types — `profile.types.ts`

```typescript
import type { AgentRole } from '@prisma/client'; // 'agent' | 'admin'

export interface ProfileView {
  id: string;
  name: string;
  email: string;
  role: AgentRole;          // use Prisma's AgentRole, not the broader UserRole from auth.types.ts
  createdAt: Date;
  twoFactorEnabled: boolean;
  avatarPath: string | null;
}
```

> **Note:** `UserRole` in `auth.types.ts` includes `'seller'`, which is not valid here. Use the Prisma-generated `AgentRole` to avoid an implicit cast.

---

## 4. Profile Page

**File:** `src/views/pages/profile/index.njk`

Extends `layouts/agent.njk` or `layouts/admin.njk` based on role (router renders the correct one, or a shared layout is used with role check). Page title: "Profile".

### 4.1 Account Information Card

| Field | Display |
|-------|---------|
| Profile photo | Avatar circle (56×56px) with Upload / Remove buttons |
| Email | Read-only text |
| Role | Badge: "Agent" (amber) or "Admin" (blue) |
| Member since | Formatted: `Jan 15, 2025` |
| Two-Factor Authentication | 🔒 Enabled + Active badge OR 🛡 Not enabled + "Set up →" link to `/auth/2fa/setup` |

### 4.2 Change Password Card

Form fields:
- Current password (required)
- New password (required, minlength 8)
- Confirm new password (required, minlength 8)

Submitted via HTMX `POST /profile/password`. On success: toast/flash message, form cleared. On error: inline error message below the form.

---

## 5. Avatar Upload Flow

### Client Side

1. "Upload photo" button triggers hidden `<input type="file" accept="image/jpeg,image/png">` (max 5MB enforced client-side)
2. File selected → loaded into **Cropper.js** (loaded via CDN in `base.njk`, lazy-initialised only on the profile page) in a modal overlay
3. Circular crop area, drag to reposition, pinch/scroll to zoom

> **CSP note:** Cropper.js must be loaded from `https://cdn.jsdelivr.net` — the only non-self CDN already whitelisted in the app's CSP `scriptSrc`. Use the `cdn.jsdelivr.net/npm/cropperjs` URL. Do not use an alternative CDN.
4. "Save" → `canvas.toBlob('image/jpeg', 0.85)` → `FormData` → `fetch POST /profile/avatar`
5. On success: HTMX swaps the avatar element with updated image

### Server Side

- `multer` middleware: `jpg/jpeg/png`, max 5MB, filename sanitised, path traversal rejected
- Saves to `/uploads/avatars/{agentId}.jpg` (overwrites existing if present)
- Updates `avatarPath` in DB via repository
- Returns HTMX partial with updated avatar HTML (`hasAvatar: true`, renders the `<img>` element)

**Delete response:** `DELETE /profile/avatar` returns an HTMX partial rendering the initials-fallback circle (`hasAvatar: false`), replacing the same avatar element.

### Serving

`GET /profile/avatar/:agentId` — guarded by `requireAuth()`. Reads file from disk, sends with `Content-Type: image/jpeg`. Returns 404 if file not found.

---

## 6. Schema Migration

Add `avatarPath` to the `Agent` model:

```prisma
avatarPath  String?  @map("avatar_path")
```

Migration name: `add_agent_avatar_path`

Use the shadow DB migration pattern (documented in MEMORY.md) since `prisma migrate dev` is blocked by session table drift.

---

## 7. Router Mounting and `pageTitle` Convention

In the Express app entry point (or main router), mount the profile router:

```typescript
import { profileRouter } from '@/domains/profile/profile.router';
app.use('/', profileRouter);  // /profile, /profile/avatar
```

The profile router is accessible to both agent and admin users — role checked at `requireRole('agent', 'admin')`.

### `pageTitle` convention

There is no existing `pageTitle` variable in the layouts. Each router handler that renders a page must pass it explicitly:

```typescript
res.render('pages/profile/index', {
  pageTitle: 'Profile',
  user: req.user,
  hasAvatar: !!profile.avatarPath,
  profile,
});
```

All other existing routers (agent, admin) must also be updated to pass `pageTitle` so the new top header can display the correct page name. Use the existing page heading text as the value (e.g. `'Dashboard'`, `'Pipeline'`, `'Sellers'`).

---

## 8. JavaScript — app.js

Add user menu toggle to the existing click-delegation block in `public/js/app.js`:

```javascript
case 'toggle-user-menu':
  const menu = document.getElementById('user-menu-dropdown');
  menu.classList.toggle('hidden');
  // Close on outside click
  break;
```

Also add a document-level click listener to close the dropdown when clicking outside.

---

## 9. Out of Scope

- Seller profile page (sellers use a different layout and auth flow)
- Editable name or email
- Notification preference changes (handled in agent settings)
- Profile photo for sellers
- Name in session refresh after avatar upload (session stores name from login; avatar served by ID, no session update needed)

---

## 10. Testing

**Unit tests — `profile.service.ts`:**
- `getProfile`: returns ProfileView for valid agent
- `uploadAvatar`: rejects invalid file type, rejects file > 5MB, happy path saves file + updates DB
- `deleteAvatar`: happy path removes file + clears DB, no-op if file missing
- `changePassword`: rejects wrong current password, rejects password mismatch, rejects new password < 8 chars, success updates hash

**Unit tests — `profile.repository.ts`:**
- `findAgentById`, `updateAvatarPath`, `clearAvatarPath`, `updatePasswordHash`

**Integration tests:**
- `GET /profile` → 200 for authenticated agent, 200 for authenticated admin, 302 for unauthenticated
- `POST /profile/password` → 400 for wrong current password, 400 for mismatched new passwords, 200 for valid change
- `POST /profile/avatar` → 400 for invalid file type, 400 for file > 5MB, 200 for valid upload
- `DELETE /profile/avatar` → 200 with initials partial when avatar exists, 200 (no-op) when no avatar
- `GET /profile/avatar/:agentId` → 401 for unauthenticated, 404 when no avatar on file, 200 with `Content-Type: image/jpeg` for valid avatar
