# Spec: Avatar Upload 2MB Limit

**Date:** 2026-03-18
**Branch:** dashboard-layout-fix

---

## Overview

Enforce a consistent 2MB file size limit on avatar uploads across all three enforcement layers: client-side JS, multer middleware, and the profile service.

The hint text already displays "Max 2MB" — this change makes the actual enforcement match.

---

## Changes

### 1. Client — `avatar-display.njk`

On file `change` event, before opening Cropper.js, check `file.size > 2 * 1024 * 1024`. If exceeded, show an inline error and abort (no modal opened).

The inline error element (`id="avatar-size-error"`) sits below the upload label, hidden by default, shown on violation, hidden again when a valid file is selected.

### 2. Server — `profile.multer.ts`

Change `fileSize` limit from `5 * 1024 * 1024` to `2 * 1024 * 1024`.

### 3. Service — `profile.service.ts`

In `uploadAvatar()`, add guard before processing:

```typescript
if (file.size > 2 * 1024 * 1024) {
  throw new ValidationError('File too large. Maximum size is 2MB.');
}
```

---

## Out of Scope

- Shared constant for the 2MB value (three occurrences, each layer independently enforceable)
- Compression or resizing of oversized files before rejection
